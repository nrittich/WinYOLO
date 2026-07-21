import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { createMcpServer } from "./mcp-server.ts";
import { RunManager } from "./run-manager.ts";

const config = loadConfig();
const server = createMcpServer(config, new RunManager(config));
await server.connect(new StdioServerTransport());
process.stderr.write("WinYOLO MCP ready — native Windows tools use the canonical policy authority.\n");
