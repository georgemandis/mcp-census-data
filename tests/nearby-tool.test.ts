import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlacesMissingError, openPlaces, type PlacesStore } from "../src/places/store.js";
import { GeocoderError, type Geocoder } from "../src/profile/geocode.js";
import { createProfileRuntime } from "../src/profile/runtime.js";
import { openStore } from "../src/profile/store.js";
import { registerTools } from "../src/tools.js";
import { recordingClient } from "./helpers.js";
import { SnapMissingError, openSnap, type SnapStore } from "../src/snap/store.js";
import { SNAP_MISSING } from "../src/snap/words.js";
import { buildPlacesFixture } from "./places-fixture.js";
import { buildSnapFixture } from "./snap-fixture.js";
import { CENTRE, TRACT, buildFixture } from "./profile-fixture.js";

const SECRET = "123 Secret St, Seattle WA";
type LogEntry = { tool: string; ms: number; ok: boolean };

let profileFixture: Awaited<ReturnType<typeof buildFixture>>;
let placesFixture: Awaited<ReturnType<typeof buildPlacesFixture>>;
let snapFixture: Awaited<ReturnType<typeof buildSnapFixture>>;
beforeAll(async () => {
  profileFixture = await buildFixture();
  placesFixture = await buildPlacesFixture();
  snapFixture = await buildSnapFixture();
});
afterAll(async () => {
  await profileFixture.cleanup();
  await placesFixture.cleanup();
  await snapFixture.cleanup();
});

const working: Geocoder = {
  address: async () => ({ lat: CENTRE.lat, lon: CENTRE.lon, tract: TRACT.A, matched: "123 SECRET ST, SEATTLE, WA" }),
  coordinates: async (lat, lon) => ({ lat, lon, tract: TRACT.A }),
};
const broken: Geocoder = {
  address: async () => { throw new GeocoderError(); },
  coordinates: async () => { throw new GeocoderError(); },
};

async function connect(
  opts: {
    geocoder?: Geocoder;
    openPlaces?: () => Promise<PlacesStore>;
    openSnap?: () => Promise<SnapStore>;
    maxPerMinute?: number;
  } = {},
) {
  const logs: LogEntry[] = [];
  const { client, paths } = recordingClient();
  const profile = createProfileRuntime({
    openStore: () => openStore(profileFixture.dir),
    openPlaces: opts.openPlaces ?? (() => openPlaces(placesFixture.dir)),
    openSnap: opts.openSnap ?? (() => openSnap(snapFixture.dir)),
    geocoder: opts.geocoder ?? working,
    maxPerMinute: opts.maxPerMinute,
  });
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server, { client, log: (e) => logs.push(e), profile });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = (args: Record<string, unknown>, name = "nearby_places") => mcp.callTool({ name, arguments: args });
  return { mcp, logs, paths, call };
}

const texts = (r: unknown) => (r as { content: Array<{ text: string }> }).content.map((c) => c.text);

describe("nearby_places", () => {
  it("is the eighth tool, with a title, a description and read-only hints", async () => {
    const { mcp } = await connect();
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(8);
    const tool = tools.find((t) => t.name === "nearby_places")!;
    expect(tool.title).toBe("What's around a place");
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: true });
    expect(tool.description).toMatch(/profile_place/);
    expect(tool.description).toMatch(/approximate/i);
    expect(Object.keys((tool.inputSchema as { properties: object }).properties).sort()).toEqual([
      "location", "per", "radius_miles", "types",
    ]);
  });

  it("answers for a ZIP and named types, without touching the Census API", async () => {
    const { call, paths, logs } = await connect({ geocoder: broken });
    const r = await call({ location: "98101", types: ["libraries", "cafes"] });
    expect(r.isError).toBeFalsy();
    const [note, body] = texts(r);
    expect(note).toMatch(/within 1 mile of ZIP code area 98101/);
    expect(note).toMatch(/approximate/i);
    const answer = JSON.parse(body);
    expect(answer.types.map((t: { asked: string }) => t.asked)).toEqual(["libraries", "cafes"]);
    expect(answer.types[0].here.count).toBe(2);
    expect(body).not.toMatch(/\n/);
    expect(paths).toEqual([]);
    expect(logs).toEqual([{ tool: "nearby_places", ms: expect.any(Number), ok: true }]);
  });

  it("gives an overview when no type is named", async () => {
    const { call } = await connect();
    const answer = JSON.parse(texts(await call({ location: "98101", radius_miles: 0 }))[1]);
    expect(answer.overview.over[0].type).toBe("bar");
    expect(answer.types).toBeUndefined();
  });

  it("passes the group through", async () => {
    const { call } = await connect();
    const answer = JSON.parse(texts(await call({ location: "98101", types: ["grocery stores"], per: "snap_households" }))[1]);
    expect(answer.per.group).toBe("snap_households");
  });

  it("mentions USDA's SNAP retailers in its description", async () => {
    const { mcp } = await connect();
    const tool = (await mcp.listTools()).tools.find((t) => t.name === "nearby_places")!;
    expect(tool.description).toMatch(/USDA/);
    expect(tool.description).toMatch(/SNAP stores/);
  });

  it("answers SNAP questions from USDA's list", async () => {
    const { call } = await connect();
    const answer = JSON.parse(texts(await call({ location: "98101", types: ["SNAP stores", "grocery stores"] }))[1]);
    expect(answer.types[0].source).toBe("USDA SNAP retailers");
    expect(answer.types[0].full_line.here.count).toBeGreaterThan(0);
    expect(answer.types[1].official.source).toBe("USDA SNAP retailers");
  });

  it("still answers when the SNAP data is missing, saying so", async () => {
    const { call } = await connect({ openSnap: async () => { throw new SnapMissingError("/nowhere"); } });
    const r = await call({ location: "98101", types: ["SNAP stores", "libraries"] });
    expect(r.isError).toBeFalsy();
    const answer = JSON.parse(texts(r)[1]);
    expect(answer.types[0].note).toBe(SNAP_MISSING);
    expect(answer.types[1].here.count).toBe(2);
  });

  it("hides other SNAP failures behind the fixed message", async () => {
    const { call, logs } = await connect({ openSnap: async () => { throw new Error("boom /secret/path"); } });
    const r = await call({ location: SECRET, types: ["SNAP stores"] });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toBe("The request could not be completed because of an internal error.");
    expect(JSON.stringify(r)).not.toMatch(/boom|secret/i);
    expect(JSON.stringify(logs)).not.toMatch(/Secret|boom/);
    expect(logs).toEqual([{ tool: "nearby_places", ms: expect.any(Number), ok: false }]);
  });

  it("treats unclear words as an answer with candidates, not an error", async () => {
    const { call } = await connect();
    const r = await call({ location: "98101", types: ["store"] });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(texts(r)[1]).types[0].candidates.length).toBeGreaterThan(0);
  });

  it.each([
    ["an empty location", { location: " " }],
    ["six types", { location: "98101", types: ["a", "b", "c", "d", "e", "f"] }],
    ["an unknown group", { location: "98101", per: "dogs" }],
    ["a radius above ten miles", { location: "98101", radius_miles: 11 }],
  ])("rejects %s", async (_name, args) => {
    const { call } = await connect();
    const r = await call(args).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
    expect(r.isError).toBe(true);
  });

  it("accepts a ZIP sent as a number", async () => {
    const { call } = await connect();
    expect((await call({ location: 98101, types: ["libraries"] })).isError).toBeFalsy();
  });

  it("says how to build the places data when it is missing, and leaves other tools working", async () => {
    const { call } = await connect({ openPlaces: async () => { throw new PlacesMissingError("/nowhere"); } });
    const r = await call({ location: "98101" });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toBe(
      "The places data has not been built on this server. Run: npm run build && npm run build:places",
    );
    expect((await call({ location: "98101" }, "profile_place")).isError).toBeFalsy();
  });

  it("shares one per-minute ceiling with profile_place", async () => {
    const { call } = await connect({ maxPerMinute: 1 });
    expect((await call({ location: "98101" }, "profile_place")).isError).toBeFalsy();
    const r = await call({ location: "98101", types: ["libraries"] });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toBe("The Census connector is at its request limit. Try again in a minute.");
  });

  describe("privacy", () => {
    it("keeps the address out of logs and errors when the lookup fails", async () => {
      const { call, logs } = await connect({ geocoder: broken });
      const r = await call({ location: SECRET, types: ["libraries"] });
      expect(r.isError).toBe(true);
      expect(texts(r).join(" ")).toBe("The address lookup service did not respond. Try a ZIP or a place name.");
      expect(JSON.stringify(logs)).not.toMatch(/secret/i);
    });

    it("does not repeat the input when something unexpected breaks", async () => {
      const { call, logs } = await connect({
        openPlaces: async () => {
          const p = await openPlaces(placesFixture.dir);
          return { ...p, around: async () => { throw new Error(`boom ${SECRET}`); } };
        },
      });
      const r = await call({ location: SECRET, types: ["libraries"] });
      expect(r.isError).toBe(true);
      expect(texts(r).join(" ")).not.toMatch(/secret/i);
      expect(JSON.stringify(logs)).not.toMatch(/secret/i);
    });
  });
});
