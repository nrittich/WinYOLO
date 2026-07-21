import { describe, expect, test } from "bun:test";
import { CodexAppServerGateway, CodexGatewayError, type AppServerProcess, type RpcMessage } from "../src/codex-gateway.ts";
import { testConfig } from "./helpers.ts";

class FakeProcess implements AppServerProcess {
  private output = new TransformStream<Uint8Array, Uint8Array>();
  private writer = this.output.writable.getWriter();
  private exitResolve!: (code: number) => void;
  readonly stdout = this.output.readable;
  readonly exited = new Promise<number>((resolve) => { this.exitResolve = resolve; });
  readonly writes: RpcMessage[] = [];
  killed = false;
  stdin = {
    write: async (data: string) => {
      for (const line of data.trim().split("\n")) {
        const message = JSON.parse(line) as RpcMessage;
        this.writes.push(message);
        this.onWrite?.(message);
      }
      return data.length;
    },
    flush: () => {},
    end: () => {},
  };
  constructor(private readonly onWrite?: (message: RpcMessage) => void) {}
  async send(value: unknown, split = false) {
    const bytes = new TextEncoder().encode(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
    if (split) {
      await this.writer.write(bytes.slice(0, 3));
      await this.writer.write(bytes.slice(3));
    } else await this.writer.write(bytes);
  }
  kill() { this.killed = true; this.exitResolve(0); }
  exit(code: number) { this.exitResolve(code); }
}

async function initializedGateway(overrides = {}) {
  let fake!: FakeProcess;
  fake = new FakeProcess((message) => {
    if (message.method === "initialize") void fake.send({ id: message.id, result: { userAgent: "codex-cli/0.144.6" } }, true);
  });
  const gateway = new CodexAppServerGateway(testConfig({ codexExecutable: "codex.exe", ...overrides }), () => fake, () => "codex.exe");
  await gateway.start();
  return { gateway, fake };
}

describe("Codex app-server gateway", () => {
  test("initializes JSONL and correlates out-of-order responses", async () => {
    const { gateway, fake } = await initializedGateway();
    expect(fake.writes[0]?.method).toBe("initialize");
    expect(fake.writes[1]).toEqual({ method: "initialized" });
    const one = gateway.request<{ value: number }>("thread/list", { limit: 1 });
    const two = gateway.request<{ value: number }>("thread/read", { threadId: "thread-1" });
    await Bun.sleep(0);
    const requests = fake.writes.slice(-2);
    await fake.send(`${JSON.stringify({ id: requests[1]!.id, result: { value: 2 } })}\n${JSON.stringify({ id: requests[0]!.id, result: { value: 1 } })}`);
    expect(await one).toEqual({ value: 1 });
    expect(await two).toEqual({ value: 2 });
    await gateway.stop();
  });

  test("delivers notifications, diagnoses malformed lines, and replays bounded events", async () => {
    const { gateway, fake } = await initializedGateway({ codexEventBufferSize: 3 });
    await fake.send("not-json");
    await fake.send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", delta: "hello sk-1234567890123456" } });
    await Bun.sleep(0);
    const seen: any[] = [];
    const subscription = gateway.subscribe(0, (event) => seen.push(event));
    expect(subscription.replay.some((event) => event.type === "gateway/malformed")).toBe(true);
    expect(JSON.stringify(subscription.replay.at(-1)?.data)).not.toContain("sk-1234567890123456");
    expect(gateway.diagnostics().malformedMessages).toBe(1);
    subscription.unsubscribe();
    await gateway.stop();
  });

  test("keeps server request ids separate and answers Safe approvals", async () => {
    const { gateway, fake } = await initializedGateway();
    await fake.send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", command: "dir", availableDecisions: ["accept", "decline"] } });
    await Bun.sleep(0);
    expect(gateway.pendingServerRequests()).toHaveLength(1);
    await gateway.respondToServerRequest("approval-1", { decision: "approve" });
    expect(fake.writes.at(-1)).toEqual({ id: "approval-1", result: { decision: "accept" } });
    expect(gateway.pendingServerRequests()).toHaveLength(0);
    await fake.send({ id: 42, method: "item/fileChange/requestApproval", params: { threadId: "thread-1" } });
    await Bun.sleep(0);
    await gateway.respondToServerRequest("42", { decision: "reject" });
    expect(fake.writes.at(-1)).toEqual({ id: 42, result: { decision: "decline" } });
    await fake.send({ id: "unknown-1", method: "item/tool/call", params: { threadId: "thread-1" } });
    await Bun.sleep(0);
    await expect(gateway.respondToServerRequest("unknown-1", { decision: "approve" })).rejects.toThrow("cannot be approved");
    await gateway.respondToServerRequest("unknown-1", { decision: "reject" });
    expect(fake.writes.at(-1)).toMatchObject({ id: "unknown-1", error: { code: -32000 } });
    await gateway.stop();
  });

  test("uses exact thread and turn policy shapes including local images", async () => {
    const { gateway, fake } = await initializedGateway();
    const start = gateway.startThread("C:\\repo", "yolo");
    await Bun.sleep(0); const startRequest = fake.writes.at(-1)!;
    expect(startRequest.params).toMatchObject({ approvalPolicy: "never", sandbox: "workspace-write" });
    await fake.send({ id: startRequest.id, result: { thread: { id: "thread-1" } } }); await start;
    const turn = gateway.startTurn("thread-1", "inspect", ["C:\\shot.png"], "yolo");
    await Bun.sleep(0); const turnRequest = fake.writes.at(-1)!;
    expect(turnRequest.params).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "workspaceWrite", networkAccess: false } });
    expect((turnRequest.params?.input as any[])[0]).toEqual({ type: "text", text: "inspect", text_elements: [] });
    expect((turnRequest.params?.input as any[])[1]).toEqual({ type: "localImage", path: "C:\\shot.png" });
    await fake.send({ id: turnRequest.id, result: { turn: { id: "turn-1" } } }); await turn;
    await gateway.stop();
  });

  test("times out requests and rejects pending work on shutdown", async () => {
    const { gateway } = await initializedGateway({ codexRequestTimeoutMs: 20 });
    await expect(gateway.request("thread/list", {})).rejects.toBeInstanceOf(CodexGatewayError);
    const pending = gateway.request("thread/read", { threadId: "thread-1" });
    await Bun.sleep(0);
    await gateway.stop();
    await expect(pending).rejects.toThrow("stopped");
  });

  test("restarts crashed children only up to the configured bound", async () => {
    const processes: FakeProcess[] = [];
    const gateway = new CodexAppServerGateway(
      testConfig({ codexExecutable: "codex.exe", codexRestartLimit: 2 }),
      () => {
        let fake!: FakeProcess;
        fake = new FakeProcess((message) => {
          if (message.method === "initialize") void fake.send({ id: message.id, result: { userAgent: "codex-test" } });
        });
        processes.push(fake);
        return fake;
      },
      () => "codex.exe",
    );
    await gateway.start();
    processes[0]!.exit(9); await Bun.sleep(300);
    expect(processes).toHaveLength(2);
    processes[1]!.exit(9); await Bun.sleep(550);
    expect(processes).toHaveLength(3);
    processes[2]!.exit(9); await Bun.sleep(600);
    expect(processes).toHaveLength(3);
    expect(gateway.diagnostics().restarts).toBe(2);
    await gateway.stop();
  });
});
