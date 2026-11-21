import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VERSION } from "../src/core/version.js";
import { startHttp } from "../src/http.js";
import { clientReturning } from "./helpers.js";

let app: Awaited<ReturnType<typeof startHttp>>;
let base: string;
const logs: Array<{ tool: string; ms: number; ok: boolean }> = [];

beforeAll(async () => {
  app = await startHttp({
    port: 0,
    deps: { client: clientReturning({}), log: (e) => logs.push(e) },
  });
  base = `http://127.0.0.1:${app.port}`;
});
afterAll(() => app.close());

async function mcpClient() {
  const c = new Client({ name: "t", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return c;
}

test("GET /health reports ok and the version", async () => {
  const r = await fetch(`${base}/health`);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ status: "ok", version: VERSION });
});

test.each(["GET", "DELETE"])("%s /mcp is not allowed", async (method) => {
  const r = await fetch(`${base}/mcp`, { method });
  expect(r.status).toBe(405);
  expect(r.headers.get("allow")).toBe("POST");
});

test("unknown paths are 404", async () =>
  expect((await fetch(`${base}/nope`)).status).toBe(404));

test("a malformed body is a 400, not a crash", async () => {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: "{not json",
  });
  expect(r.status).toBe(400);
  expect((await fetch(`${base}/health`)).status).toBe(200);
});

test("an MCP client lists six tools and calls one", async () => {
  const c = await mcpClient();
  expect((await c.listTools()).tools).toHaveLength(6);
  const r = await c.callTool({ name: "resolve_geography", arguments: { name: "TX" } });
  expect(r.isError).toBeFalsy();
  expect(JSON.parse((r.content as Array<{ text: string }>)[1].text)[0].fips).toBe("48");
  expect(logs.at(-1)).toMatchObject({ tool: "resolve_geography", ok: true });
  await c.close();
});

test("a second client works: no session state is kept", async () => {
  const a = await mcpClient();
  const b = await mcpClient();
  expect((await b.listTools()).tools).toHaveLength(6);
  expect((await a.listTools()).tools).toHaveLength(6);
  await a.close();
  await b.close();
});
