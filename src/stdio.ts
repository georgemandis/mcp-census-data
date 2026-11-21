#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCensusClient } from "./core/client.js";
import { createServer } from "./server.js";

const client = createCensusClient();
if (!client.hasKey) {
  console.error(
    "[census-mcp] CENSUS_API_KEY not set: data queries will fail; metadata tools still work."
  );
}
await createServer({ client }).connect(new StdioServerTransport());
