import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "../src/server.ts";
import { EventJournal } from "../src/journal.ts";
import { RunManager } from "../src/run-manager.ts";
import type { PolicyAssessment, ToolCall, ToolResult } from "../src/types.ts";
import { testConfig } from "./helpers.ts";

const servers: Bun.Server<undefined>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });

describe("localhost server", () => {
  test("serves health and dashboard without exposing secrets", async () => {
    const config = testConfig({ port: 0 });
    const server = createServer(config);
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect((await health.json() as any).status).toBe("ok");
    const html = await (await fetch(base)).text();
    expect(html).toContain("WinYOLO");
    expect(html).not.toContain(config.apiKey!);
  });

  test("rejects hostile browser origins", async () => {
    const server = createServer(testConfig({ port: 0 }));
    servers.push(server);
    const response = await fetch(`http://127.0.0.1:${server.port}/api/runs`, { headers: { Origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });

  test("protects and serves isolation, checkpoint, and capability endpoints", async () => {
    const config = testConfig({ port: 0 });
    const run = { id: "isolated-1", task: "fix build", sourceCwd: config.defaultCwd, status: "completed", checkpointId: "cp-1", processId: 12, createdAt: "now", updatedAt: "now", events: [] };
    const isolation = { hydrate: async () => {}, checkpoints: { list: async () => [{ id: "cp-1", finalDiffHash: "abc" }] }, start: async () => run, get: (id: string) => id === run.id ? run : undefined, subscribe: () => () => {}, interrupt: async () => true, accept: async () => ({ ...run, status: "accepted" }), rollback: async () => ({ ...run, status: "rolled_back" }) } as any;
    const server = createServer(config, undefined, undefined, isolation); servers.push(server); const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/api/windows/capabilities`)).status).toBe(200);
    expect((await fetch(`${base}/api/checkpoints`)).status).toBe(200);
    const created = await fetch(`${base}/api/isolation/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "fix build" }) });
    expect(created.status).toBe(202); expect((await created.json() as any).run.id).toBe("isolated-1");
    expect((await fetch(`${base}/api/isolation/runs/isolated-1`)).status).toBe(200);
    expect((await fetch(`${base}/api/isolation/runs/isolated-1/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(200);
    expect((await fetch(`${base}/api/isolation/runs`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ task: "escape" }) })).status).toBe(403);
  });

  test("lists canonical tools", async () => {
    const server = createServer(testConfig({ port: 0 }));
    servers.push(server);
    const body = await (await fetch(`http://127.0.0.1:${server.port}/api/tools`)).json() as any;
    expect(body.tools.map((tool: any) => tool.name)).toContain("win_acl");
    expect(body.tools).toHaveLength(13);
  });

  test("creates one active run, rejects concurrency, and streams events", async () => {
    const config = testConfig({ port: 0 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const agent = { run: async () => { await gate; return "done"; } } as any;
    const manager = new RunManager(config, agent, new EventJournal(config.dataDir));
    const server = createServer(config, manager);
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const created = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "hold this run" }),
    });
    expect(created.status).toBe(202);
    const run = (await created.json() as any).run;
    const conflict = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "second run" }),
    });
    expect(conflict.status).toBe(409);

    const stream = await fetch(`${base}/api/runs/${run.id}/events`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("run.created");
    await reader.cancel();

    const detail = await (await fetch(`${base}/api/runs/${run.id}`)).json() as any;
    expect(detail.run.task).toBe("hold this run");
    expect(detail.run.events.length).toBeGreaterThanOrEqual(2);
    release();
  });

  test("routes direct HTTP tools through the dashboard approval path", async () => {
    const config = testConfig({ port: 0 });
    const executed: ToolCall[] = [];
    const assess = (call: ToolCall): PolicyAssessment => ({
      decision: "confirm",
      risk: "high",
      reasons: ["HTTP confirmation fixture."],
      targets: ["c:\\windows\\fixture"],
      protectedTargets: ["c:\\windows\\fixture"],
      fingerprint: "http-bound-call",
      confirmationPhrase: "CONFIRM POLICY",
    });
    const authority = {
      assess,
      execute: async (call: ToolCall): Promise<ToolResult> => {
        executed.push(structuredClone(call));
        return { ok: true, tool: call.name, data: { executed: true }, assessment: assess(call) };
      },
    };
    const manager = new RunManager(
      config,
      { run: async () => "unused" } as any,
      new EventJournal(config.dataDir),
      authority,
    );
    const server = createServer(config, manager);
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    const arguments_ = {
      action: "write",
      path: "C:\\Windows\\fixture.txt",
      content: "bound content",
      destination: null,
      recursive: false,
    };

    const execution = fetch(`${base}/api/tools/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "win_filesystem", arguments: arguments_ }),
    });
    let pending: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const runs = await (await fetch(`${base}/api/runs`)).json() as any;
      pending = runs.runs.find((run: any) => run.status === "awaiting_confirmation");
      if (pending) break;
      await Bun.sleep(5);
    }
    expect(pending.pendingApproval.call.arguments).toEqual(arguments_);
    expect(executed).toHaveLength(0);

    const wrong = await fetch(`${base}/api/runs/${pending.id}/approvals/${pending.pendingApproval.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve", confirmation: "CONFIRM WRONG" }),
    });
    expect(wrong.status).toBe(409);
    expect(executed).toHaveLength(0);

    const approved = await fetch(`${base}/api/runs/${pending.id}/approvals/${pending.pendingApproval.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approve",
        confirmation: pending.pendingApproval.assessment.confirmationPhrase,
      }),
    });
    expect(approved.status).toBe(200);
    const result = await execution;
    expect(result.status).toBe(200);
    expect((await result.json() as any).runId).toBe(pending.id);
    expect(executed).toHaveLength(1);
    expect(executed[0]!.arguments).toEqual(arguments_);
  });

  test("returns structured tool failures without transport-level failure", async () => {
    const config = testConfig({ port: 0 });
    const assessment: PolicyAssessment = {
      decision: "allow",
      risk: "low",
      reasons: ["Timeout fixture."],
      targets: [],
      protectedTargets: [],
      fingerprint: "timeout-fixture",
    };
    const authority = {
      assess: () => assessment,
      execute: async (): Promise<ToolResult> => ({
        ok: false,
        tool: "win_shell",
        timedOut: true,
        error: "Command timed out after 250ms.",
        assessment,
      }),
    };
    const manager = new RunManager(
      config,
      { run: async () => "unused" } as any,
      new EventJournal(config.dataDir),
      authority,
    );
    const server = createServer(config, manager);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/api/tools/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "win_shell",
        arguments: { shell: "powershell", script: "Start-Sleep 5" },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(false);
    expect(body.result.timedOut).toBe(true);
  });
});
