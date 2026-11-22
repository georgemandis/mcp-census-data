import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NearbyInputError, nearbyPlaces } from "../src/places/nearby.js";
import { openPlaces, type PlacesStore } from "../src/places/store.js";
import type { Located } from "../src/profile/locate.js";
import { openStore, type Store } from "../src/profile/store.js";
import { PATHS, buildPlacesFixture } from "./places-fixture.js";
import { CENTRE, TRACT, buildFixture } from "./profile-fixture.js";

// Profile fixture: tract A has 1,000 people and B 2,000; the county 10,000,
// the state 100,000 and the nation 1,000,000. Every non-total cell is 100 in
// A, 300 in B, 1,000 in the county.
let profileFixture: Awaited<ReturnType<typeof buildFixture>>;
let placesFixture: Awaited<ReturnType<typeof buildPlacesFixture>>;
let store: Store;
let places: PlacesStore;

beforeAll(async () => {
  // Tract C's count of households on SNAP is too noisy to use: 150 give or take 150.
  profileFixture = await buildFixture({ [`1400000US${TRACT.C}`]: { B22003_002: [150, 150] } });
  placesFixture = await buildPlacesFixture();
  store = await openStore(profileFixture.dir);
  places = await openPlaces(placesFixture.dir);
});
afterAll(async () => {
  await store.close();
  await places.close();
  await profileFixture.cleanup();
  await placesFixture.cleanup();
});

const at = (anchor: string, over: Partial<Located> = {}): Located => ({
  kind: "address", label: "123 MAIN ST", lat: CENTRE.lat, lon: CENTRE.lon, anchor, exact: true, ...over,
});
const ask = (types: string[] | undefined, opts: Record<string, unknown> = {}, anchor: string = TRACT.A) =>
  nearbyPlaces(at(anchor), store, places, { types, ...opts });
const entry = (r: any, asked: string) => r.types.find((t: any) => t.asked === asked);

describe("nearbyPlaces: a named type", () => {
  it("describes the location, the area and what the rate is per", async () => {
    const r = await ask(["libraries"]);
    expect(r.location).toEqual({
      input: "address", label: "123 MAIN ST", lat: CENTRE.lat, lon: CENTRE.lon,
      anchor_tract: TRACT.A, county: "King County, Washington", state: "Washington",
    });
    expect(r.area).toEqual({ radius_miles: 1, tracts: 2, population: 3000, tracts_in_range: 2, covered_miles: 1 });
    expect(r.per).toEqual({
      group: "people", label: "residents", unit: 10000,
      here: 3000, county: 10000, state: 100000, us: 1000000, reliability: "reliable",
    });
    expect(r.data).toEqual({
      source: "Overture Maps Places",
      release: "2026-11-18.0",
      built: "2026-11-21",
      attribution: "Overture Maps Foundation, overturemaps.org",
    });
    expect(r.overview).toBeUndefined();
  });

  it("gives the count and rate here beside the county, state and US", async () => {
    // 2 libraries for 3,000 people = 6.67 per 10,000; the county has 20 for 10,000 people,
    // so this area would have 6 at the county's rate.
    expect(entry(await ask(["libraries"]), "libraries")).toEqual({
      asked: "libraries",
      matched: PATHS.library,
      here: { count: 2, rate: 6.67 },
      county: { count: 20, rate: 20 },
      state: { count: 200, rate: 20 },
      us: { count: 2000, rate: 20 },
      expected_at_county_rate: 6,
      vs_county: "not clearly different from the county",
      nearest: [
        { name: "Central Library", type: "library", address: "100 Main St, Seattle, WA", miles: 0.1 },
        { name: "North Library", type: "library", address: "700 Main St, Seattle, WA", miles: 0.7 },
      ],
    });
  });

  it("takes in sub-types and shows each place's own type", async () => {
    const g = entry(await ask(["grocery stores"]), "grocery stores");
    expect(g.here.count).toBe(3);
    expect(g.county.count).toBe(50);
    expect(g.expected_at_county_rate).toBe(15);
    expect(g.vs_county).toBe("about 20% of the county rate");
    expect(g.nearest.map((n: any) => n.type)).toEqual(["grocery_store", "asian_grocery_store", "grocery_store"]);
  });

  it("says about the same, or how many times, when the numbers support it", async () => {
    expect(entry(await ask(["cafes"]), "cafes").vs_county).toBe("about the same as the county");
    // Tract A alone: 12 bars where 5 would be expected.
    const bars = entry(await ask(["bars"], { radiusMiles: 0 }), "bars");
    expect(bars.here).toEqual({ count: 12, rate: 120 });
    expect(bars.expected_at_county_rate).toBe(5);
    expect(bars.vs_county).toBe("about 2.4 times the county rate");
    expect(bars.nearest).toHaveLength(5);
  });

  it("gives no ratio when the county's own number is tiny", async () => {
    // 6 cafes where 2 would be expected: more, but 2 is too few to build a ratio on.
    const cafes = entry(await ask(["cafes"], { radiusMiles: 0 }), "cafes");
    expect(cafes.expected_at_county_rate).toBe(2);
    expect(cafes.vs_county).toBe("more here than the county rate would give, but the numbers are too small to say how much");
  });

  it("names a clear absence", async () => {
    const f = entry(await ask(["food banks"]), "food banks");
    expect(f.here).toEqual({ count: 0, rate: 0 });
    expect(f.vs_county).toBe("none found here; about 12 would be expected at the county rate");
    expect(f.nearest).toEqual([]);
  });

  it("will not compare small numbers, and suggests a wider radius", async () => {
    const r = await ask(["fire stations"]);
    expect(entry(r, "fire stations").vs_county).toBe("too few to compare");
    expect(r.notes).toContain("Try a wider radius for rarer types.");
    expect((await ask(["cafes"])).notes).not.toContain("Try a wider radius for rarer types.");
  });

  it("returns candidates and counts nothing when the words are unclear", async () => {
    const r = await ask(["store", "libraries"]);
    const s = entry(r, "store");
    expect(Object.keys(s)).toEqual(["asked", "candidates", "note"]);
    expect(s.candidates.map((c: any) => c.type)).toContain("grocery_store");
    expect(s.candidates[0]).toEqual({ type: expect.any(String), path: expect.any(String), us_count: expect.any(Number) });
    expect(s.note).toMatch(/Nothing was counted/);
    expect(entry(r, "libraries").here.count).toBe(2);
  });

  it("accepts five types and refuses a sixth", async () => {
    const five = await ask(["libraries", "cafes", "parks", "restaurants", "food banks"]);
    expect(five.types).toHaveLength(5);
    const err = await ask(["a", "b", "c", "d", "e", "f"]).catch((e) => e);
    expect(err).toBeInstanceOf(NearbyInputError);
    expect(err.message).toMatch(/at most 5/);
  });

  it("shows a place without a name or address without the word null", async () => {
    const r = await ask(["parks"]);
    expect(entry(r, "parks").nearest).toEqual([{ name: null, type: "park", address: null, miles: 0.4 }]);
    expect(JSON.stringify(r)).not.toContain('"null"');
  });
});

describe("nearbyPlaces: per a group", () => {
  it("rates per 1,000 households on SNAP", async () => {
    // 400 SNAP households here, 1,000 in the county.
    const r = await ask(["grocery stores"], { per: "snap_households" });
    expect(r.per).toMatchObject({ group: "snap_households", label: "households on SNAP", unit: 1000, here: 400, county: 1000 });
    const g = entry(r, "grocery stores");
    expect(g.here).toEqual({ count: 3, rate: 7.5 });
    expect(g.county).toEqual({ count: 50, rate: 50 });
    expect(g.expected_at_county_rate).toBe(20);
    expect(g.vs_county).toBe("about 15% of the county rate");
  });

  it("counts people 65 and over from their twelve age cells", async () => {
    const r = await ask(["libraries"], { per: "older_adults" });
    expect(r.per).toMatchObject({ here: 4800, county: 12000, unit: 1000 });
  });

  it("gives counts but no rate when the group here is under 100", async () => {
    // Tract Z has nobody in it.
    const r = await ask(["libraries"], { per: "snap_households", radiusMiles: 0 }, TRACT.Z);
    const l = entry(r, "libraries");
    expect(r.per.here).toBe(0);
    expect(l.here).toEqual({ count: 0, rate: null });
    expect(l.county).toEqual({ count: 20, rate: 20 });
    expect(l.expected_at_county_rate).toBeNull();
    expect(l.vs_county).toBe("too few households on SNAP here to give a rate");
  });

  it("gives counts but no rate or comparison when the group's size is unreliable", async () => {
    const r = await ask(["libraries"], { per: "snap_households", radiusMiles: 0 }, TRACT.C);
    expect(r.per).toMatchObject({ here: 150, reliability: "unreliable" });
    const l = entry(r, "libraries");
    expect(l.here).toEqual({ count: 1, rate: null });
    expect(l.expected_at_county_rate).toBeNull();
    expect(l.vs_county).toBe("the number of households on SNAP here is too uncertain to compare");
    expect(r.notes.some((n: string) => /too uncertain/.test(n))).toBe(true);
  });
});

describe("nearbyPlaces: an area with no population figures", () => {
  it("returns counts and nearest places, without rates", async () => {
    const r = await ask(["libraries"], { radiusMiles: 0 }, TRACT.M);
    expect(r.area.population).toBeNull();
    expect(r.per.here).toBeNull();
    expect(entry(r, "libraries")).toMatchObject({
      here: { count: 0, rate: null },
      vs_county: "no population figures here to compare with",
    });
    expect(r.notes).toContain("There are no population figures for this area, so only counts are given.");
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
});

describe("nearbyPlaces: overview", () => {
  it("lists broad types that stand out against the county", async () => {
    // Tract A alone: 1,000 people, a tenth of the county.
    const r = await ask(undefined, { radiusMiles: 0 });
    expect(r.types).toBeUndefined();
    const o = r.overview!;
    // Bars: 12 where 5 would be expected. Cafes (6 against 2) are left out: 2 is too few to compare with.
    expect(o.over.map((x: any) => x.type)).toEqual(["bar"]);
    expect(o.over[0]).toEqual({
      type: "bar",
      here: { count: 12, rate: 120 },
      county: { count: 50, rate: 50 },
      vs_county: "about 2.4 times the county rate",
    });
    // Restaurants 3 of an expected 40, parks 1 of 6. Food stores (2 of 5) are within chance.
    expect(o.under.map((x: any) => x.type)).toEqual(["restaurant", "park"]);
    expect(o.under[0].vs_county).toBe("about 8% of the county rate");
    expect(o.commonest.map((x: any) => [x.type, x.here.count]).slice(0, 3)).toEqual([
      ["bar", 12], ["cafe", 6], ["restaurant", 3],
    ]);
    expect(o.none_found_here).toEqual([]);
  });

  it("lists broad types that are absent where several would be expected", async () => {
    const o = (await ask(undefined)).overview!;
    expect(o.none_found_here).toEqual([
      {
        type: "social_or_community_service",
        here: { count: 0, rate: 0 },
        county: { count: 40, rate: 40 },
        vs_county: "none found here; about 12 would be expected at the county rate",
      },
    ]);
    expect(o.over).toEqual([]);
  });

  it("caps each list at eight", async () => {
    const o = (await ask(undefined)).overview!;
    for (const list of [o.over, o.under, o.commonest, o.none_found_here]) expect(list.length).toBeLessThanOrEqual(8);
  });
});

describe("nearbyPlaces: notes", () => {
  it("always carries the four cautions", async () => {
    const r = await ask(["libraries"]);
    expect(r.notes.slice(0, 4)).toEqual([
      "Places come from Overture Maps, a merged open dataset. Types are sometimes wrong and coverage varies from place to place, so counts are approximate.",
      "Only places marked open with high confidence are counted.",
      "A lower rate than the county can mean fewer places or less complete mapping.",
      "Distances are straight-line.",
    ]);
  });

  it("adds the single-tract and centre-point notes when they apply", async () => {
    const r = await nearbyPlaces(at(TRACT.A, { kind: "zip", label: "ZIP code area 98101", exact: false }), store, places, {
      types: ["libraries"], radiusMiles: 0,
    });
    expect(r.notes).toContain("Only one census tract falls in this area, so figures are for that tract alone.");
    expect(r.notes).toContain("The area is centred on the middle of ZIP code area 98101; it is not the whole of it.");
  });

  it("says when the area stopped at the tract limit", async () => {
    const r = await ask(["libraries"], { radiusMiles: 10, maxTracts: 1 });
    expect(r.area).toMatchObject({ tracts: 1, tracts_in_range: 6 });
    expect(r.notes.some((n: string) => /nearest 1 /.test(n))).toBe(true);
  });
});

describe("baselineNotes", () => {
  it("says nothing when the area sits inside its county and is a small part of it", async () => {
    const { baselineNotes } = await import("../src/places/nearby.js");
    expect(baselineNotes(new Map([["53033", 3000]]), "53033", 10000, "King County, Washington")).toEqual([]);
  });

  it("warns when much of the area lies outside the county it is compared with", async () => {
    const { baselineNotes } = await import("../src/places/nearby.js");
    const notes = baselineNotes(new Map([["51600", 25000], ["51059", 81000]]), "51600", 25026, "Fairfax city, Virginia");
    expect(notes[0]).toBe(
      "About 76% of this area's residents live outside Fairfax city, Virginia, so the county comparison is a rough guide. The state figures may be a fairer yardstick.",
    );
  });

  it("warns when the area is most of its county", async () => {
    const { baselineNotes } = await import("../src/places/nearby.js");
    expect(baselineNotes(new Map([["30017", 10002]]), "30017", 11961, "Custer County, Montana")).toEqual([
      "This area holds about 84% of the residents of Custer County, Montana, so comparing it with the county mostly compares it with itself.",
    ]);
  });

  it("is silent without population figures", async () => {
    const { baselineNotes } = await import("../src/places/nearby.js");
    expect(baselineNotes(new Map(), "72127", null, null)).toEqual([]);
  });
});

describe("nearbyPlaces: in a territory", () => {
  it("says places are kept on confidence alone", async () => {
    const r = await nearbyPlaces(at("72127000100"), store, places, { types: ["libraries"], radiusMiles: 0 });
    expect(r.notes[1]).toBe(
      "Overture does not record whether places here are open, so places are counted on confidence alone, and coverage is thinner than in the states. Comparisons with US figures are weak.",
    );
    expect(r.notes).not.toContain("Only places marked open with high confidence are counted.");
  });
});
