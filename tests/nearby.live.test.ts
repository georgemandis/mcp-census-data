/**
 * Checks `nearby_places` against the real built data. Runs only when both
 * the profile data (npm run build:acs) and the places data
 * (npm run build:places) exist. Uses no network and no key.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { nearbyPlaces, type Nearby, type TypeAnswer } from "../src/places/nearby.js";
import { defaultPlacesLocation, openPlaces, type PlacesStore } from "../src/places/store.js";
import { isUnder, matchType, type TypeNode } from "../src/places/types.js";
import { selectArea } from "../src/profile/area.js";
import type { Geocoder } from "../src/profile/geocode.js";
import { locate } from "../src/profile/locate.js";
import { defaultLocation, openStore, type Store } from "../src/profile/store.js";

const dir = defaultPlacesLocation();
const built =
  existsSync(join(dir, "manifest.json")) && existsSync(join(defaultLocation(), "manifest.json"));

const noGeocoder: Geocoder = {
  address: async () => { throw new Error("geocoder used"); },
  coordinates: async () => { throw new Error("geocoder used"); },
};

describe.skipIf(!built)("nearby_places on built data", () => {
  let store: Store;
  let places: PlacesStore;
  let nodes: TypeNode[];

  const at = (location: string) => locate(location, { store, geocoder: noGeocoder });
  const ask = async (location: string, opts: Parameters<typeof nearbyPlaces>[3] = {}): Promise<Nearby> =>
    nearbyPlaces(await at(location), store, places, opts);
  const first = (r: Nearby) => r.types![0] as TypeAnswer;
  const direct = async (sql: string) => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    const rows = (await db.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[];
    db.closeSync();
    return rows;
  };

  beforeAll(async () => {
    store = await openStore();
    places = await openPlaces();
    nodes = await places.types();
  });
  afterAll(async () => {
    await store.close();
    await places.close();
  });

  test("the data is the pinned Overture release, at national scale", () => {
    expect(places.manifest.release).toBe("2026-11-18.0");
    expect(places.manifest.places).toBeGreaterThan(11_000_000);
    expect(places.manifest.places).toBeLessThan(13_500_000);
    expect(places.manifest.dropped).toBeLessThan(places.manifest.places * 0.01);
    expect(nodes.length).toBeGreaterThan(1500);
  });

  // A count far outside its range means the filter, the type tree or the matching has changed.
  test.each([
    ["libraries", 15_000, 30_000],
    ["grocery stores", 50_000, 90_000],
    ["food banks", 3_000, 6_000],
    ["fire stations", 20_000, 45_000],
    ["pharmacies", 30_000, 60_000],
    ["hospitals", 15_000, 40_000],
  ])("national count of %s is between %i and %i", (words, low, high) => {
    const m = matchType(words, nodes);
    expect("path" in m, `${words} did not match`).toBe(true);
    const n = (m as TypeNode).n;
    expect(n).toBeGreaterThanOrEqual(low);
    expect(n).toBeLessThanOrEqual(high);
  });

  // Everyday words and the part of the type tree each should land in.
  test.each([
    ["libraries", "library"], ["grocery stores", "grocery_store"], ["supermarkets", "grocery_store"],
    ["pharmacies", "pharmacy"], ["tutors", "tutoring_service"], ["fire stations", "fire_station"],
    ["police stations", "police_station"], ["food banks", "food_bank"], ["food pantries", "food_bank"],
    ["churches", "christian_place_of_worship"], ["mosques", "muslim_place_of_worship"],
    ["synagogues", "jewish_place_of_worship"], ["places of worship", "place_of_worship"],
    ["daycare", "child_care_and_day_care"], ["child care", "child_care_and_day_care"],
    ["laundromats", "laundromat"], ["banks", "bank"], ["bars", "bar"], ["gyms", "gym"],
    ["parks", "park"], ["playgrounds", "playground"], ["hospitals", "hospital"],
    ["dentists", "dental_clinic"], ["doctors", "doctors_office"], ["schools", "school"],
    ["elementary schools", "elementary_school"], ["colleges", "college_university"],
    ["coffee shops", "coffee_shop"], ["restaurants", "restaurant"], ["post offices", "post_office"],
    ["community centers", "community_center"], ["urgent care", "urgent_care_clinic"],
    ["thrift stores", "second_hand_store"], ["farmers markets", "farmers_market"],
    ["bus stations", "bus_station"], ["homeless shelters", "homeless_shelter"],
    ["museums", "museum"], ["bakeries", "bakery"], ["liquor stores", "liquor_store"],
    ["pinball", "arcade"],
  ])("%j is counted as %s", (words, name) => {
    const m = matchType(words, nodes);
    expect("path" in m ? (m as TypeNode).name : (m as { candidates: TypeNode[] }).candidates.map((c) => c.name)).toBe(name);
  });

  test("words with no clear type return candidates, not a count", () => {
    for (const words of ["stuff", "senior centers", "store"]) {
      expect("candidates" in matchType(words, nodes), words).toBe(true);
    }
  });

  test("every everyday name points at a type that exists and is not tiny", () => {
    for (const words of ["churches", "mosques", "synagogues", "dentists", "daycare", "day care", "childcare", "supermarkets", "thrift stores", "thrift shops", "food pantries", "colleges", "universities", "pinball"]) {
      const m = matchType(words, nodes);
      expect("path" in m, words).toBe(true);
      expect((m as TypeNode).n, words).toBeGreaterThan(1000);
    }
  });

  test("the area count equals a direct query of the places file", async () => {
    const located = await at("98101");
    const area = await selectArea(located, store, 1);
    const r = await ask("98101", { types: ["libraries", "grocery stores"] });
    for (const answer of r.types as TypeAnswer[]) {
      const [row] = await direct(
        `SELECT count(*) AS n FROM read_parquet('${join(dir, "places.parquet")}')
         WHERE tract IN (${area.tracts.map((t) => `'${t}'`).join(", ")})
           AND (path = '${answer.matched}' OR path LIKE '${answer.matched} > %')`,
      );
      expect(answer.here.count).toBe(Number(row.n));
      expect(answer.here.count).toBeGreaterThan(0);
    }
  });

  test("the county, state and national counts equal the places file grouped up", async () => {
    const r = await ask("98101", { types: ["libraries"] });
    const a = first(r);
    const file = `read_parquet('${join(dir, "places.parquet")}')`;
    const under = `(path = '${a.matched}' OR path LIKE '${a.matched} > %')`;
    const [county] = await direct(`SELECT count(*) AS n FROM ${file} WHERE tract LIKE '53033%' AND ${under}`);
    const [state] = await direct(`SELECT count(*) AS n FROM ${file} WHERE tract LIKE '53%' AND ${under}`);
    const [us] = await direct(`SELECT count(*) AS n FROM ${file} WHERE ${under}`);
    expect(a.county.count).toBe(Number(county.n));
    expect(a.state.count).toBe(Number(state.n));
    expect(a.us.count).toBe(Number(us.n));
  });

  test("every place's type path is in the type list, and nearest places lie under the node asked for", async () => {
    const r = await ask("98101", { types: ["grocery stores"] });
    const a = first(r);
    expect(a.nearest.length).toBeGreaterThan(0);
    const miles = a.nearest.map((n) => n.miles);
    expect([...miles].sort((x, y) => x - y)).toEqual(miles);
    for (const n of a.nearest) {
      const node = nodes.find((t) => t.name === n.type && isUnder(t.path, a.matched));
      expect(node, n.type).toBeDefined();
    }
  });

  test("a named answer is compact and well formed", async () => {
    const r = await ask("98101", { types: ["libraries", "grocery stores", "food banks", "tutors", "fire stations"] });
    const text = JSON.stringify(r);
    expect(text.length).toBeLessThan(15000);
    expect(text).not.toMatch(/NaN|Infinity|"null"/);
    expect(r.types).toHaveLength(5);
    for (const a of r.types as TypeAnswer[]) {
      expect(a.matched, a.asked).toBeTruthy();
      expect(a.us.rate).toBeGreaterThan(0);
    }
  });

  test("a ten-mile radius in Manhattan answers quickly at the tract limit", async () => {
    await ask("10001", { types: ["libraries"], radiusMiles: 10 }); // warm
    const started = Date.now();
    const r = await ask("10001", { types: ["libraries", "grocery stores", "pharmacies"], radiusMiles: 10 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.area.tracts).toBe(500);
    expect(first(r).here.count).toBeGreaterThan(50);
  });

  test("the overview works downtown and in the country", async () => {
    const city = await ask("98101");
    expect(city.overview!.commonest).toHaveLength(8);
    expect(city.overview!.over.length).toBeGreaterThan(0);
    expect(JSON.stringify(city).length).toBeLessThan(15000);
    const rural = await ask("59001", { radiusMiles: 10 });
    expect(rural.overview!.commonest.length).toBeGreaterThan(0);
    expect(JSON.stringify(rural)).not.toMatch(/NaN|Infinity/);
  });

  test("rates per a group use the profile's figures", async () => {
    const r = await ask("98101", { types: ["grocery stores"], per: "snap_households" });
    expect(r.per.unit).toBe(1000);
    expect(r.per.here).toBeGreaterThan(1000);
    expect(first(r).here.rate).toBeGreaterThan(0);
  });

  test("Puerto Rico has places and rates", async () => {
    const r = await ask("San Juan, PR", { types: ["restaurants", "pharmacies"], radiusMiles: 3 });
    expect(r.per.here).toBeGreaterThan(10000);
    const [restaurants] = r.types as TypeAnswer[];
    expect(restaurants.here.count).toBeGreaterThan(20);
    expect(restaurants.county.count).toBeGreaterThan(restaurants.here.count - 1);
    expect(restaurants.here.rate).toBeGreaterThan(0);
  });
});
