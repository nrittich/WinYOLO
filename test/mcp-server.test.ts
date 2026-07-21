import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { EventJournal } from "../src/journal.ts";
import { createMcpServer } from "../src/mcp-server.ts";
import { RunManager } from "../src/run-manager.ts";
import { TOOL_DEFINITIONS } from "../src/tools.ts";
import type { PolicyAssessment, ToolCall, ToolResult } from "../src/types.ts";
import { testConfig } from "./helpers.ts";

const clients: Client[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function waitForPending(manager: RunManager): Promise<NonNullable<ReturnType<RunManager["active"]>>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = manager.active();
    if (run?.status === "awaiting_confirmation" && run.pendingApproval) return run;
    await Bun.sleep(5);
  }
  throw new Error("approval did not become pending");
}

function confirmAssessment(call: ToolCall): PolicyAssessment {
  return {
    decision: "confirm",
    risk: "high",
    reasons: ["Deterministic MCP confirmation fixture."],
    targets: [String(call.arguments.path ?? "C:\\Windows\\fixture")],
    protectedTargets: [String(call.arguments.path ?? "C:\\Windows\\fixture")],
    fingerprint: "mcp-bound-call",
    confirmationPhrase: "CONFIRM POLICY",
  };
}

describe("MCP confirmation authority", () => {
  test("lists MCP-only win_confirm without exposing it to the OpenAI model", async () => {
    const config = testConfig();
    const manager = new RunManager(config);
    const server = createMcpServer(config, manager);
    const client = new Client({ name: "winyolo-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([...TOOL_DEFINITIONS.map((tool) => tool.name), "win_confirm"]);
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).not.toContain("win_confirm");
  });

  test("shows a pending call, rejects a wrong phrase, and resumes the bound call after exact approval", async () => {
    const config = testConfig();
    const executions: Array<{ call: ToolCall; cwd: string; confirmed: boolean }> = [];
    const authority = {
      assess: (call: ToolCall) => confirmAssessment(call),
      execute: async (call: ToolCall, cwd: string, confirmed = false): Promise<ToolResult> => {
        executions.push({ call: structuredClone(call), cwd, confirmed });
        return { ok: true, tool: call.name, data: { executed: true }, assessment: confirmAssessment(call) };
      },
    };
    const manager = new RunManager(
      config,
      { run: async () => "unused" } as any,
      new EventJournal(config.dataDir),
      authority,
    );
    const server = createMcpServer(config, manager);
    const client = new Client({ name: "winyolo-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    servers.push(server);
    clients.push(client);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const arguments_ = {
      action: "write",
      path: "C:\\Windows\\fixture.txt",
      content: "bound content",
      destination: null,
      recursive: false,
    };
    const pendingResult = client.callTool({ name: "win_filesystem", arguments: arguments_ });
    const pendingRun = await waitForPending(manager);
    const approval = pendingRun.pendingApproval!;
    const exactPhrase = approval.assessment.confirmationPhrase!;

    expect(manager.get(pendingRun.id)?.pendingApproval?.call.arguments).toEqual(arguments_);
    expect(exactPhrase).toMatch(/^CONFIRM [A-F0-9]{8}$/);
    expect(exactPhrase).not.toBe("CONFIRM POLICY");
    expect(executions).toHaveLength(0);

    const wrong = await client.callTool({
      name: "win_confirm",
      arguments: {
        run_id: pendingRun.id,
        approval_id: approval.id,
        decision: "approve",
        confirmation: "CONFIRM WRONG",
      },
    });
    expect(wrong.isError).toBe(true);
    expect(manager.get(pendingRun.id)?.status).toBe("awaiting_confirmation");
    expect(executions).toHaveLength(0);

    const exact = await client.callTool({
      name: "win_confirm",
      arguments: {
        run_id: pendingRun.id,
        approval_id: approval.id,
        decision: "approve",
        confirmation: exactPhrase,
      },
    });
    expect(exact.isError).not.toBe(true);

    const completed = await pendingResult;
    expect(completed.isError).not.toBe(true);
    expect(executions).toEqual([{ call: approval.call, cwd: config.defaultCwd, confirmed: true }]);
    expect(manager.get(pendingRun.id)?.status).toBe("completed");
    expect(manager.get(pendingRun.id)?.pendingApproval).toBeUndefined();
  });
});
