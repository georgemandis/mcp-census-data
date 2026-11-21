import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Located } from "../src/profile/locate.js";
import { ProfileInputError, SECTION_IDS, buildProfile } from "../src/profile/profile.js";
import { openStore, type Store } from "../src/profile/store.js";
import { CENTRE, TRACT, buildFixture } from "./profile-fixture.js";

// Fixture defaults (see profile-fixture.ts): "_001" cells hold `total`, all
// other cells hold `part`.
//   tract A, C, D: total 1000 ±50,  part 100 ±20
//   tract B:       total 2000 ±120, part 300 ±40
//   county:        total 10000 ±0,  part 1000 ±100
//   state:         total 100000 ±0, part 10000 ±300
//   nation:        total 1000000 ±0, part 100000 ±1000
const A = `1400000US${TRACT.A}`;

let fixture: Awaited<ReturnType<typeof buildFixture>>;
let store: Store;

beforeAll(async () => {
  fixture = await buildFixture({
    [A]: {
      B19057_002: [120, 30], // cash assistance: a little above the county, within the margin
      B19056_002: [10, 15], // SSI: too noisy to show for one tract
      C24030_006: [500, 20], // construction, men: makes construction the top industry
    },
  });
  store = await openStore(fixture.dir);
});

afterAll(async () => {
  await store.close();
  await fixture.cleanup();
});

const at = (anchor: string, over: Partial<Located> = {}): Located => ({
  kind: "address",
  label: "123 MAIN ST",
  lat: CENTRE.lat,
  lon: CENTRE.lon,
  anchor,
  exact: true,
  ...over,
});

type AnyLine = Record<string, any>;
const line = (p: any, section: string, id: string): AnyLine =>
  p.sections.find((s: any) => s.id === section).lines.find((l: any) => l.id === id);

describe("buildProfile", () => {
  it("describes the location and the area", async () => {
    const p = await buildProfile(at(TRACT.A), store);
    expect(p.location).toEqual({
      input: "address",
      label: "123 MAIN ST",
      lat: CENTRE.lat,
      lon: CENTRE.lon,
      anchor_tract: TRACT.A,
      county: "King County, Washington",
      state: "Washington",
    });
    expect(p.area).toEqual({
      radius_miles: 1,
      tracts: 2,
      population: 3000,
      single_tract: false,
      tracts_in_range: 2,
      covered_miles: 1,
      tracts_without_data: 0,
    });
    expect(p.data).toEqual({ source: "ACS 5-year", period: "2020-2024", built: "2026-11-21" });
  });

  it("returns every section, the gaps and the standard notes", async () => {
    const p = await buildProfile(at(TRACT.A), store);
    expect(p.sections.map((s) => s.id)).toEqual(SECTION_IDS.filter((s) => s !== "gaps"));
    expect(p.gaps!.map((g) => g.id)).toEqual([
      "poor_no_snap", "low_income_uninsured", "children_uninsured", "rent_burdened", "older_alone",
    ]);
    expect(p.notes.slice(0, 4)).toEqual([
      "Figures are 2020-2024 averages from the American Community Survey, not a single year.",
      "The survey undercounts benefit receipt, so real receipt is likely higher and the gaps somewhat smaller than shown.",
      "Margins for the combined area are approximations.",
      "Religion is not collected by the Census Bureau.",
    ]);
    expect(p.notes).toHaveLength(4);
    const benefits = p.sections.find((s) => s.id === "benefits")!;
    expect(benefits.tables).toEqual(["B19055", "B19056", "B19057", "B22003", "B27010", "C27006", "C27007"]);
  });

  it("combines tracts: counts add, margins combine, shares follow", async () => {
    const p = await buildProfile(at(TRACT.A), store);
    // SNAP households: (100 + 300) of (1000 + 2000).
    // Numerator margin sqrt(20² + 40²) = 44.72; denominator sqrt(50² + 120²) = 130.
    // Share margin sqrt(44.72² − 0.1333² × 130²) / 3000 = 0.0137.
    expect(line(p, "benefits", "snap")).toEqual({
      id: "snap",
      label: "Households receiving SNAP (food stamps)",
      area: { count: 400, share: 0.133, moe: 0.014, reliability: "reliable" },
      home: { share: 0.1, moe: 0.019 },
      county: 0.1,
      state: 0.1,
      us: 0.1,
      vs_county: "higher",
    });
    expect(line(p, "people", "population")).toEqual({
      id: "population",
      label: "Total population",
      area: { count: 3000, moe: 130, reliability: "reliable" },
      home: { count: 1000, moe: 50 },
      county: 10000,
      state: 100000,
      us: 1000000,
    });
  });

  it("leaves out home-tract figures that are unreliable", async () => {
    const p = await buildProfile(at(TRACT.A), store);
    const ssi = line(p, "benefits", "ssi");
    expect(ssi.home).toBeUndefined();
    expect(ssi.area.count).toBe(310);
  });

  it("shows no home-tract column when the tract is only the nearest one", async () => {
    const p = await buildProfile(at(TRACT.A, { kind: "zip", label: "ZIP code area 98101", exact: false }), store);
    for (const l of [...p.sections.flatMap((s) => s.lines), ...p.gaps!]) expect(l.home).toBeUndefined();
    expect(p.notes).toContain("The area is centred on the middle of ZIP code area 98101; it is not the whole of it.");
  });

  it("calls a difference from the county only when it is beyond the margin", async () => {
    const p = await buildProfile(at(TRACT.A), store, { radiusMiles: 0 });
    // Cash assistance in tract A: 120 ±30 of 1000 ±50 = 0.12 ±0.029; county 0.10 ±0.01.
    const cash = line(p, "benefits", "cash_assistance");
    expect(cash.area).toEqual({ count: 120, share: 0.12, moe: 0.029, reliability: "reliable" });
    expect(cash.vs_county).toBe("not distinguishable");
  });

  it("uses the anchor tract alone when the radius is zero", async () => {
    const p = await buildProfile(at(TRACT.A), store, { radiusMiles: 0 });
    expect(p.area).toMatchObject({ radius_miles: 0, tracts: 1, single_tract: true, population: 1000 });
    expect(p.notes).toContain("Only one census tract falls in this area, so figures are for that tract alone.");
    // A single tract has a published median and inequality index.
    expect(line(p, "income", "median_household_income").area).toEqual({ value: 1000, moe: 50, reliability: "reliable" });
    expect(line(p, "income", "income_inequality").area).toMatchObject({ value: 1000 });
    // The area is the home tract, so a separate home column would repeat it.
    expect(line(p, "benefits", "snap").home).toBeUndefined();
  });

  it("uses the anchor tract alone when no tract centre is in range", async () => {
    const far = at(TRACT.D, { lat: CENTRE.lat + 1, lon: CENTRE.lon });
    const p = await buildProfile(far, store, { radiusMiles: 1 });
    expect(p.area).toMatchObject({ tracts: 1, single_tract: true, tracts_in_range: 0 });
  });

  it("estimates the combined median from income bands and marks it approximate", async () => {
    const p = await buildProfile(at(TRACT.A), store);
    // Every band holds 400 households; the middle falls at the top of the eighth band.
    const median = line(p, "income", "median_household_income");
    expect(median.area).toEqual({ value: 45000, approximate: true });
    expect(median.home).toEqual({ value: 1000, moe: 50 });
    expect(median.county).toBe(10000);
    expect(median.vs_county).toBeUndefined();
  });

  it("does not show an inequality index for a combined area", async () => {
    const p = await buildProfile(at(TRACT.A), store);
    const gini = line(p, "income", "income_inequality");
    expect(gini.area).toBeUndefined();
    expect(gini.home).toEqual({ value: 1000, moe: 50 });
    expect(gini.county).toBe(10000);
  });

  it("returns nulls, not errors, for a tract with nobody in it", async () => {
    const p = await buildProfile(at(TRACT.Z), store, { radiusMiles: 0 });
    const text = JSON.stringify(p);
    expect(text).not.toMatch(/NaN|Infinity/);
    expect(line(p, "benefits", "snap").area).toEqual({ count: 0, share: null, moe: null, reliability: "no data" });
    expect(line(p, "benefits", "snap").vs_county).toBe("not distinguishable");
    for (const g of p.gaps!) expect(g.area.share).toBeNull();
    expect(p.area.population).toBe(0);
  });

  it("skips and counts a tract that has no data", async () => {
    const p = await buildProfile(at(TRACT.A), store, { radiusMiles: 2.6 });
    expect(p.area).toMatchObject({ tracts: 3, tracts_in_range: 4, tracts_without_data: 1, population: 4000 });
  });

  it("survives an anchor tract that has no data", async () => {
    const p = await buildProfile(at(TRACT.M), store, { radiusMiles: 0 });
    expect(p.area).toMatchObject({ tracts: 0, tracts_without_data: 1, population: null });
    expect(line(p, "benefits", "snap").area).toEqual({ count: null, share: null, moe: null, reliability: "no data" });
    expect(p.notes.some((n) => /no figures/i.test(n))).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
  });

  it("narrows to the sections asked for", async () => {
    const p = await buildProfile(at(TRACT.A), store, { sections: ["benefits", "gaps"] });
    expect(p.sections.map((s) => s.id)).toEqual(["benefits"]);
    expect(p.gaps).toHaveLength(5);
    const q = await buildProfile(at(TRACT.A), store, { sections: ["housing"] });
    expect(q.sections.map((s) => s.id)).toEqual(["housing"]);
    expect(q.gaps).toBeUndefined();
    expect(q.area.population).toBe(3000);
  });

  it("rejects an unknown section and lists the valid ones", async () => {
    const err = await buildProfile(at(TRACT.A), store, { sections: ["nope"] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProfileInputError);
    for (const id of SECTION_IDS) expect(err.message).toContain(id);
  });

  it("uses the nearest tracts and says how far they reach when too many are in range", async () => {
    const p = await buildProfile(at(TRACT.A), store, { radiusMiles: 10, maxTracts: 1 });
    expect(p.area).toMatchObject({ radius_miles: 10, tracts: 1, tracts_in_range: 6 });
    expect(p.area.covered_miles).toBeCloseTo(0.3, 1);
    expect(p.notes.some((n) => /nearest 1 /.test(n) && /0\.3 miles/.test(n))).toBe(true);
  });

  it("shows only the top five industries, largest first", async () => {
    const p = await buildProfile(at(TRACT.A), store);
    const work = p.sections.find((s) => s.id === "work")!;
    const industries = work.lines.filter((l) => l.id.startsWith("ind_"));
    expect(industries).toHaveLength(5);
    expect(industries[0].id).toBe("ind_construction");
    const shares = industries.map((l) => l.area.share as number);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
    // Lines outside a ranked group keep their place.
    expect(work.lines[0].id).toBe("in_labor_force");
  });

  it("compares every gap with the county", async () => {
    const p = await buildProfile(at(TRACT.A), store);
    // Poor households without SNAP: 400 of (400 + 400) in the area; 1000 of 2000 in the county.
    const gap = p.gaps!.find((g) => g.id === "poor_no_snap")!;
    expect(gap.area.count).toBe(400);
    expect(gap.area.share).toBe(0.5);
    expect(gap.county).toBe(0.5);
    for (const g of p.gaps!) expect(["higher", "lower", "not distinguishable"]).toContain(g.vs_county);
  });
});
