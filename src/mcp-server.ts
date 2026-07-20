import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config.ts";
import { ToolAuthority } from "./executor.ts";
import { TOOL_DEFINITIONS } from "./tools.ts";
import type { ToolCall, ToolName } from "./types.ts";

export function createMcpServer(config: AppConfig, authority = new ToolAuthority(config)): Server {
  const server = new Server(
    { name: "winyolo", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as { type: "object"; [key: string]: unknown },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const call: ToolCall = {
      callId: crypto.randomUUID(),
      name: request.params.name as ToolName,
      arguments: (request.params.arguments ?? {}) as Record<string, unknown>,
    };
    const result = await authority.execute(call, config.defaultCwd, false);
    const text = JSON.stringify(result);
    return {
      content: [{ type: "text", text }],
      isError: !result.ok,
    };
  });
  return server;
}
