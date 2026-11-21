import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { columnsFor } from "../src/profile/definition.js";
import {
  GAZETTEER,
  checkSize,
  convertPoints,
  convertTable,
  tableUrl,
} from "../src/scripts/build-acs.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "build-acs-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function read(file: string, sql = "SELECT * FROM t"): Promise<Record<string, unknown>[]> {
  const db = await (await DuckDBInstance.create(":memory:")).connect();
  const reader = await db.runAndReadAll(sql.replace(/\bt\b/, `read_parquet('${file}')`));
  const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
  db.closeSync();
  return rows;
}

/** A B22003 bulk file: every column the table has, 14 values per row. */
function dat(rows: [string, ...string[]][]): string {
  const header = ["GEO_ID"];
  for (let i = 1; i <= 7; i++) header.push(`B22003_E00${i}`, `B22003_M00${i}`);
  return [header.join("|"), ...rows.map((r) => r.join("|"))].join("\n") + "\n";
}

const fill = (est: string, moe: string) => Array.from({ length: 7 }, () => [est, moe]).flat();

describe("tableUrl", () => {
  it("points at the 2024 five-year table file, lower-case", () => {
    expect(tableUrl("C27016")).toBe(
      "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-c27016.dat",
    );
  });
});

describe("GAZETTEER", () => {
  it("names the three 2024 centre-point files", () => {
    expect(GAZETTEER.tract).toMatch(/2024_Gazetteer\/2024_Gaz_tracts_national\.zip$/);
    expect(GAZETTEER.zcta).toMatch(/2024_Gaz_zcta_national\.zip$/);
    expect(GAZETTEER.place).toMatch(/2024_Gaz_place_national\.zip$/);
  });
});

describe("convertTable", () => {
  it("keeps nation, state, county and tract rows with only the columns in use", async () => {
    const src = join(dir, "b22003.dat");
    await writeFile(
      src,
      dat([
        ["1400000US53033000200", ...fill("20", "2")],
        ["0100000US", ...fill("1000", "-555555555")],
        ["1600000US5363000", ...fill("7", "7")],
        ["0400000US53", ...fill("100", "10")],
        ["0500000US53033", ...fill("-666666666", "-222222222")],
        ["1400000US53033000100", ...fill("", "")],
        ["0100089US", ...fill("5", "5")],
      ]),
    );
    const out = join(dir, "out1");
    const count = await convertTable(src, "B22003", out);
    expect(count).toBe(5);

    const rows = await read(join(out, "b22003.parquet"));
    expect(rows.map((r) => r.GEO_ID)).toEqual([
      "0100000US",
      "0400000US53",
      "0500000US53033",
      "1400000US53033000100",
      "1400000US53033000200",
    ]);
    expect(Object.keys(rows[0])).toEqual(["GEO_ID", ...columnsFor("B22003")]);
    // Nation: a controlled estimate has margin -555555555, stored as 0.
    expect(rows[0].B22003_E001).toBe(1000);
    expect(rows[0].B22003_M001).toBe(0);
    // County: sentinel estimate and margin become null.
    expect(rows[2].B22003_E002).toBeNull();
    expect(rows[2].B22003_M002).toBeNull();
    // Tract with empty fields: null.
    expect(rows[3].B22003_E001).toBeNull();
    expect(rows[3].B22003_M001).toBeNull();
    expect(rows[4].B22003_E006).toBe(20);
    expect(rows[4].B22003_M006).toBe(2);
  });

  it("names the column when the file lacks one the profile needs", async () => {
    const src = join(dir, "short.dat");
    await writeFile(src, "GEO_ID|B22003_E001|B22003_M001\n0100000US|1|1\n");
    await expect(convertTable(src, "B22003", join(dir, "out2"))).rejects.toThrow(/B22003_E002/);
  });
});

describe("convertPoints", () => {
  it("reads the three padded, tab-separated files into one table", async () => {
    const pad = "      ";
    const tract = join(dir, "tracts.txt");
    const zcta = join(dir, "zcta.txt");
    const place = join(dir, "place.txt");
    await writeFile(
      tract,
      `USPS\tGEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG${pad}\n` +
        `WA\t53033008102\t556709\t91220\t0.215\t0.035\t47.6052820\t-122.3360120${pad}\n` +
        `AL\t01001020100\t9825303\t28435\t3.794\t0.011\t32.4819731\t-86.4915648${pad}\n`,
    );
    await writeFile(
      zcta,
      `GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG${pad}\n` +
        `00601\t166836392\t798613\t64.416\t0.308\t18.180555\t-66.749961${pad}\n`,
    );
    await writeFile(
      place,
      `USPS\tGEOID\tANSICODE\tNAME\tLSAD\tFUNCSTAT\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG${pad}\n` +
        `CO\t0811810\t02409976\tCañon City city\t25\tA\t32148517\t31525\t12.413\t0.012\t38.441886\t-105.220581${pad}\n`,
    );
    const out = join(dir, "out3");
    expect(await convertPoints({ tract, zcta, place }, out)).toBe(4);

    const rows = await read(join(out, "points.parquet"), "SELECT * FROM t ORDER BY kind, geoid");
    expect(rows).toEqual([
      { kind: "place", geoid: "0811810", name: "Cañon City city", state: "CO", lat: 38.441886, lon: -105.220581 },
      { kind: "tract", geoid: "01001020100", name: null, state: "AL", lat: 32.4819731, lon: -86.4915648 },
      { kind: "tract", geoid: "53033008102", name: null, state: "WA", lat: 47.605282, lon: -122.336012 },
      { kind: "zcta", geoid: "00601", name: null, state: null, lat: 18.180555, lon: -66.749961 },
    ]);
  });
});

describe("checkSize", () => {
  it("reports sizes when under the limit", async () => {
    const d = join(dir, "size");
    await convertTable(join(dir, "b22003.dat"), "B22003", d);
    const r = await checkSize(d);
    expect(Object.keys(r.files)).toEqual(["b22003.parquet"]);
    expect(r.total).toBe(r.files["b22003.parquet"]);
  });

  it("stops with every file's size when over the limit", async () => {
    await expect(checkSize(join(dir, "size"), 10)).rejects.toThrow(/b22003\.parquet/);
    await expect(checkSize(join(dir, "size"), 10)).rejects.toThrow(/over the .* limit/);
  });
});

describe("when the bulk file is refused", () => {
  it("recognises a file that is not a table", async () => {
    const { looksLikeTable } = await import("../src/scripts/build-acs.js");
    const good = join(dir, "good.dat");
    const bad = join(dir, "bad.dat");
    await writeFile(good, "GEO_ID|B22003_E001|B22003_M001\n0100000US|1|1\n");
    await writeFile(bad, "<html><head><title>Request Rejected</title></head></html>");
    expect(await looksLikeTable(good)).toBe(true);
    expect(await looksLikeTable(bad)).toBe(false);
  });

  it("writes the same file format from the Census API", async () => {
    const { tableFromApi } = await import("../src/scripts/build-acs.js");
    const paths: string[] = [];
    const head = ["GEO_ID", "B19013_001E", "B19013_001M"];
    const client = {
      async getJson(path: string) {
        paths.push(path);
        const geo = new URL(`https://x/${path}`).searchParams;
        if (geo.get("for") === "us:1") return [[...head, "us"], ["0100000US", "80000", "200", "1"]];
        if (geo.get("for") === "state:*")
          return [[...head, "state"], ["0400000US53", "95000", "500", "53"], ["0400000US11", "100000", "900", "11"]];
        if (geo.get("for") === "county:*")
          return [[...head, "state", "county"], ["0500000US53033", "120000", "900", "53", "033"]];
        if (geo.get("in") === "state:53")
          return [[...head, "state", "county", "tract"], ["1400000US53033008102", "-666666666", "-222222222", "53", "033", "008102"]];
        return [[...head, "state", "county", "tract"], ["1400000US11001000100", null, null, "11", "001", "000100"]];
      },
    };
    const out = join(dir, "api.dat");
    await tableFromApi(client, "B19013", out);

    expect(paths).toHaveLength(5);
    expect(paths[0]).toBe("2024/acs/acs5?get=GEO_ID,B19013_001E,B19013_001M&for=us:1");
    expect(paths.slice(3).sort()).toEqual([
      "2024/acs/acs5?get=GEO_ID,B19013_001E,B19013_001M&for=tract:*&in=state:11",
      "2024/acs/acs5?get=GEO_ID,B19013_001E,B19013_001M&for=tract:*&in=state:53",
    ]);

    const { readFile } = await import("node:fs/promises");
    expect((await readFile(out, "utf8")).split("\n")).toEqual([
      "GEO_ID|B19013_E001|B19013_M001",
      "0100000US|80000|200",
      "0400000US53|95000|500",
      "0400000US11|100000|900",
      "0500000US53033|120000|900",
      "1400000US53033008102|-666666666|-222222222",
      "1400000US11001000100||",
      "",
    ]);
    // And the result converts like any bulk file.
    expect(await convertTable(out, "B19013", join(dir, "out-api"))).toBe(6);
  });
});
