import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeocoderError, type Geocoder } from "../src/profile/geocode.js";
import { createProfileRuntime } from "../src/profile/runtime.js";
import { DataMissingError, openStore, type Store } from "../src/profile/store.js";
import { registerTools } from "../src/tools.js";
import { recordingClient } from "./helpers.js";
import { CENTRE, TRACT, buildFixture } from "./profile-fixture.js";

const SECRET = "123 Secret St, Seattle WA";

type LogEntry = { tool: string; ms: number; ok: boolean };

let fixture: Awaited<ReturnType<typeof buildFixture>>;

beforeAll(async () => {
  fixture = await buildFixture();
});

afterAll(async () => {
  await fixture.cleanup();
});

const working: Geocoder = {
  address: async () => ({ lat: CENTRE.lat, lon: CENTRE.lon, tract: TRACT.A, matched: "123 SECRET ST, SEATTLE, WA" }),
  coordinates: async (lat, lon) => ({ lat, lon, tract: TRACT.A }),
};

const broken: Geocoder = {
  address: async () => { throw new GeocoderError(); },
  coordinates: async () => { throw new GeocoderError(); },
};

async function connect(opts: { geocoder?: Geocoder; open?: () => Promise<Store>; maxPerMinute?: number } = {}) {
  const logs: LogEntry[] = [];
  const { client, paths } = recordingClient();
  const profile = createProfileRuntime({
    openStore: opts.open ?? (() => openStore(fixture.dir)),
    geocoder: opts.geocoder ?? working,
    maxPerMinute: opts.maxPerMinute,
  });
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server, { client, log: (e) => logs.push(e), profile });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = (args: Record<string, unknown>) => mcp.callTool({ name: "profile_place", arguments: args });
  return { mcp, logs, paths, call };
}

const texts = (r: unknown) => (r as { content: Array<{ text: string }> }).content.map((c) => c.text);

describe("profile_place", () => {
  it("is listed with a title, a description and read-only hints", async () => {
    const { mcp } = await connect();
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(7);
    const tool = tools.find((t) => t.name === "profile_place")!;
    expect(tool.title).toBe("Profile a place");
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: true });
    expect(tool.description).toMatch(/who lives/i);
    expect(tool.description).toMatch(/query_data/);
    expect(Object.keys((tool.inputSchema as { properties: object }).properties).sort()).toEqual([
      "location", "radius_miles", "sections",
    ]);
  });

  it("returns a profile for a ZIP without touching the Census API", async () => {
    const { call, paths, logs } = await connect({ geocoder: broken });
    const r = await call({ location: "98101" });
    expect(r.isError).toBeFalsy();
    const [note, body] = texts(r);
    expect(note).toMatch(/within 1 mile of ZIP code area 98101/);
    expect(note).toMatch(/2 census tracts/);
    expect(note).toMatch(/3,000 people/);
    const profile = JSON.parse(body);
    expect(Object.keys(profile)).toEqual(["location", "area", "sections", "gaps", "notes", "data"]);
    expect(profile.sections).toHaveLength(9);
    expect(profile.gaps).toHaveLength(5);
    expect(body).not.toMatch(/\n/);
    expect(paths).toEqual([]);
    expect(logs).toEqual([{ tool: "profile_place", ms: expect.any(Number), ok: true }]);
  });

  it("accepts a ZIP sent as a number, restoring a leading zero", async () => {
    const { call, mcp } = await connect();
    const r = await call({ location: 98101 });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(texts(r)[1]).location.label).toBe("ZIP code area 98101");
    // 02134 arrives as 2134: it must be read as a ZIP, not as an address.
    const z = await call({ location: 2134 });
    expect(texts(z)[0]).toMatch(/That ZIP has no Census ZIP code area/);
    const tool = (await mcp.listTools()).tools.find((t) => t.name === "profile_place")!;
    expect((tool.inputSchema as any).properties.location.type).toBe("string");
  });

  it("passes the radius and sections through", async () => {
    const { call } = await connect();
    const r = await call({ location: "98101", radius_miles: 0, sections: ["housing"] });
    const profile = JSON.parse(texts(r)[1]);
    expect(profile.area).toMatchObject({ radius_miles: 0, tracts: 1 });
    expect(profile.sections.map((s: { id: string }) => s.id)).toEqual(["housing"]);
    expect(profile.gaps).toBeUndefined();
  });

  it.each([
    ["an empty location", { location: "   " }],
    ["a location that is too long", { location: "x".repeat(201) }],
    ["a radius above ten miles", { location: "98101", radius_miles: 11 }],
    ["a negative radius", { location: "98101", radius_miles: -1 }],
    ["an unknown section", { location: "98101", sections: ["nope"] }],
  ])("rejects %s", async (_name, args) => {
    const { call } = await connect();
    const r = await call(args).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
    expect(r.isError).toBe(true);
  });

  it("says how to build the data when it is missing, and leaves other tools working", async () => {
    let opens = 0;
    const { call, mcp } = await connect({
      open: async () => {
        opens++;
        throw new DataMissingError("/nowhere");
      },
    });
    const r = await call({ location: "98101" });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toBe(
      "The profile data has not been built on this server. Run: npm run build && npm run build:acs",
    );
    // A failed open is tried again on the next call.
    await call({ location: "98101" });
    expect(opens).toBe(2);
    const other = await mcp.callTool({ name: "resolve_geography", arguments: { name: "TX" } });
    expect(other.isError).toBeFalsy();
  });

  it("opens the data once and reuses it", async () => {
    let opens = 0;
    const { call } = await connect({
      open: () => {
        opens++;
        return openStore(fixture.dir);
      },
    });
    await call({ location: "98101" });
    await call({ location: "Seattle, WA" });
    expect(opens).toBe(1);
  });

  it("offers candidates for a shared place name", async () => {
    const { call } = await connect();
    const r = await call({ location: "Springfield" });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toContain("Springfield city, IL");
    expect(texts(r)[0]).toContain("Springfield city, MO");
  });

  it("answers 'busy' past the per-minute ceiling, without doing any work", async () => {
    let opens = 0;
    let lookups = 0;
    const { call, logs } = await connect({
      maxPerMinute: 1,
      open: () => {
        opens++;
        return openStore(fixture.dir);
      },
      geocoder: { ...working, address: async (t) => { lookups++; return working.address(t); } },
    });
    expect((await call({ location: SECRET })).isError).toBeFalsy();
    const r = await call({ location: SECRET });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toBe("The Census connector is at its request limit. Try again in a minute.");
    expect(opens).toBe(1);
    expect(lookups).toBe(1);
    expect(logs.at(-1)).toMatchObject({ tool: "profile_place", ok: false });
  });

  describe("privacy", () => {
    it("keeps the address out of logs and errors when the lookup fails", async () => {
      const { call, logs, paths } = await connect({ geocoder: broken });
      const r = await call({ location: SECRET });
      expect(r.isError).toBe(true);
      expect(texts(r).join(" ")).toBe("The address lookup service did not respond. Try a ZIP or a place name.");
      expect(JSON.stringify(logs)).not.toMatch(/secret/i);
      expect(logs).toEqual([{ tool: "profile_place", ms: expect.any(Number), ok: false }]);
      expect(paths).toEqual([]);
    });

    it("keeps the address out of logs when the lookup succeeds", async () => {
      const { call, logs, paths } = await connect();
      const r = await call({ location: SECRET });
      expect(r.isError).toBeFalsy();
      expect(JSON.stringify(logs)).not.toMatch(/secret/i);
      expect(paths).toEqual([]);
    });

    it("does not repeat the input when something unexpected breaks", async () => {
      const exploding: Geocoder = {
        ...working,
        address: async () => ({ lat: Number.NaN, lon: Number.NaN, tract: `oops ${SECRET}` }),
      };
      const { call, logs } = await connect({
        geocoder: exploding,
        open: async () => {
          const store = await openStore(fixture.dir);
          return { ...store, rows: async () => { throw new Error(`boom ${SECRET}`); } };
        },
      });
      const r = await call({ location: SECRET });
      expect(r.isError).toBe(true);
      expect(texts(r).join(" ")).not.toMatch(/secret/i);
      expect(texts(r)[0]).toMatch(/could not be built/);
      expect(JSON.stringify(logs)).not.toMatch(/secret/i);
    });
  });
});
