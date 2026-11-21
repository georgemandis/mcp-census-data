#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCensusClient } from "./core/client.js";
import { VERSION } from "./core/version.js";
import { registerTools } from "./tools.js";

const server = new McpServer({ name: "census-data", version: VERSION });
registerTools(server, { client: createCensusClient() });
await server.connect(new StdioServerTransport());
