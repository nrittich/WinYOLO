import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config.ts";
import { RunManager } from "./run-manager.ts";
import { TOOL_DEFINITIONS } from "./tools.ts";
import type { ToolCall, ToolName } from "./types.ts";

const MCP_CONFIRM_TOOL = {
  name: "win_confirm",
  description: "Approve or reject one pending WinYOLO action. Approval succeeds only with the exact confirmation shown on the local dashboard. This tool never executes caller-supplied commands.",
  inputSchema: {
    type: "object" as const,
    properties: {
      run_id: { type: "string" },
      approval_id: { type: "string" },
      decision: { type: "string", enum: ["approve", "reject"] },
      confirmation: { type: "string" },
    },
    required: ["run_id", "approval_id", "decision", "confirmation"],
    additionalProperties: false,
  },
};

export function createMcpServer(config: AppConfig, manager = new RunManager(config)): Server {
  const server = new Server(
    { name: "winyolo", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as { type: "object"; [key: string]: unknown },
    })), MCP_CONFIRM_TOOL],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "win_confirm") {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const decision = args.decision === "approve" ? "approve" : args.decision === "reject" ? "reject" : null;
      const ok = decision !== null && manager.confirm(
        String(args.run_id ?? ""),
        String(args.approval_id ?? ""),
        decision,
        String(args.confirmation ?? ""),
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ ok, error: ok ? undefined : "approval_mismatch" }) }],
        isError: !ok,
      };
    }
    const call: ToolCall = {
      callId: crypto.randomUUID(),
      name: request.params.name as ToolName,
      arguments: (request.params.arguments ?? {}) as Record<string, unknown>,
    };
    const managed = await manager.executeTool({ call, cwd: config.defaultCwd, source: "mcp" });
    const text = JSON.stringify(managed);
    return {
      content: [{ type: "text", text }],
      isError: !managed.result.ok,
    };
  });
  return server;
}
