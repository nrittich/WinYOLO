import { resolve } from "node:path";
import type { AppConfig } from "./config.ts";
import { CodexAppServerGateway, CodexGatewayError, type JsonObject } from "./codex-gateway.ts";
import { redactValue } from "./redact.ts";

const encoder = new TextEncoder();
const THREAD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SOURCE_KINDS = ["cli", "appServer", "vscode", "exec"];

function json(data: unknown, status = 200): Response {
  return Response.json(redactValue(data), {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function body(request: Request): Promise<JsonObject> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as JsonObject;
  } catch {
    throw new CodexGatewayError("Request body must be a JSON object.", -32602);
  }
}

function id(value: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { throw new CodexGatewayError("Invalid thread id.", -32602); }
  if (!THREAD_ID.test(decoded)) throw new CodexGatewayError("Invalid thread id.", -32602);
  return decoded;
}

function mode(value: unknown): "safe" | "yolo" {
  if (value === undefined || value === null || value === "safe") return "safe";
  if (value === "yolo") return "yolo";
  throw new CodexGatewayError("Mode must be 'safe' or 'yolo'.", -32602);
}

function codexError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Codex is unavailable.";
  if (/not found|unknown thread|does not exist/i.test(message)) return json({ ok: false, error: "thread_not_found" }, 404);
  if (/no active turn|turn is not active/i.test(message)) return json({ ok: false, error: "turn_not_active" }, 409);
  if (error instanceof CodexGatewayError && error.code === -32602) return json({ ok: false, error: message }, 400);
  if (error instanceof CodexGatewayError && error.code === -32020) return json({ ok: false, error: "request_not_found" }, 404);
  return json({ ok: false, error: "codex_unavailable", message }, 503);
}

function parseThreadList(url: URL): { method: "list" | "search"; params: JsonObject } {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CodexGatewayError("Limit must be an integer from 1 to 100.", -32602);
  const cursor = url.searchParams.get("cursor");
  if (cursor && cursor.length > 1_000) throw new CodexGatewayError("Cursor is too long.", -32602);
  const archivedValue = url.searchParams.get("archived");
  if (archivedValue !== null && archivedValue !== "true" && archivedValue !== "false") {
    throw new CodexGatewayError("Archived must be true or false.", -32602);
  }
  const searchTerm = url.searchParams.get("search")?.trim() ?? "";
  if (searchTerm.length > 200) throw new CodexGatewayError("Search is too long.", -32602);
  const params: JsonObject = {
    limit,
    ...(cursor ? { cursor } : {}),
    archived: archivedValue === "true",
    sourceKinds: SOURCE_KINDS,
    sortKey: "updated_at",
    sortDirection: "desc",
  };
  return searchTerm
    ? { method: "search", params: { ...params, searchTerm } }
    : { method: "list", params };
}

function normalizeThreads(result: JsonObject, searched: boolean): JsonObject {
  const data = Array.isArray(result.data) ? result.data : [];
  return {
    threads: searched ? data.map((entry) => (entry as JsonObject).thread).filter(Boolean) : data,
    matches: searched ? data : undefined,
    nextCursor: result.nextCursor ?? null,
    backwardsCursor: result.backwardsCursor ?? null,
  };
}

function ssePayload(event: { id?: number; type: string; data: unknown }): Uint8Array {
  return encoder.encode(`${event.id ? `id: ${event.id}\n` : ""}data: ${JSON.stringify(redactValue(event))}\n\n`);
}

export async function handleCodexRequest(
  request: Request,
  config: AppConfig,
  gateway: CodexAppServerGateway,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/codex")) return null;

  try {
    if (request.method === "GET" && url.pathname === "/api/codex/diagnostics") {
      return json({ ok: true, gateway: gateway.diagnostics(), pendingRequests: gateway.pendingServerRequests() });
    }

    if (request.method === "GET" && url.pathname === "/api/codex/threads") {
      const parsed = parseThreadList(url);
      const result = parsed.method === "search"
        ? await gateway.searchThreads(parsed.params)
        : await gateway.listThreads(parsed.params);
      return json({ ok: true, ...normalizeThreads(result, parsed.method === "search") });
    }

    if (request.method === "POST" && url.pathname === "/api/codex/threads") {
      const input = await body(request);
      const cwd = resolve(String(input.cwd ?? config.defaultCwd));
      const selectedMode = mode(input.mode);
      const result = await gateway.startThread(cwd, selectedMode);
      return json({ ok: true, mode: selectedMode, ...result }, 201);
    }

    const detail = url.pathname.match(/^\/api\/codex\/threads\/([^/]+)$/);
    if (request.method === "GET" && detail) {
      const result = await gateway.readThread(id(detail[1]!));
      return json({ ok: true, ...result });
    }

    const lifecycle = url.pathname.match(/^\/api\/codex\/threads\/([^/]+)\/(archive|unarchive|resume)$/);
    if (request.method === "POST" && lifecycle) {
      const threadId = id(lifecycle[1]!);
      const action = lifecycle[2]!;
      if (action === "archive") await gateway.archiveThread(threadId);
      else if (action === "unarchive") await gateway.unarchiveThread(threadId);
      else {
        const input = await body(request);
        const selectedMode = mode(input.mode);
        const result = await gateway.resumeThread(threadId, input.cwd ? resolve(String(input.cwd)) : undefined, selectedMode);
        return json({ ok: true, mode: selectedMode, ...result });
      }
      return json({ ok: true, threadId, archived: action === "archive" });
    }

    const turns = url.pathname.match(/^\/api\/codex\/threads\/([^/]+)\/turns$/);
    if (request.method === "POST" && turns) {
      const input = await body(request);
      const text = String(input.text ?? "").trim();
      const images = Array.isArray(input.images) ? input.images.map(String).filter(Boolean) : [];
      if (!text && images.length === 0) return json({ ok: false, error: "input_required" }, 400);
      if (images.length > 10 || images.some((path) => path.length > 1_000)) return json({ ok: false, error: "invalid_images" }, 400);
      const selectedMode = mode(input.mode);
      const threadId = id(turns[1]!);
      await gateway.resumeThread(threadId, undefined, selectedMode);
      const result = await gateway.startTurn(threadId, text, images.map((path) => resolve(path)), selectedMode);
      return json({ ok: true, mode: selectedMode, ...result }, 202);
    }

    const interrupt = url.pathname.match(/^\/api\/codex\/threads\/([^/]+)\/turns\/([^/]+)\/interrupt$/);
    if (request.method === "POST" && interrupt) {
      const result = await gateway.interruptTurn(id(interrupt[1]!), id(interrupt[2]!));
      return json({ ok: true, ...result });
    }

    const respond = url.pathname.match(/^\/api\/codex\/requests\/([^/]+)\/respond$/);
    if (request.method === "POST" && respond) {
      const requestId = id(respond[1]!);
      await gateway.respondToServerRequest(requestId, await body(request));
      return json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/codex/events") {
      await gateway.start();
      const rawAfter = request.headers.get("Last-Event-ID") ?? url.searchParams.get("after") ?? "0";
      const after = Number(rawAfter);
      if (!Number.isSafeInteger(after) || after < 0) throw new CodexGatewayError("Event cursor is invalid.", -32602);
      const threadId = url.searchParams.get("threadId") ?? undefined;
      if (threadId) id(threadId);
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enqueue = (event: Parameters<Parameters<typeof gateway.subscribe>[1]>[0]) => {
            if (!threadId || event.threadId === threadId || event.type.startsWith("gateway/")) {
              try { controller.enqueue(ssePayload(event)); } catch { unsubscribe(); }
            }
          };
          const subscription = gateway.subscribe(after, enqueue);
          unsubscribe = subscription.unsubscribe;
          if (subscription.reset) controller.enqueue(ssePayload({ type: "reset", data: { reason: "cursor_expired" } }));
          for (const event of subscription.replay) enqueue(event);
          heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { unsubscribe(); }
          }, 15_000);
          request.signal.addEventListener("abort", () => {
            unsubscribe();
            if (heartbeat) clearInterval(heartbeat);
            try { controller.close(); } catch {}
          }, { once: true });
        },
        cancel() {
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    return codexError(error);
  }
}
