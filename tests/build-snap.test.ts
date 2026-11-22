import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SNAP_CSV_URL, asOf, writeRetailers, writeSnapCounts } from "../src/scripts/build-snap.js";
import { FULL_LINE, STORE_TYPES, defaultSnapLocation } from "../src/snap/store.js";

let db: DuckDBConnection;
let dir: string;
let csv: string;
let spatial = true;

const HEADER =
  "Record_ID,Store_Name,Store_Street_Address,Additonal_Address,City,State,Zip_Code,Zip4,County,Store_Type,Latitude,Longitude,Incentive_Program,Grantee_Name,X,Y,ObjectId";
// Tract 53033000100 is the square 0..1, 53061000200 is 2..3 (lon and lat).
const line = (id: number, name: string, type: string, lat: string, lon: string, extra = "") =>
  `${id},${name},${id} Main St,${extra},Town,WA,98101,,KING,${type},${lat},${lon},,,${lon},${lat},${id}`;
const ROWS = [
  line(1, "Fresh Mart", "Supermarket", "0.5", "0.5"),
  line(2, "Big Box", "Super Store", "0.6", "0.6", "Suite 2"),
  line(3, "Corner Grocery", "Grocery Store", "0.4", "0.4"),
  line(4, `"Joe's ""Best"", Inc"`, "Convenience Store", "0.3", "0.3"),
  line(5, "Spice House", "Specialty Store", "2.5", "2.5"),
  line(6, "Veggie Van", "Mobile Market", "2.6", "2.6"),
  line(7, "Nowhere", "Supermarket", "", "0.5"),
  line(8, "At Sea", "Supermarket", "9", "9"),
];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "build-snap-"));
  csv = join(dir, "retailers.csv");
  await writeFile(csv, [HEADER, ...ROWS].join("\n") + "\n");
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
});

afterAll(async () => {
  db.closeSync();
  await rm(dir, { recursive: true, force: true });
});

const read = async (file: string, order: string) =>
  (await db.runAndReadAll(`SELECT * FROM read_parquet('${join(dir, "out", file)}') ORDER BY ${order}`)).getRowObjectsJson() as Record<string, unknown>[];

describe("constants", () => {
  it("name the eight USDA store types and the three full-line ones", () => {
    expect(STORE_TYPES).toHaveLength(8);
    expect([...FULL_LINE]).toEqual(["Supermarket", "Super Store", "Grocery Store"]);
    for (const t of FULL_LINE) expect(STORE_TYPES).toContain(t);
  });

  it("pin the download", () => {
    expect(SNAP_CSV_URL).toBe(
      "https://hub.arcgis.com/api/v3/datasets/8b260f9a10b0459aa441ad8588c2251c_0/downloads/data?format=csv&spatialRefId=4326&where=1%3D1",
    );
  });

  it("read the as-of date from USDA's metadata", () => {
    expect(asOf({ data: { attributes: { modified: Date.UTC(2026, 10, 5, 15) } } })).toBe("2026-11-05");
    expect(() => asOf({})).toThrow("Could not read USDA's modified date");
  });

  it("put the data in CENSUS_SNAP_DIR or data/snap", () => {
    expect(defaultSnapLocation({ CENSUS_SNAP_DIR: "/x" })).toBe("/x");
    expect(defaultSnapLocation({})).toMatch(/data[/\\]snap$/);
  });
});

describe("the build", () => {
  it("keeps retailers in a tract, and counts the rest", async (ctx) => {
    if (!spatial) ctx.skip();
    const r = await writeRetailers(db, csv, "tracts", join(dir, "out"));
    expect(r).toEqual({ retailers: 6, dropped: 1, without_coordinates: 1 });

    const rows = await read("retailers.parquet", "tract, name");
    expect(rows.map((x) => x.tract)).toEqual([
      "53033000100", "53033000100", "53033000100", "53033000100", "53061000200", "53061000200",
    ]);
    const byName = new Map(rows.map((x) => [x.name, x]));
    expect(rows.filter((x) => x.full_line).map((x) => x.name).sort()).toEqual(["Big Box", "Corner Grocery", "Fresh Mart"]);
    expect(byName.get(`Joe's "Best", Inc`)?.store_type).toBe("Convenience Store");
    expect(byName.get("Veggie Van")).toMatchObject({ store_type: "Mobile Market", full_line: false });
    expect(byName.get("Big Box")).toMatchObject({ address: "2 Main St Suite 2", city: "Town", state: "WA", zip: "98101" });
    expect(byName.get("Fresh Mart")).toMatchObject({ address: "1 Main St", lat: 0.5, lon: 0.5 });
  });

  it("counts retailers by type for each county, state and the nation", async (ctx) => {
    if (!spatial) ctx.skip();
    expect(await writeSnapCounts(db, join(dir, "out"))).toBeGreaterThan(0);
    const rows = await read("snap-counts.parquet", "level, geoid, store_type");
    const n = (level: string, geoid: string, type: string) =>
      Number(rows.find((x) => x.level === level && x.geoid === geoid && x.store_type === type)?.n ?? 0);
    expect(n("county", "53033", "Supermarket")).toBe(1);
    expect(n("county", "53033", "Convenience Store")).toBe(1);
    expect(n("county", "53061", "Mobile Market")).toBe(1);
    const sum = (level: string, geoid: string) =>
      rows.filter((x) => x.level === level && x.geoid === geoid).reduce((a, x) => a + Number(x.n), 0);
    expect(sum("state", "53")).toBe(6);
    expect(sum("us", "")).toBe(6);
  });
});
