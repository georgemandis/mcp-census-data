/**
 * Builds a small SNAP retailer data directory in the layout
 * `npm run build:snap` produces, over the same tracts as the profile fixture.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { FULL_LINE } from "../src/snap/store.js";
import { CENTRE, TRACT } from "./profile-fixture.js";

const MILE_LAT = 1 / 69.05;
/** A tract in another county, not in the profile fixture. */
export const OVER_THE_LINE = "53061000100";

interface FixtureRetailer {
  name: string;
  type: string;
  tract: string;
  miles: number; // north of the centre
}

const r = (name: string, type: string, tract: string, miles: number): FixtureRetailer => ({ name, type, tract, miles });

export const RETAILERS: FixtureRetailer[] = [
  r("Fresh Mart", "Supermarket", TRACT.A, 0.1),
  r("Corner Grocery", "Grocery Store", TRACT.A, 0.2),
  r("Quick Stop 1", "Convenience Store", TRACT.A, 0.05),
  r("Quick Stop 2", "Convenience Store", TRACT.A, 0.06),
  r("Quick Stop 3", "Convenience Store", TRACT.A, 0.07),
  r("Spice House", "Specialty Store", TRACT.A, 0.3),
  r("Big Box", "Super Store", TRACT.B, 0.75),
  r("Gas N Go", "Convenience Store", TRACT.B, 0.8),
  r("Far Mart", "Supermarket", TRACT.C, 2),
  r("Veggie Van", "Mobile Market", TRACT.C, 2.05),
  r("Edge Grocery", "Grocery Store", TRACT.D, 6),
  r("Over the Line", "Convenience Store", OVER_THE_LINE, 3),
];

/** Counts by store type: county 53033, state 53, the nation. */
export const SNAP_COUNTS: [type: string, county: number, state: number, us: number][] = [
  ["Supermarket", 10, 100, 1000],
  ["Super Store", 5, 50, 500],
  ["Grocery Store", 10, 100, 1000],
  ["Convenience Store", 40, 400, 4000],
  ["Other", 20, 200, 2000],
  ["Specialty Store", 3, 30, 300],
  ["Farmers and Markets", 2, 20, 200],
];

export const SNAP_AS_OF = "2026-11-05";

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

export async function buildSnapFixture(): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "snap-fixture-"));
  const db = await (await DuckDBInstance.create(":memory:")).connect();
  const rows = RETAILERS.map(
    (x) =>
      `(${q(x.name)}, ${q(`${Math.round(x.miles * 1000)} Main St`)}, 'Seattle', 'WA', '98101', ${q(x.type)}, ${FULL_LINE.includes(x.type)}, ${CENTRE.lat + x.miles * MILE_LAT}, ${CENTRE.lon}, ${q(x.tract)})`,
  );
  await db.run(
    `COPY (SELECT * FROM (VALUES ${rows.join(", ")})
       AS t(name, address, city, state, zip, store_type, full_line, lat, lon, tract) ORDER BY tract, name)
     TO '${join(dir, "retailers.parquet")}' (FORMAT parquet)`,
  );
  const counts = SNAP_COUNTS.flatMap(([type, county, state, us]) => [
    `('county', '53033', ${q(type)}, ${county})`,
    `('state', '53', ${q(type)}, ${state})`,
    `('us', '', ${q(type)}, ${us})`,
  ]);
  await db.run(
    `COPY (SELECT * FROM (VALUES ${counts.join(", ")}) AS t(level, geoid, store_type, n) ORDER BY level, geoid, store_type)
     TO '${join(dir, "snap-counts.parquet")}' (FORMAT parquet)`,
  );
  db.closeSync();
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({
      as_of: SNAP_AS_OF,
      built: "2026-11-22",
      retailers: RETAILERS.length,
      dropped: 0,
      without_coordinates: 0,
      by_type: Object.fromEntries(SNAP_COUNTS.map(([t, , , us]) => [t, us])),
    }),
  );
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
