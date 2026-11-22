import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OVERTURE_RELEASE,
  TRACT_SHAPES,
  overtureSource,
  selectPlacesSql,
  writeCounts,
  writePlaces,
  writeTypes,
} from "../src/scripts/build-places.js";

let db: DuckDBConnection;
let dir: string;
let spatial = true;

// One raw Overture-shaped row. Tract 53033000100 is the square 0..1, 53061000200 is 2..3 (lon and lat).
const row = (o: {
  name?: string | null; lon: number; lat: number; country?: string; status?: string | null;
  confidence?: number; hierarchy?: string[] | null; basic?: string | null;
}) => {
  const h = o.hierarchy === undefined ? ["education", "library"] : o.hierarchy;
  const tax = h === null ? "NULL" : `{'primary': '${h.at(-1)}', 'hierarchy': [${h.map((x) => `'${x}'`).join(", ")}], 'alternates': NULL}`;
  const name = o.name === null ? "NULL" : `'${o.name ?? "Place"}'`;
  const status = o.status === null ? "NULL" : `'${o.status ?? "open"}'`;
  const basic = o.basic === null ? "NULL" : `'${o.basic ?? "library"}'`;
  return `SELECT {'primary': ${name}} AS names, ${o.confidence ?? 0.9} AS confidence, ${status} AS operating_status,
    ${basic} AS basic_category, CAST(${tax} AS STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[])) AS taxonomy,
    [{'freeform': '1 Main St', 'locality': 'Town', 'postcode': '98101', 'region': 'WA', 'country': '${o.country ?? "US"}'}] AS addresses,
    [{'dataset': 'meta', 'license': 'CDLA-Permissive-2.0'}] AS sources,
    {'xmin': ${o.lon}, 'xmax': ${o.lon}, 'ymin': ${o.lat}, 'ymax': ${o.lat}} AS bbox`;
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "build-places-"));
  db = await (await DuckDBInstance.create(":memory:")).connect();
  try {
    await db.run("INSTALL spatial; LOAD spatial;");
  } catch {
    spatial = false;
    return;
  }
  await db.run(`CREATE TABLE tracts AS
    SELECT '53033000100' AS geoid, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))') AS geom
    UNION ALL SELECT '53061000200', ST_GeomFromText('POLYGON((2 2, 3 2, 3 3, 2 3, 2 2))')`);
  const rows = [
    row({ name: "B Library", lon: 2.5, lat: 2.5 }),
    row({ name: "A Library", lon: 0.5, lat: 0.5 }),
    row({ name: "Asia Market", lon: 0.4, lat: 0.4, hierarchy: ["shopping", "grocery_store", "asian_grocery_store"], basic: "food_and_beverage_store" }),
    row({ name: "Corner Grocery", lon: 0.6, lat: 0.6, hierarchy: ["shopping", "grocery_store"], basic: "food_and_beverage_store" }),
    row({ name: null, lon: 0.7, lat: 0.7, basic: null }),
    row({ name: "San Juan Library", lon: 2.2, lat: 2.2, country: "PR" }),
    row({ name: "Closed", lon: 0.5, lat: 0.5, status: "permanently_closed" }),
    row({ name: "No status", lon: 0.5, lat: 0.5, status: null }),
    row({ name: "Unsure", lon: 0.5, lat: 0.5, confidence: 0.74 }),
    row({ name: "Toronto", lon: 0.5, lat: 0.5, country: "CA" }),
    row({ name: "No type", lon: 0.5, lat: 0.5, hierarchy: null }),
    row({ name: "At sea", lon: 9, lat: 9 }),
  ];
  await db.run(`CREATE TABLE raw AS ${rows.join(" UNION ALL ")}`);
});

afterAll(async () => {
  db.closeSync();
  await rm(dir, { recursive: true, force: true });
});

const read = async (file: string, order: string) =>
  (await db.runAndReadAll(`SELECT * FROM read_parquet('${join(dir, file)}') ORDER BY ${order}`)).getRowObjectsJson() as Record<string, unknown>[];

describe("constants", () => {
  it("pin the release and the tract boundaries", () => {
    expect(OVERTURE_RELEASE).toBe("2026-11-18.0");
    expect(overtureSource("2026-11-18.0")).toBe(
      "s3://overturemaps-us-west-2/release/2026-11-18.0/theme=places/type=place/*",
    );
    expect(TRACT_SHAPES).toBe("https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_tract_500k.zip");
  });

  it("build a select that keeps open, confident places in the US and its territories", () => {
    const sql = selectPlacesSql("raw");
    expect(sql).toContain("operating_status = 'open'");
    expect(sql).toContain("confidence >= 0.75");
    for (const c of ["US", "PR", "VI", "GU", "AS", "MP"]) expect(sql).toContain(`'${c}'`);
  });
});

describe("the build", () => {
  it("keeps only open, confident, typed US places that fall in a tract", async (ctx) => {
    if (!spatial) return ctx.skip("DuckDB's spatial extension could not be installed");
    const r = await writePlaces(db, selectPlacesSql("raw"), "tracts", dir);
    expect(r).toMatchObject({ places: 6, dropped: 1 });
    expect(r.sources).toEqual([{ dataset: "meta", license: "CDLA-Permissive-2.0", n: 6 }]);
    const rows = await read("places.parquet", "tract, name NULLS LAST");
    expect(rows.map((x) => x.name)).toEqual(["A Library", "Asia Market", "Corner Grocery", null, "B Library", "San Juan Library"]);
    expect(rows[1]).toEqual({
      name: "Asia Market",
      category: "asian_grocery_store",
      path: "shopping > grocery_store > asian_grocery_store",
      basic_category: "food_and_beverage_store",
      address: "1 Main St",
      city: "Town",
      state: "WA",
      postcode: "98101",
      lon: 0.4,
      lat: 0.4,
      tract: "53033000100",
      source: "meta",
    });
    expect(rows[3]).toMatchObject({ name: null, basic_category: null, tract: "53033000100" });
  });

  it("writes the file sorted by tract", async (ctx) => {
    if (!spatial) return ctx.skip("no spatial extension");
    const rows = (await db.runAndReadAll(`SELECT tract FROM read_parquet('${join(dir, "places.parquet")}')`)).getRowObjectsJson();
    const tracts = rows.map((x) => String(x.tract));
    expect(tracts).toEqual([...tracts].sort());
  });

  it("counts by type for each county, state and the nation", async (ctx) => {
    if (!spatial) return ctx.skip("no spatial extension");
    // One row per level, area, type and broad type; the nameless library has no broad type.
    expect(await writeCounts(db, dir)).toBe(13);
    const rows = (await db.runAndReadAll(
      `SELECT level, geoid, path, sum(n) AS n FROM read_parquet('${join(dir, "place-counts.parquet")}')
       GROUP BY ALL ORDER BY level, geoid, path`,
    )).getRowObjectsJson() as Record<string, unknown>[];
    const key = (x: Record<string, unknown>) => `${x.level}|${x.geoid}|${x.path}|${x.n}`;
    expect(rows.map(key)).toEqual([
      "county|53033|education > library|2",
      "county|53033|shopping > grocery_store|1",
      "county|53033|shopping > grocery_store > asian_grocery_store|1",
      "county|53061|education > library|2",
      "state|53|education > library|4",
      "state|53|shopping > grocery_store|1",
      "state|53|shopping > grocery_store > asian_grocery_store|1",
      "us||education > library|4",
      "us||shopping > grocery_store|1",
      "us||shopping > grocery_store > asian_grocery_store|1",
    ]);
    const broad = await read("place-counts.parquet", "level, geoid, path, basic_category NULLS LAST");
    expect(broad.filter((x) => x.level === "county" && x.geoid === "53033" && x.path === "education > library")
      .map((x) => [x.basic_category, Number(x.n)])).toEqual([["library", 1], [null, 1]]);
  });

  it("lists every node of the type tree with its national count", async (ctx) => {
    if (!spatial) return ctx.skip("no spatial extension");
    expect(await writeTypes(db, dir)).toBe(5);
    const types = JSON.parse(await readFile(join(dir, "place-types.json"), "utf8"));
    expect(types).toEqual([
      { path: "education", name: "education", n: 4 },
      { path: "education > library", name: "library", n: 4 },
      { path: "shopping", name: "shopping", n: 2 },
      { path: "shopping > grocery_store", name: "grocery_store", n: 2 },
      { path: "shopping > grocery_store > asian_grocery_store", name: "asian_grocery_store", n: 1 },
    ]);
  });
});
