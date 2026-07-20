import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AppConfig } from "./config.ts";
import { ToolAuthority } from "./executor.ts";
import { createMcpServer } from "./mcp-server.ts";

export async function handleMcpRequest(
  request: Request,
  config: AppConfig,
  authority: ToolAuthority,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createMcpServer(config, authority);
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
