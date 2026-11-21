import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataMissingError, geoId, openStore, type Store } from "../src/profile/store.js";
import { CENTRE, TRACT, buildFixture } from "./profile-fixture.js";

let fixture: Awaited<ReturnType<typeof buildFixture>>;
let store: Store;

beforeAll(async () => {
  fixture = await buildFixture();
  store = await openStore(fixture.dir);
});

afterAll(async () => {
  await store.close();
  await fixture.cleanup();
});

describe("geoId", () => {
  it("builds the four Census geography ids", () => {
    expect(geoId("us")).toBe("0100000US");
    expect(geoId("state", "53")).toBe("0400000US53");
    expect(geoId("county", "53033")).toBe("0500000US53033");
    expect(geoId("tract", "53033008102")).toBe("1400000US53033008102");
  });
});

describe("openStore", () => {
  it("reads the manifest", () => {
    expect(store.manifest.acs_year).toBe(2024);
    expect(store.manifest.period).toBe("2020-2024");
  });

  it("says how to build the data when it is missing", async () => {
    await expect(openStore("/nonexistent/acs")).rejects.toThrow(DataMissingError);
    await expect(openStore("/nonexistent/acs")).rejects.toThrow(/npm run build:acs/);
  });
});

describe("rows", () => {
  it("returns rows for the ids that exist, as numbers", async () => {
    const county = geoId("county", "53033");
    const rows = await store.rows("B22003", [county, "1400000US00000000000"]);
    expect([...rows.keys()]).toEqual([county]);
    expect(rows.get(county)!.B22003_E001).toBe(10000);
    expect(rows.get(county)!.B22003_M002).toBe(100);
  });

  it("returns nothing for an empty id list", async () => {
    expect((await store.rows("B22003", [])).size).toBe(0);
  });

  it("refuses a table the profile does not use", async () => {
    await expect(store.rows("B99999; DROP", [geoId("us")])).rejects.toThrow(/not part of the profile/);
  });
});

describe("tractsNear", () => {
  it("returns tracts inside the radius, nearest first", async () => {
    const r = await store.tractsNear(CENTRE.lat, CENTRE.lon, 1, 500);
    expect(r.tracts.map((t) => t.geoid)).toEqual([TRACT.A, TRACT.B]);
    expect(r.inRange).toBe(2);
    expect(r.tracts[0].miles).toBeCloseTo(0.3, 1);
    expect(r.tracts[1].miles).toBeCloseTo(0.8, 1);
  });

  it("applies the limit but still reports how many were in range", async () => {
    const r = await store.tractsNear(CENTRE.lat, CENTRE.lon, 1, 1);
    expect(r.tracts.map((t) => t.geoid)).toEqual([TRACT.A]);
    expect(r.inRange).toBe(2);
  });

  it("returns an empty list when nothing is in range", async () => {
    const r = await store.tractsNear(40, -100, 1, 500);
    expect(r).toEqual({ tracts: [], inRange: 0 });
  });
});

describe("nearestTract", () => {
  it("finds the closest tract however far", async () => {
    const t = await store.nearestTract(CENTRE.lat + 50 / 69.05, CENTRE.lon);
    expect(t!.geoid).toBe(TRACT.D);
    expect(t!.miles).toBeCloseTo(44, 0);
  });
});

describe("zip", () => {
  it("finds a ZIP code area", async () => {
    const z = await store.zip("98101");
    expect(z).toMatchObject({ geoid: "98101", lat: 47.6101, lon: -122.3344 });
  });

  it("returns null for a ZIP with no area", async () => {
    expect(await store.zip("00000")).toBeNull();
  });
});

describe("places", () => {
  it("matches by name whatever the case, without the type suffix", async () => {
    const r = await store.places("seattle");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "Seattle city", state: "WA" });
  });

  it("returns every place sharing a name", async () => {
    expect((await store.places("Springfield")).map((p) => p.state).sort()).toEqual(["IL", "MO"]);
  });

  it("narrows by state", async () => {
    const r = await store.places("Springfield", "il");
    expect(r.map((p) => p.state)).toEqual(["IL"]);
  });

  it("finds a city whose own name ends in City", async () => {
    expect((await store.places("Kansas City", "MO")).map((p) => p.name)).toEqual(["Kansas City city"]);
    expect((await store.places("Kansas City")).map((p) => p.state).sort()).toEqual(["KS", "MO"]);
    expect((await store.places("Kansas", "AL")).map((p) => p.name)).toEqual(["Kansas town"]);
  });

  it("does not mistake Union City for Union", async () => {
    expect((await store.places("Union City", "NJ")).map((p) => p.name)).toEqual(["Union City city"]);
    expect((await store.places("Union", "NJ")).map((p) => p.name)).toEqual(["Union CDP"]);
  });

  it("finds consolidated cities under their everyday names", async () => {
    expect((await store.places("Nashville", "TN"))[0].name).toMatch(/^Nashville-Davidson/);
    expect((await store.places("Honolulu", "HI"))[0].name).toBe("Urban Honolulu CDP");
    expect((await store.places("Boise", "ID"))[0].name).toBe("Boise City city");
    expect((await store.places("Boise City", "ID"))[0].name).toBe("Boise City city");
  });

  it("tells apart two places sharing a name in one state by their full names", async () => {
    expect(await store.places("Pewaukee", "WI")).toHaveLength(2);
    expect((await store.places("Pewaukee city", "WI")).map((p) => p.name)).toEqual(["Pewaukee city"]);
    expect((await store.places("Pewaukee village", "WI")).map((p) => p.name)).toEqual(["Pewaukee village"]);
  });

  it("returns nothing for an unknown name", async () => {
    expect(await store.places("Nowhereville")).toEqual([]);
  });
});

describe("defaultLocation", () => {
  it("is data/acs inside the project, wherever the server was started from", async () => {
    const { defaultLocation } = await import("../src/profile/store.js");
    const { isAbsolute } = await import("node:path");
    const loc = defaultLocation({});
    expect(isAbsolute(loc)).toBe(true);
    expect(loc.endsWith("/data/acs")).toBe(true);
  });

  it("is CENSUS_DATA_DIR when set", async () => {
    const { defaultLocation } = await import("../src/profile/store.js");
    expect(defaultLocation({ CENSUS_DATA_DIR: "https://example.org/acs" })).toBe("https://example.org/acs");
  });
});

describe("settings", () => {
  it("caps DuckDB's memory and threads", async () => {
    const s = await store.settings();
    expect(s.threads).toBe(2);
    // DuckDB reports the limit in its own units (for example "244.1 MiB").
    const [, n, unit] = /^([\d.]+)\s*(\w+)$/.exec(s.memory_limit)!;
    const mb = Number(n) * ({ MiB: 1.048576, MB: 1, GiB: 1073.74, GB: 1000 } as Record<string, number>)[unit];
    expect(mb).toBeGreaterThan(250);
    expect(mb).toBeLessThan(262);
  });
});
