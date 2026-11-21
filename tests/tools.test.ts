import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CensusClient } from "../src/core/client.js";
import { createCensusClient } from "../src/core/client.js";
import { loadCatalog } from "../src/core/catalog.js";
import { registerTools } from "../src/tools.js";
import { clientReturning, fake } from "./helpers.js";

type LogEntry = { tool: string; ms: number; ok: boolean };

async function connect(client: CensusClient) {
  const logs: LogEntry[] = [];
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server, { client, log: (e) => logs.push(e) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return { mcp, logs };
}

const text = (r: unknown, i: number) =>
  (r as { content: Array<{ text: string }> }).content[i].text;

const QUERY = { dataset: "acs/acs5", vintage: 2024, get: ["NAME"], for: "county:*" };

test("six tools, each with a title and marked read-only", async () => {
  const { mcp } = await connect(clientReturning({}));
  const { tools } = await mcp.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([
    "discover_datasets", "list_geographies", "query_data",
    "resolve_geography", "search_groups", "search_variables",
  ]);
  for (const t of tools) {
    expect(t.title, t.name).toBeTruthy();
    expect(t.annotations?.readOnlyHint, t.name).toBe(true);
    expect(t.name.length).toBeLessThanOrEqual(64);
  }
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  expect(byName.resolve_geography.annotations?.openWorldHint).toBe(false);
  expect(byName.query_data.annotations?.openWorldHint).toBe(true);
  expect(byName.query_data.title).toBe("Query Census data");
});

test("query_data without a key is a readable error, not a thrown one", async () => {
  const { mcp, logs } = await connect(createCensusClient({ apiKey: "", fetch: fake([]) }));
  const r = await mcp.callTool({ name: "query_data", arguments: QUERY });
  expect(r.isError).toBe(true);
  expect(text(r, 0)).toContain("key_signup");
  expect(logs).toHaveLength(1);
  expect(Object.keys(logs[0]).sort()).toEqual(["ms", "ok", "tool"]);
  expect(logs[0]).toMatchObject({ tool: "query_data", ok: false });
});

test("an unexpected error is reported with the key redacted", async () => {
  const broken: CensusClient = {
    hasKey: true,
    getJson: async () => {
      throw new Error("socket closed for https://x?key=SECRET123");
    },
    redact: (t) => t.replace("SECRET123", "REDACTED"),
  };
  const { mcp } = await connect(broken);
  const r = await mcp.callTool({ name: "query_data", arguments: QUERY });
  expect(r.isError).toBe(true);
  expect(text(r, 0)).toBe("Unexpected error: socket closed for https://x?key=REDACTED");
});

test("a truncated query says how many rows there were", async () => {
  const rows = Array.from({ length: 600 }, (_, i) => [`County ${i}`]);
  const { mcp, logs } = await connect(clientReturning([["NAME"], ...rows]));
  const r = await mcp.callTool({ name: "query_data", arguments: QUERY });
  expect(r.isError).toBeFalsy();
  expect(text(r, 0)).toBe(
    "Returned 500 of 600 row(s). Pass a higher limit (max 5000) or narrow the geography."
  );
  expect(JSON.parse(text(r, 1))).toHaveLength(500);
  expect(text(r, 1)).not.toContain("\n");
  expect(logs[0]).toMatchObject({ tool: "query_data", ok: true });
});

test("limit is passed through", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => [`County ${i}`]);
  const { mcp } = await connect(clientReturning([["NAME"], ...rows]));
  const r = await mcp.callTool({ name: "query_data", arguments: { ...QUERY, limit: 5 } });
  expect(JSON.parse(text(r, 1))).toHaveLength(5);
});

test("not-available codes are reported as nulls", async () => {
  const { mcp } = await connect(
    clientReturning([["NAME", "B19013_001E"], ["Tract 1", "-666666666"]])
  );
  const r = await mcp.callTool({ name: "query_data", arguments: QUERY });
  expect(text(r, 0)).toBe(
    'Returned 1 row(s). 1 value(s) were Census "not available" codes and are shown as null.'
  );
  expect(JSON.parse(text(r, 1))[0].B19013_001E).toBeNull();
});

test("timeseries tools work without a vintage", async () => {
  const { mcp } = await connect(clientReturning({ variables: { SAEPOVRTALL_PT: { label: "All ages in Poverty, Rate Estimate" } } }));
  const r = await mcp.callTool({
    name: "search_variables",
    arguments: { dataset: "timeseries/poverty/saipe", query: "poverty rate" },
  });
  expect(r.isError).toBeFalsy();
  expect(JSON.parse(text(r, 1))[0].name).toBe("SAEPOVRTALL_PT");
});

test("a vintage dataset without a vintage explains what to do", async () => {
  const { mcp } = await connect(clientReturning({}));
  const r = await mcp.callTool({
    name: "search_variables", arguments: { dataset: "acs/acs5", query: "income" },
  });
  expect(r.isError).toBe(true);
  expect(text(r, 0)).toContain("needs a vintage");
});

test("discover_datasets shows the ten most recent vintages and the total", async () => {
  loadCatalog([{
    id: "acs/acs5", title: "American Community Survey 5-Year", description: "income",
    vintages: Array.from({ length: 16 }, (_, i) => 2009 + i), timeseries: false, curated: true,
  }]);
  const { mcp } = await connect(clientReturning({}));
  const r = await mcp.callTool({ name: "discover_datasets", arguments: { query: "income" } });
  const [d] = JSON.parse(text(r, 1));
  expect(d).toMatchObject({ id: "acs/acs5", timeseries: false, vintage_count: 16 });
  expect(d.vintages).toEqual([2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]);
});

test("resolve_geography answers from bundled data", async () => {
  const { mcp } = await connect(clientReturning({}));
  const r = await mcp.callTool({ name: "resolve_geography", arguments: { name: "Cook County, IL" } });
  expect(text(r, 0)).toBe("Found 1 match(es).");
  expect(JSON.parse(text(r, 1))[0].for_clause).toBe("county:031");
});
