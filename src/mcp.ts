#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { createMcpServer } from "./mcp-server.ts";

const server = createMcpServer(loadConfig());
await server.connect(new StdioServerTransport());
process.stderr.write("WinYOLO MCP ready — native Windows tools use the canonical policy authority.\n");
