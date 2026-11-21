/**
 * Checks `profile_place` against the real built data. Runs only when the
 * data exists (npm run build:acs). The last block also needs CENSUS_API_KEY
 * and the network, and compares a profile with the Census API cell by cell.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createCensusClient } from "../src/core/client.js";
import { queryData } from "../src/core/query.js";
import { createGeocoder, type Geocoder } from "../src/profile/geocode.js";
import { locate } from "../src/profile/locate.js";
import { buildProfile, type Profile } from "../src/profile/profile.js";
import { defaultLocation, openStore, type Store } from "../src/profile/store.js";

const built = existsSync(join(defaultLocation(), "manifest.json"));

// For ZIPs and places the geocoder must not be needed at all.
const noGeocoder: Geocoder = {
  address: async () => { throw new Error("geocoder used"); },
  coordinates: async () => { throw new Error("geocoder used"); },
};

describe.skipIf(!built)("profile_place on built data", () => {
  let store: Store;
  const profile = async (location: string, radiusMiles?: number, geocoder = noGeocoder) =>
    buildProfile(await locate(location, { store, geocoder }), store, { radiusMiles });
  const lineOf = (p: Profile, section: string, id: string) =>
    p.sections.find((s) => s.id === section)!.lines.find((l) => l.id === id)!;

  beforeAll(async () => {
    store = await openStore();
  });
  afterAll(async () => {
    await store.close();
  });

  test("the data is the 2024 five-year release with every table", () => {
    expect(store.manifest.acs_year).toBe(2024);
    expect(Object.keys(store.manifest.tables)).toHaveLength(30);
    for (const rows of Object.values(store.manifest.tables)) expect(rows).toBeGreaterThan(80000);
    expect(store.manifest.points).toBeGreaterThan(140000);
  });

  // National shares that are widely published. A value outside its range
  // means a line is reading the wrong table cell.
  test.each([
    ["older_adults", "people_65_plus", 0.15, 0.19],
    ["benefits", "snap", 0.1, 0.14],
    ["benefits", "uninsured", 0.07, 0.1],
    ["benefits", "medicaid", 0.18, 0.23],
    ["benefits", "medicare", 0.16, 0.2],
    ["origins", "foreign_born", 0.13, 0.15],
    ["origins", "hispanic", 0.18, 0.2],
    ["housing", "owner_occupied", 0.63, 0.67],
    ["income", "below_poverty", 0.11, 0.14],
    ["work", "in_labor_force", 0.62, 0.65],
    ["work", "unemployed", 0.04, 0.07],
    ["households", "hh_with_children", 0.27, 0.32],
  ])("national %s / %s is between %f and %f", async (section, id, low, high) => {
    const p = await profile("98101", 0);
    const us = lineOf(p, section, id).us!;
    expect(us).toBeGreaterThanOrEqual(low);
    expect(us).toBeLessThanOrEqual(high);
  });

  test("national bachelor's-or-higher and median income are in range", async () => {
    const p = await profile("98101", 0);
    const ba = lineOf(p, "school", "edu_bachelors").us! + lineOf(p, "school", "edu_graduate").us!;
    expect(ba).toBeGreaterThan(0.33);
    expect(ba).toBeLessThan(0.38);
    const median = lineOf(p, "income", "median_household_income").us!;
    expect(median).toBeGreaterThan(70000);
    expect(median).toBeLessThan(90000);
    const gini = lineOf(p, "income", "income_inequality").us!;
    expect(gini).toBeGreaterThan(0.45);
    expect(gini).toBeLessThan(0.5);
  });

  test.each(["98101", "Seattle, WA", "Springfield, IL", "San Juan, PR"])(
    "a full profile for %s",
    async (location) => {
      const started = Date.now();
      const p = await profile(location);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(p.sections).toHaveLength(9);
      expect(p.gaps).toHaveLength(5);
      expect(p.area.tracts).toBeGreaterThan(0);
      expect(p.area.population).toBeGreaterThan(0);
      expect(p.location.county).toBeTruthy();
      const text = JSON.stringify(p);
      expect(text.length).toBeLessThan(40000);
      expect(text).not.toMatch(/NaN|Infinity/);
      // Shares are fractions, and age bands of the area add to about one.
      const ages = p.sections[0].lines.slice(1).reduce((sum, l) => sum + (l.area!.share ?? 0), 0);
      expect(ages).toBeGreaterThan(0.99);
      expect(ages).toBeLessThan(1.01);
    },
  );

  test("the combined-area median sits near the published medians of its tracts", async () => {
    const p = await profile("98101");
    const median = lineOf(p, "income", "median_household_income");
    expect(median.area).toMatchObject({ approximate: true });
    expect(median.area!.value).toBeGreaterThan(60000);
    expect(median.area!.value).toBeLessThan(200000);
  });

  test("a rural ZIP falls back to its single tract", async () => {
    const p = await profile("59001");
    expect(p.area.tracts).toBeGreaterThanOrEqual(1);
    expect(p.area.tracts).toBeLessThan(5);
    expect(p.location.state).toBe("Montana");
  });

  test("a ten-mile radius in Manhattan stops at 500 tracts", async () => {
    const p = await profile("10001", 10);
    expect(p.area.tracts).toBe(500);
    expect(p.area.tracts_in_range).toBeGreaterThan(500);
    expect(p.area.covered_miles).toBeLessThan(10);
    expect(p.notes.some((n) => /nearest 500/.test(n))).toBe(true);
  });

  test("Connecticut compares against a planning region", async () => {
    const p = await profile("Hartford, CT");
    expect(p.location.county).toMatch(/Planning Region, Connecticut$/);
    expect(lineOf(p, "benefits", "snap").county).not.toBeNull();
  });

  describe.skipIf(!process.env.CENSUS_API_KEY)("against the Census API and geocoder", () => {
    const TIMEOUT = 60_000;

    test("home-tract counts equal the same cells from query_data", async () => {
      const p = await profile("400 Broad St, Seattle, WA", 0, createGeocoder());
      expect(p.location.input).toBe("address");
      expect(p.area).toMatchObject({ tracts: 1, single_tract: true });
      const tract = p.location.anchor_tract;
      const r = await queryData(createCensusClient(), {
        dataset: "acs/acs5",
        vintage: 2024,
        get: ["B01003_001E", "B22003_002E", "B25003_003E", "B19013_001E", "C17002_002E", "C17002_003E"],
        for: `tract:${tract.slice(5)}`,
        in: `state:${tract.slice(0, 2)} county:${tract.slice(2, 5)}`,
      });
      const api = r.rows[0] as Record<string, string>;
      expect(lineOf(p, "people", "population").area!.count).toBe(Number(api.B01003_001E));
      expect(lineOf(p, "benefits", "snap").area!.count).toBe(Number(api.B22003_002E));
      expect(lineOf(p, "housing", "renter_occupied").area!.count).toBe(Number(api.B25003_003E));
      expect(lineOf(p, "income", "median_household_income").area!.value).toBe(Number(api.B19013_001E));
      expect(lineOf(p, "income", "below_poverty").area!.count).toBe(
        Number(api.C17002_002E) + Number(api.C17002_003E),
      );
    }, TIMEOUT);

    test("coordinates resolve to the tract that contains them", async () => {
      const p = await profile("47.6205, -122.3493", 1, createGeocoder());
      expect(p.location.input).toBe("coordinates");
      expect(p.location.anchor_tract).toMatch(/^53033/);
      expect(lineOf(p, "benefits", "snap").area!.share).toBeGreaterThan(0);
    }, TIMEOUT);
  });
});
