import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rate } from "../src/places/compare.js";
import { NearbyInputError, nearbyPlaces, type Nearby } from "../src/places/nearby.js";
import { openPlaces, type PlacesStore } from "../src/places/store.js";
import type { Located } from "../src/profile/locate.js";
import { openStore, type Store } from "../src/profile/store.js";
import { openSnap, type SnapStore } from "../src/snap/store.js";
import { SNAP_ATTRIBUTION, SNAP_MISSING, SNAP_NOTE } from "../src/snap/words.js";
import { buildPlacesFixture } from "./places-fixture.js";
import { CENTRE, TRACT, buildFixture } from "./profile-fixture.js";
import { buildSnapFixture } from "./snap-fixture.js";

// Profile fixture: households on SNAP are 100 in tract A, 300 in B, 1,000 in
// the county, 10,000 in the state and 100,000 in the nation. At 1 mile from
// tract A the area is tracts A and B: 400 households on SNAP.
let profileFixture: Awaited<ReturnType<typeof buildFixture>>;
let smallFixture: Awaited<ReturnType<typeof buildFixture>>;
let placesFixture: Awaited<ReturnType<typeof buildPlacesFixture>>;
let snapFixture: Awaited<ReturnType<typeof buildSnapFixture>>;
let store: Store;
let small: Store;
let places: PlacesStore;
let snap: SnapStore;

beforeAll(async () => {
  profileFixture = await buildFixture();
  // Tract D with only 50 households on SNAP: too few to rate.
  smallFixture = await buildFixture({ [`1400000US${TRACT.D}`]: { B22003_002: [50, 10] } });
  placesFixture = await buildPlacesFixture();
  snapFixture = await buildSnapFixture();
  store = await openStore(profileFixture.dir);
  small = await openStore(smallFixture.dir);
  places = await openPlaces(placesFixture.dir);
  snap = await openSnap(snapFixture.dir);
});
afterAll(async () => {
  for (const s of [store, small, places, snap]) await s.close();
  for (const f of [profileFixture, smallFixture, placesFixture, snapFixture]) await f.cleanup();
});

const at = (anchor: string): Located => ({
  kind: "address", label: "123 MAIN ST", lat: CENTRE.lat, lon: CENTRE.lon, anchor, exact: true,
});
const ask = (types: string[], opts: Record<string, unknown> = {}, anchor: string = TRACT.A, profile: Store = store) =>
  nearbyPlaces(at(anchor), profile, places, { types, snap, ...opts });
const entry = (r: Nearby, asked: string) => r.types!.find((t) => t.asked === asked) as any;

describe("a SNAP request", () => {
  it("leads with full-line stores, rated per household on SNAP", async () => {
    const r = await ask(["SNAP stores"]);
    const a = entry(r, "SNAP stores");
    expect(a.source).toBe("USDA SNAP retailers");
    expect(a.as_of).toBe("2026-11-05");
    expect(a.full_line).toEqual({
      here: { count: 3, rate: 7.5 },
      county: { count: 25, rate: 25 },
      state: { count: 250, rate: 25 },
      us: { count: 2500, rate: 25 },
      expected_at_county_rate: 10,
      vs_county: "about 30% of the county rate",
    });
  });

  it("gives all retailers beside them", async () => {
    const a = entry(await ask(["SNAP stores"]), "SNAP stores");
    expect(a.all_retailers.here).toEqual({ count: 8, rate: 20 });
    expect(a.all_retailers.county.count).toBe(90);
    expect(a.all_retailers.expected_at_county_rate).toBe(36);
    expect(a.all_retailers.vs_county).toBe("about 22% of the county rate");
  });

  it("lists every USDA store type, largest here first", async () => {
    const a = entry(await ask(["SNAP stores"]), "SNAP stores");
    expect(a.by_type.map((t: any) => [t.type, t.here.count])).toEqual([
      ["Convenience Store", 4],
      ["Grocery Store", 1],
      ["Specialty Store", 1],
      ["Super Store", 1],
      ["Supermarket", 1],
      ["Farmers and Markets", 0],
      ["Other", 0],
      ["Restaurant Meals Program", 0],
    ]);
    const conv = a.by_type[0];
    expect(conv.county).toEqual({ count: 40, rate: 40 });
    expect(typeof conv.vs_county).toBe("string");
  });

  it("names the nearest full-line stores only", async () => {
    const a = entry(await ask(["SNAP stores"]), "SNAP stores");
    expect(a.nearest_full_line.map((n: any) => n.name)).toEqual(["Fresh Mart", "Corner Grocery", "Big Box"]);
  });

  it("describes the SNAP group, credits USDA and adds the note once", async () => {
    const r = await ask(["SNAP stores", "EBT"]);
    expect(r.per.group).toBe("people");
    expect(r.per.usda).toMatchObject({ group: "snap_households", unit: 1000, here: 400, county: 1000, state: 10000, us: 100000 });
    expect(r.data.snap).toEqual({
      source: "USDA SNAP retailers",
      as_of: "2026-11-05",
      built: "2026-11-22",
      attribution: SNAP_ATTRIBUTION("2026-11-05"),
    });
    expect(r.notes.filter((n) => n === SNAP_NOTE("2026-11-05"))).toHaveLength(1);
  });

  it("is rated per the group asked for", async () => {
    const r = await ask(["SNAP stores"], { per: "children" });
    const a = entry(r, "SNAP stores");
    expect(a.full_line.here.rate).toBe(rate(3, r.per.here, 1000));
    expect(r.per.usda).toBeUndefined();
  });

  it("keeps unknown store types out of full-line", async () => {
    const a = entry(await ask(["SNAP stores"], { radiusMiles: 0 }, TRACT.C), "SNAP stores");
    expect(a.by_type).toHaveLength(9);
    expect(a.by_type.find((t: any) => t.type === "Mobile Market").here.count).toBe(1);
    expect(a.all_retailers.here.count).toBe(2);
    expect(a.full_line.here.count).toBe(1);
  });

  it("gives counts without rates where there are too few households on SNAP", async () => {
    const r = await ask(["SNAP stores"], { radiusMiles: 0 }, TRACT.D, small);
    const a = entry(r, "SNAP stores");
    expect(a.full_line.here).toEqual({ count: 1, rate: null });
    expect(a.full_line.vs_county).toBe("too few households on SNAP here to give a rate");
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
});

describe("grocery answers", () => {
  it.each(["grocery stores", "supermarkets"])("%j carry USDA's full-line count", async (words) => {
    const a = entry(await ask([words]), words);
    expect(a.matched).toBe("shopping > food_and_beverage_store > grocery_store");
    expect(a.official).toEqual({
      source: "USDA SNAP retailers",
      as_of: "2026-11-05",
      what: "SNAP-authorised supermarkets, super stores and grocery stores",
      here: { count: 3, rate: 7.5 },
      county: { count: 25, rate: 25 },
      state: { count: 250, rate: 25 },
      us: { count: 2500, rate: 25 },
      expected_at_county_rate: 10,
      vs_county: "about 30% of the county rate",
    });
  });

  it.each(["asian grocery stores", "libraries"])("%j do not", async (words) => {
    const r = await ask([words]);
    expect(entry(r, words).official).toBeUndefined();
    expect(r.data.snap).toBeUndefined();
    expect(r.per.usda).toBeUndefined();
    expect(r.notes).not.toContain(SNAP_NOTE("2026-11-05"));
  });
});

describe("mixed requests", () => {
  it("answer each entry from its own source, in order", async () => {
    const r = await ask(["SNAP stores", "libraries", "grocery stores"]);
    expect(r.types!.map((t) => t.asked)).toEqual(["SNAP stores", "libraries", "grocery stores"]);
    expect(entry(r, "libraries").matched).toBe("education > library");
    expect(entry(r, "grocery stores").official.here.count).toBe(3);
    expect(r.notes.filter((n) => n === SNAP_NOTE("2026-11-05"))).toHaveLength(1);
    expect(r.per.usda?.group).toBe("snap_households");
  });

  it("count SNAP entries toward the limit of five", async () => {
    await expect(ask(["SNAP stores", "a", "b", "c", "d", "e"])).rejects.toBeInstanceOf(NearbyInputError);
  });
});

describe("without SNAP data", () => {
  it("SNAP entries say so and grocery answers carry no official count", async () => {
    const r = await ask(["SNAP stores", "grocery stores"], { snap: null });
    expect(entry(r, "SNAP stores")).toEqual({ asked: "SNAP stores", source: "USDA SNAP retailers", note: SNAP_MISSING });
    expect(entry(r, "grocery stores").official).toBeUndefined();
    expect(entry(r, "grocery stores").here.count).toBeGreaterThan(0);
    expect(r.data.snap).toBeUndefined();
    expect(r.notes).not.toContain(SNAP_NOTE("2026-11-05"));
  });
});

describe("in Puerto Rico", () => {
  it("says it is outside SNAP rather than giving a zero", async () => {
    const r = await ask(["SNAP stores", "grocery stores"], { radiusMiles: 0 }, "72127000100");
    expect(entry(r, "SNAP stores")).toEqual({
      asked: "SNAP stores",
      source: "USDA SNAP retailers",
      note: "Puerto Rico does not take part in SNAP; it runs its own nutrition assistance program, and its stores are not in USDA's SNAP list.",
    });
    expect(entry(r, "grocery stores").official).toBeUndefined();
    expect(r.per.usda).toBeUndefined();
  });
});
