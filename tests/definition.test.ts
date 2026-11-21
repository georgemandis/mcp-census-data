import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACS_PERIOD,
  ACS_YEAR,
  GAPS,
  INCOME_BANDS,
  SECTIONS,
  cellsUsed,
  columnsFor,
  tablesUsed,
} from "../src/profile/definition.js";

const SPEC_TABLES = [
  "B01001", "B01003", "B03002", "B04006", "B05002", "B09001", "B11001", "B11005", "B11007",
  "B14001", "B15003", "B19001", "B19013", "B19055", "B19056", "B19057", "B19059", "B19083",
  "B22003", "B23025", "B25003", "B25070", "B27010", "C16001", "C17002", "C24010", "C24030",
  "C27006", "C27007", "C27016",
];

const allLines = [...SECTIONS.flatMap((s) => s.lines), ...GAPS];
const allCells = [
  ...allLines.flatMap((l) => [...l.num, ...(l.den ?? [])]),
  ...INCOME_BANDS.map((b) => b.cell),
];

describe("profile definition", () => {
  it("is for ACS 2024", () => {
    expect(ACS_YEAR).toBe(2024);
    expect(ACS_PERIOD).toBe("2020-2024");
  });

  it("uses exactly the tables in the design", () => {
    expect(tablesUsed()).toEqual(SPEC_TABLES);
  });

  it("names every cell as table, underscore, three digits", () => {
    for (const c of allCells) expect(c).toMatch(/^[BC]\d{5}_\d{3}$/);
  });

  it("lists estimate and margin columns only for cells in use", () => {
    const cols = columnsFor("B22003");
    expect(cols).toContain("B22003_E006");
    expect(cols).toContain("B22003_M006");
    expect(cols).not.toContain("B22003_E004");
    expect(cols.length).toBe(cellsUsed("B22003").length * 2);
  });

  it("has the sections and gaps in order", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      "people", "income", "work", "origins", "households", "older_adults", "school", "benefits", "housing",
    ]);
    expect(SECTIONS.map((s) => s.title)).toEqual([
      "People", "Income", "Work", "Origins", "Households and children", "Older adults", "School", "Benefits", "Housing",
    ]);
    expect(GAPS.map((g) => g.id)).toEqual([
      "poor_no_snap", "low_income_uninsured", "children_uninsured", "rent_burdened", "older_alone",
    ]);
  });

  it("gives every line a unique id", () => {
    const ids = allLines.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ranks industries, languages and ancestries to the top five", () => {
    const top = Object.assign({}, ...SECTIONS.map((s) => s.top ?? {}));
    expect(top).toEqual({ industry: 5, language: 5, ancestry: 5 });
    const groups = new Set(allLines.map((l) => l.group).filter(Boolean));
    expect(groups).toEqual(new Set(["industry", "language", "ancestry"]));
  });

  it("has sixteen income bands that tile upward", () => {
    expect(INCOME_BANDS).toHaveLength(16);
    for (let i = 1; i < INCOME_BANDS.length; i++) {
      expect(INCOME_BANDS[i].lower).toBe(INCOME_BANDS[i - 1].upper);
    }
    expect(INCOME_BANDS[0].lower).toBe(0);
    expect(INCOME_BANDS.filter((b) => b.upper === null)).toEqual([INCOME_BANDS[15]]);
  });

  it("has a Census label on file for every cell", () => {
    const labels = JSON.parse(readFileSync("data/acs-labels.json", "utf8")) as Record<string, string>;
    const missing = [...new Set(allCells)].filter((c) => !labels[c]);
    expect(missing).toEqual([]);
  });

  it("has no line that divides a total by itself", () => {
    for (const l of allLines) {
      if (!l.den) continue;
      const overlap = l.num.filter((c) => c.endsWith("_001") && l.den!.includes(c));
      expect(overlap, l.id).toEqual([]);
    }
  });

  it("pins the gap cells", () => {
    const gap = (id: string) => GAPS.find((g) => g.id === id)!;
    expect(gap("poor_no_snap").num).toEqual(["B22003_006"]);
    expect(gap("poor_no_snap").den).toEqual(["B22003_003", "B22003_006"]);
    expect(gap("rent_burdened").num).toEqual(["B25070_007", "B25070_008", "B25070_009", "B25070_010"]);
    expect(gap("rent_burdened").den).toHaveLength(9);
    expect(gap("rent_burdened").den).not.toContain("B25070_011");
    expect(gap("children_uninsured").num).toEqual(["B27010_017"]);
    expect(gap("children_uninsured").den).toEqual(["B27010_002"]);
    expect(gap("older_alone").num).toEqual(["B11007_003"]);
    expect(gap("older_alone").den).toEqual(["B11007_002"]);
    expect(gap("low_income_uninsured").den).toEqual(["C27016_002", "C27016_012"]);
  });
});
