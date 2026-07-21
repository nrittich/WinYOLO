import { describe, expect, test } from "bun:test";
import { handleCodexRequest } from "../src/codex-http.ts";
import { CodexGatewayError } from "../src/codex-gateway.ts";
import { testConfig } from "./helpers.ts";

function mockGateway() {
  const calls: Array<[string, unknown]> = [];
  const gateway = {
    diagnostics: () => ({ available: true, initialized: true, codexVersion: "0.144.6" }),
    pendingServerRequests: () => [],
    listThreads: async (params: unknown) => { calls.push(["list", params]); return { data: [{ id: "thread-1", preview: "hello" }], nextCursor: "next" }; },
    searchThreads: async (params: unknown) => { calls.push(["search", params]); return { data: [{ thread: { id: "thread-2", preview: "match" }, snippet: "match" }], nextCursor: null }; },
    readThread: async (id: string) => {
      calls.push(["read", id]);
      if (id === "missing") throw new CodexGatewayError("unknown thread");
      return { thread: { id, preview: "sk-1234567890123456", turns: [] } };
    },
    archiveThread: async (id: string) => { calls.push(["archive", id]); return {}; },
    unarchiveThread: async (id: string) => { calls.push(["unarchive", id]); return {}; },
    startThread: async (cwd: string, mode: string) => { calls.push(["start", { cwd, mode }]); return { thread: { id: "thread-new" } }; },
    resumeThread: async (id: string, cwd: string, mode: string) => { calls.push(["resume", { id, cwd, mode }]); return { thread: { id } }; },
    startTurn: async (id: string, text: string, images: string[], mode: string) => { calls.push(["turn", { id, text, images, mode }]); return { turn: { id: "turn-1" } }; },
    interruptTurn: async (threadId: string, turnId: string) => { calls.push(["interrupt", { threadId, turnId }]); return {}; },
    respondToServerRequest: async (id: string, input: unknown) => { calls.push(["respond", { id, input }]); },
    start: async () => {},
    subscribe: () => ({ replay: [{ id: 4, type: "turn/completed", at: "now", data: { threadId: "thread-1" }, threadId: "thread-1" }], reset: false, unsubscribe: () => {} }),
  };
  return { gateway: gateway as any, calls };
}

async function request(path: string, options: RequestInit = {}, gateway = mockGateway().gateway) {
  return await handleCodexRequest(new Request(`http://127.0.0.1:4747${path}`, options), testConfig(), gateway);
}

describe("Codex REST gateway", () => {
  test("lists and searches native threads with validated pagination", async () => {
    const mock = mockGateway();
    const listed = await request("/api/codex/threads?limit=20&archived=false", {}, mock.gateway);
    expect(listed?.status).toBe(200);
    expect((await listed!.json() as any).threads[0].id).toBe("thread-1");
    expect((mock.calls[0]![1] as any).sourceKinds).toContain("cli");
    const searched = await request("/api/codex/threads?search=match&archived=true", {}, mock.gateway);
    expect((await searched!.json() as any).threads[0].id).toBe("thread-2");
    expect(mock.calls[1]![0]).toBe("search");
    expect((await request("/api/codex/threads?limit=0", {}, mock.gateway))?.status).toBe(400);
    expect((await request("/api/codex/threads?archived=maybe", {}, mock.gateway))?.status).toBe(400);
  });

  test("loads, redacts, archives, and maps unknown threads", async () => {
    const mock = mockGateway();
    const detail = await request("/api/codex/threads/thread-1", {}, mock.gateway);
    expect(await detail!.text()).not.toContain("sk-1234567890123456");
    expect((await request("/api/codex/threads/missing", {}, mock.gateway))?.status).toBe(404);
    const archived = await request("/api/codex/threads/thread-1/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, mock.gateway);
    expect(await archived!.json()).toMatchObject({ ok: true, archived: true });
  });

  test("creates YOLO/Safe threads and multimodal turns", async () => {
    const mock = mockGateway();
    await request("/api/codex/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: ".", mode: "safe" }) }, mock.gateway);
    expect(mock.calls[0]).toMatchObject(["start", { mode: "safe" }]);
    const turn = await request("/api/codex/threads/thread-1/turns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "inspect", images: ["shot.png"], mode: "yolo" }) }, mock.gateway);
    expect(turn?.status).toBe(202);
    expect(mock.calls[1]).toMatchObject(["resume", { id: "thread-1", mode: "yolo" }]);
    expect(mock.calls[2]![1]).toMatchObject({ id: "thread-1", text: "inspect", mode: "yolo" });
    expect((await request("/api/codex/threads/thread-1/turns", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, mock.gateway))?.status).toBe(400);
  });

  test("interrupts turns, responds to approvals, and streams replayable SSE", async () => {
    const mock = mockGateway();
    expect((await request("/api/codex/threads/thread-1/turns/turn-1/interrupt", { method: "POST", body: "{}" }, mock.gateway))?.status).toBe(200);
    expect((await request("/api/codex/requests/approval-1/respond", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approve" }) }, mock.gateway))?.status).toBe(200);
    const stream = await request("/api/codex/events?threadId=thread-1&after=0", {}, mock.gateway);
    const reader = stream!.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("turn/completed");
    await reader.cancel();
  });
});
