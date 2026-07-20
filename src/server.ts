import { join } from "node:path";
import { platform } from "node:os";
import type { AppConfig } from "./config.ts";
import { isLoopbackHost } from "./config.ts";
import { RunManager } from "./run-manager.ts";
import { TOOL_DEFINITIONS } from "./tools.ts";
import { handleMcpRequest } from "./mcp-http.ts";
import type { ProviderName, ToolCall, ToolName } from "./types.ts";

const encoder = new TextEncoder();

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
}

function allowedOrigin(request: Request, config: AppConfig): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === `http://${config.host}:${config.port}` ||
    origin === `http://localhost:${config.port}` ||
    origin === `http://127.0.0.1:${config.port}`;
}

export function createServer(config: AppConfig, manager = new RunManager(config)): Bun.Server<undefined> {
  if (!isLoopbackHost(config.host)) {
    throw new Error(`Refusing non-loopback bind '${config.host}'. WinYOLO v1 is local-only.`);
  }
  const dashboardDir = join(import.meta.dir, "dashboard");

  return Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") && !allowedOrigin(request, config)) {
        return json({ ok: false, error: "origin_forbidden" }, 403);
      }
      if (url.pathname === "/mcp") {
        if (!allowedOrigin(request, config)) return json({ ok: false, error: "origin_forbidden" }, 403);
        return handleMcpRequest(request, config, manager);
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ status: "ok", version: "0.1.0", platform: platform(), model: config.model, provider: config.provider });
      }
      if (request.method === "GET" && url.pathname === "/api/runs") {
        return json({ runs: manager.list() });
      }
      if (request.method === "POST" && url.pathname === "/api/runs") {
        try {
          const input = await body(request);
          const task = String(input.task ?? "").trim();
          if (!task) return json({ ok: false, error: "task_required" }, 400);
          const provider: ProviderName = input.provider === "codex" ? "codex" : "openai";
          const run = await manager.start({
            task,
            provider,
            ...(input.cwd ? { cwd: String(input.cwd) } : {}),
          });
          return json({ ok: true, run }, 202);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return json({ ok: false, error: message }, message === "active_run_exists" ? 409 : 400);
        }
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (request.method === "GET" && runMatch) {
        const run = manager.get(runMatch[1]!);
        return run ? json({ ok: true, run }) : json({ ok: false, error: "run_not_found" }, 404);
      }
      const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (request.method === "GET" && eventMatch) {
        const runId = eventMatch[1]!;
        const run = manager.get(runId);
        if (!run) return json({ ok: false, error: "run_not_found" }, 404);
        let unsubscribe = () => {};
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const event of run.events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            unsubscribe = manager.subscribe(runId, (event) => {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { unsubscribe(); }
            });
            request.signal.addEventListener("abort", () => {
              unsubscribe();
              try { controller.close(); } catch {}
            }, { once: true });
          },
          cancel() { unsubscribe(); },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store",
            Connection: "keep-alive",
          },
        });
      }
      const confirmMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/approvals\/([^/]+)$/);
      if (request.method === "POST" && confirmMatch) {
        const input = await body(request);
        const decision = input.decision === "approve" ? "approve" : "reject";
        const ok = manager.confirm(confirmMatch[1]!, confirmMatch[2]!, decision, String(input.confirmation ?? ""));
        return ok ? json({ ok: true }) : json({ ok: false, error: "approval_mismatch" }, 409);
      }
      if (request.method === "GET" && url.pathname === "/api/tools") {
        return json({ tools: TOOL_DEFINITIONS });
      }
      if (request.method === "POST" && url.pathname === "/api/tools/execute") {
        const input = await body(request);
        const call: ToolCall = {
          callId: String(input.callId ?? crypto.randomUUID()),
          name: String(input.name ?? "") as ToolName,
          arguments: (input.arguments ?? {}) as Record<string, unknown>,
        };
        const cwd = String(input.cwd ?? config.defaultCwd);
        try {
          const managed = await manager.executeTool({ call, cwd, source: "http" });
          return json({ ok: managed.result.ok, ...managed }, managed.result.ok ? 200 : 409);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return json({ ok: false, error: message }, message === "active_run_exists" ? 409 : 400);
        }
      }

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return new Response(Bun.file(join(dashboardDir, "index.html")), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (request.method === "GET" && url.pathname === "/app.css") {
        return new Response(Bun.file(join(dashboardDir, "app.css")), { headers: { "Content-Type": "text/css; charset=utf-8" } });
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        return new Response(Bun.file(join(dashboardDir, "app.js")), { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
      }
      return json({ ok: false, error: "not_found" }, 404);
    },
  });
}
