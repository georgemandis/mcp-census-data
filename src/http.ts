#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCensusClient } from "./core/client.js";
import { VERSION } from "./core/version.js";
import { createServer, logToStderr } from "./server.js";
import type { ToolDeps } from "./tools.js";

const MAX_BODY_BYTES = 1_000_000;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string, headers?: Record<string, string>): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32600, message }, id: null }, headers);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Stateless: every POST gets its own MCP server and transport, so any
 * instance can answer any request. The Census client (cache and request
 * budget) is shared for the life of the process.
 */
async function handleMcp(req: IncomingMessage, res: ServerResponse, deps: ToolDeps): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    const tooLarge = (e as Error).message === "too large";
    return rpcError(res, tooLarge ? 413 : 400, tooLarge ? "Request body too large." : "Request body is not valid JSON.");
  }
  const server = createServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export async function startHttp(opts: {
  port: number;
  deps: ToolDeps;
}): Promise<{ close(): Promise<void>; port: number }> {
  const http = createHttpServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/health" && req.method === "GET") {
      return sendJson(res, 200, { status: "ok", version: VERSION });
    }
    if (path === "/mcp") {
      if (req.method !== "POST") {
        return rpcError(res, 405, "Method not allowed. This server is stateless; use POST.", { allow: "POST" });
      }
      handleMcp(req, res, opts.deps).catch(() => {
        if (!res.headersSent) rpcError(res, 500, "Internal server error.");
        else res.end();
      });
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  });

  await new Promise<void>((resolve) => http.listen(opts.port, "0.0.0.0", resolve));
  return {
    port: (http.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
        http.closeAllConnections();
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = createCensusClient();
  if (!client.hasKey) {
    console.error(
      "[census-mcp] CENSUS_API_KEY not set: data queries will fail; metadata tools still work."
    );
  }
  const { port } = await startHttp({
    port: Number(process.env.PORT) || 8787,
    deps: { client, log: logToStderr },
  });
  console.error(`[census-mcp] v${VERSION} listening on :${port} (POST /mcp, GET /health)`);
}
