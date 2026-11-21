/**
 * Builds a tiny profile data directory (Parquet files plus manifest) in a
 * temp dir, in the same layout `npm run build:acs` produces.
 *
 * Every table the profile uses is present. Unless overridden, a geography's
 * `_001` cells hold its `total` and every other cell holds its `part`, so a
 * one-cell share is part/total and sums are easy to work by hand.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { ACS_PERIOD, ACS_YEAR, cellsUsed, tablesUsed } from "../src/profile/definition.js";

export type Pair = [est: number | null, moe: number | null];

export interface FixtureGeo {
  geoId: string;
  total: Pair;
  part: Pair;
}

/** Centre used by the tests: downtown Seattle. */
export const CENTRE = { lat: 47.6062, lon: -122.3321 };
const MILE_LAT = 1 / 69.05;

export const TRACT = {
  A: "53033000100", // 0.3 miles north of the centre
  B: "53033000200", // 0.8 miles
  C: "53033000300", // 2 miles
  M: "53033000600", // 2.5 miles; has a centre point but no table rows
  Z: "53033000500", // 3 miles; every estimate is zero
  D: "53033000400", // 6 miles
} as const;

const TRACT_MILES: Record<string, number> = {
  [TRACT.A]: 0.3,
  [TRACT.B]: 0.8,
  [TRACT.C]: 2,
  [TRACT.M]: 2.5,
  [TRACT.Z]: 3,
  [TRACT.D]: 6,
};

export const GEOS: FixtureGeo[] = [
  { geoId: "0100000US", total: [1000000, 0], part: [100000, 1000] },
  { geoId: "0400000US53", total: [100000, 0], part: [10000, 300] },
  { geoId: "0500000US53033", total: [10000, 0], part: [1000, 100] },
  { geoId: `1400000US${TRACT.A}`, total: [1000, 50], part: [100, 20] },
  { geoId: `1400000US${TRACT.B}`, total: [2000, 120], part: [300, 40] },
  { geoId: `1400000US${TRACT.C}`, total: [1000, 50], part: [100, 20] },
  { geoId: `1400000US${TRACT.D}`, total: [1000, 50], part: [100, 20] },
  { geoId: `1400000US${TRACT.Z}`, total: [0, 12], part: [0, 12] },
];

/** Overrides: full GEO_ID -> cell -> [estimate, margin]. */
export type Overrides = Record<string, Record<string, Pair>>;

const sql = (v: number | null) => (v === null ? "NULL" : String(v));

export async function buildFixture(
  overrides: Overrides = {},
): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "acs-fixture-"));
  const instance = await DuckDBInstance.create(":memory:");
  const db = await instance.connect();
  const tables: Record<string, number> = {};

  for (const table of tablesUsed()) {
    const cells = cellsUsed(table);
    const columns = ["GEO_ID", ...cells.flatMap((c) => [c.replace("_", "_E"), c.replace("_", "_M")])];
    const rows = GEOS.map((g) => {
      const values = cells.flatMap((cell) => {
        const pair = overrides[g.geoId]?.[cell] ?? (cell.endsWith("_001") ? g.total : g.part);
        return [sql(pair[0]), sql(pair[1])];
      });
      return `('${g.geoId}', ${values.join(", ")})`;
    });
    const file = join(dir, `${table.toLowerCase()}.parquet`);
    await db.run(
      `COPY (SELECT * FROM (VALUES ${rows.join(", ")}) AS t(${columns.join(", ")}) ORDER BY GEO_ID)
       TO '${file}' (FORMAT parquet)`,
    );
    tables[table] = rows.length;
  }

  const points: string[] = Object.entries(TRACT_MILES).map(
    ([geoid, miles]) =>
      `('tract', '${geoid}', NULL, 'WA', ${CENTRE.lat + miles * MILE_LAT}, ${CENTRE.lon})`,
  );
  points.push(
    `('zcta', '98101', NULL, NULL, 47.6101, -122.3344)`,
    `('place', '5363000', 'Seattle city', 'WA', 47.6205, -122.3509)`,
    `('place', '1772000', 'Springfield city', 'IL', 39.7911, -89.6446)`,
    `('place', '2970000', 'Springfield city', 'MO', 37.1943, -93.2916)`,
  );
  await db.run(
    `COPY (SELECT * FROM (VALUES ${points.join(", ")}) AS t(kind, geoid, name, state, lat, lon))
     TO '${join(dir, "points.parquet")}' (FORMAT parquet)`,
  );

  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({
      acs_year: ACS_YEAR,
      period: ACS_PERIOD,
      built: "2026-11-21",
      tables,
      points: points.length,
    }),
  );
  db.closeSync();

  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
