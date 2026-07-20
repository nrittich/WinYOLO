import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AppConfig } from "./config.ts";
import { createMcpServer } from "./mcp-server.ts";
import type { RunManager } from "./run-manager.ts";

export async function handleMcpRequest(
  request: Request,
  config: AppConfig,
  manager: RunManager,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createMcpServer(config, manager);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    request.signal.addEventListener("abort", () => {
      void transport.close();
      void server.close();
    }, { once: true });
  }
}
