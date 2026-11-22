import { describe, expect, it } from "vitest";
import { tablesUsed } from "../src/profile/definition.js";
import { PER, expected, rate, versus } from "../src/places/compare.js";

describe("PER", () => {
  it("defines six groups with a unit and cells the profile data holds", () => {
    expect(Object.keys(PER)).toEqual([
      "people", "households", "children", "older_adults", "snap_households", "people_below_poverty",
    ]);
    expect(PER.people.unit).toBe(10000);
    expect(PER.households.unit).toBe(10000);
    for (const g of ["children", "older_adults", "snap_households", "people_below_poverty"] as const) {
      expect(PER[g].unit).toBe(1000);
    }
    const tables = new Set(tablesUsed());
    for (const g of Object.values(PER)) {
      expect(g.label).toBeTruthy();
      for (const cell of g.cells) expect(tables.has(cell.split("_")[0]), cell).toBe(true);
    }
    expect(PER.people.cells).toEqual(["B01003_001"]);
    expect(PER.older_adults.cells).toHaveLength(12);
    expect(PER.people_below_poverty.cells).toEqual(["C17002_002", "C17002_003"]);
  });
});

describe("rate", () => {
  it("is the count per unit of the group", () => {
    expect(rate(6, 83843, 10000)).toBe(0.72);
    expect(rate(0, 5000, 1000)).toBe(0);
    expect(rate(94, 2287171, 10000)).toBe(0.41);
  });

  it("is null for a missing or small group", () => {
    expect(rate(6, 99, 1000)).toBeNull();
    expect(rate(6, 0, 1000)).toBeNull();
    expect(rate(6, null, 1000)).toBeNull();
    expect(rate(6, 100, 1000)).toBe(60);
  });
});

describe("expected", () => {
  it("is the count this area would have at the other area's rate", () => {
    expect(expected(83843, 94, 2287171)).toBeCloseTo(3.45, 2);
  });

  it("is null when either group is missing or empty", () => {
    expect(expected(null, 94, 2287171)).toBeNull();
    expect(expected(83843, 94, null)).toBeNull();
    expect(expected(83843, 94, 0)).toBeNull();
    expect(expected(83843, 0, 2287171)).toBe(0);
  });
});

describe("versus", () => {
  const v = (here: number, exp: number | null, group: number | null = 50000) =>
    versus(here, exp, group, "residents");

  it("says how many times the county rate, to one decimal under ten", () => {
    expect(v(6, 3.45)).toBe("about 1.7 times the county rate");
    expect(v(40, 2)).toBe("about 20 times the county rate");
    expect(v(9, 6)).toBe("about 1.5 times the county rate");
  });

  it("says about the same within a quarter either way", () => {
    expect(v(10, 10)).toBe("about the same as the county");
    expect(v(10, 8.1)).toBe("about the same as the county");
    expect(v(8, 10)).toBe("about the same as the county");
  });

  it("gives a percentage when lower", () => {
    expect(v(4, 10)).toBe("about 40% of the county rate");
    expect(v(7, 10)).toBe("about 70% of the county rate");
    expect(v(13, 10)).toBe("about 1.3 times the county rate");
    expect(v(1, 12)).toBe("about 8% of the county rate");
  });

  it("names a clear absence", () => {
    expect(v(0, 6.4)).toBe("none found here; about 6 would be expected at the county rate");
  });

  it("will not compare small numbers", () => {
    expect(v(0, 3)).toBe("too few to compare");
    expect(v(4, 4.9)).toBe("too few to compare");
    expect(v(3, 0)).toBe("too few to compare");
    expect(v(3, null)).toBe("too few to compare");
    expect(v(0, 0)).toBe("too few to compare");
  });

  it("says when the county has none", () => {
    expect(v(7, 0)).toBe("none in the county to compare with");
    expect(v(7, null)).toBe("none in the county to compare with");
  });

  it("gives no comparison for a small or missing group", () => {
    expect(versus(6, 3, 99, "households on SNAP")).toBe("too few households on SNAP here to give a rate");
    expect(versus(6, 3, null, "residents")).toBe("too few residents here to give a rate");
    expect(versus(6, 3, 0, "children")).toBe("too few children here to give a rate");
  });

  it("never produces NaN or Infinity", () => {
    for (const args of [[0, 0], [5, 0], [0, null], [1e9, 1e-9], [5, 1e-12]] as [number, number | null][]) {
      expect(v(...args)).not.toMatch(/NaN|Infinity/);
    }
  });
});
