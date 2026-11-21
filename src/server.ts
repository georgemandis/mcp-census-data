import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./core/version.js";
import { registerTools, type ToolDeps } from "./tools.js";

export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "census-data", version: VERSION });
  registerTools(server, deps);
  return server;
}

/** One JSON line per tool call, on stderr. Never includes tool arguments. */
export function logToStderr(entry: { tool: string; ms: number; ok: boolean }): void {
  console.error(JSON.stringify({ t: new Date().toISOString(), ...entry }));
}
