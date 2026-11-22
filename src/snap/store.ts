/**
 * Read access to the prebuilt SNAP retailer data (see scripts/build-snap.ts):
 * every store USDA currently authorises to take SNAP, with its type and
 * census tract, and counts by type for each county, state and the nation.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance, LIST, VARCHAR, listValue, type DuckDBConnection } from "@duckdb/node-api";
import { DATA_DIR } from "../core/version.js";
import { MILES_SQL, tractFilter, type Level } from "../places/store.js";

/** USDA's store types, as written in its data. */
export const STORE_TYPES: readonly string[] = [
  "Convenience Store",
  "Other",
  "Grocery Store",
  "Super Store",
  "Supermarket",
  "Restaurant Meals Program",
  "Farmers and Markets",
  "Specialty Store",
];

/** Stores that sell a full range of food: the headline count. */
export const FULL_LINE: readonly string[] = ["Supermarket", "Super Store", "Grocery Store"];

export interface SnapManifest {
  /** The date USDA last modified its list. */
  as_of: string;
  built: string;
  retailers: number;
  /** Retailers left out because they fell in no census tract. */
  dropped: number;
  /** Retailers left out because USDA gives no coordinates. */
  without_coordinates: number;
  /** National count by store type. */
  by_type: Record<string, number>;
}

/** Where the data is read from: CENSUS_SNAP_DIR, or data/snap inside the project. */
export function defaultSnapLocation(env: Record<string, string | undefined> = process.env): string {
  return env.CENSUS_SNAP_DIR || join(DATA_DIR, "snap");
}

export interface Retailer {
  name: string;
  /** USDA's store type, for example "Supermarket". */
  type: string;
  /** Street, city and state, as far as known. */
  address: string | null;
  /** Straight-line distance from the point asked about. */
  miles: number;
}

export interface SnapStore {
  manifest: SnapManifest;
  /** Retailers by store type in the given tracts, and the nearest full-line stores among them. */
  around(
    tracts: string[],
    lat: number,
    lon: number,
    limit: number,
  ): Promise<{ byType: Map<string, number>; nearestFullLine: Retailer[] }>;
  /** Retailers by store type for a county (5 digits), state (2 digits) or the nation (""). */
  countsIn(level: Level, geoid: string): Promise<Map<string, number>>;
  close(): Promise<void>;
}

export class SnapMissingError extends Error {
  constructor(location: string) {
    super(
      `The SNAP retailer data was not found at ${location}. Build it with: npm run build && npm run build:snap`,
    );
    this.name = "SnapMissingError";
  }
}

/** The SNAP files are small; this keeps a third DuckDB well clear of the others on a 512 MB machine. */
export const SNAP_DB_SETTINGS = { memory_limit: "32MB", threads: "1" };

export async function openSnap(location: string = defaultSnapLocation()): Promise<SnapStore> {
  const base = location.replace(/\/+$/, "");
  let manifest: SnapManifest;
  try {
    manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8")) as SnapManifest;
  } catch {
    throw new SnapMissingError(base);
  }
  const file = (name: string) => `read_parquet('${`${base}/${name}`.replace(/'/g, "''")}')`;
  const RETAILERS = file("retailers.parquet");
  const COUNTS = file("snap-counts.parquet");
  const db: DuckDBConnection = await (await DuckDBInstance.create(":memory:", SNAP_DB_SETTINGS)).connect();

  async function query(sql: string, values: Record<string, unknown>) {
    return (await db.runAndReadAll(sql, values as never)).getRowObjectsJson() as Record<string, unknown>[];
  }
  async function inTracts(sql: string, values: Record<string, unknown>, tracts: string[]) {
    const filter = tractFilter(tracts);
    const reader = await db.runAndReadAll(
      sql.replace("/*IN_TRACTS*/", filter.sql),
      { ...values, ...filter.values, tracts: listValue(tracts) } as never,
      { tracts: LIST(VARCHAR) } as never,
    );
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  }
  const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
  const toMap = (rows: Record<string, unknown>[]) =>
    new Map(rows.map((r) => [String(r.store_type), Number(r.n)] as [string, number]));

  return {
    manifest,

    async around(tracts, lat, lon, limit) {
      if (tracts.length === 0) return { byType: new Map(), nearestFullLine: [] };
      const byType = toMap(
        await inTracts(
          `SELECT store_type, count(*) AS n FROM ${RETAILERS} WHERE /*IN_TRACTS*/ GROUP BY 1`,
          {},
          tracts,
        ),
      );
      const rows = await inTracts(
        `SELECT name, store_type, address, city, state, ${MILES_SQL} AS miles
         FROM ${RETAILERS} WHERE full_line AND /*IN_TRACTS*/
         ORDER BY miles, name LIMIT $limit`,
        { lat, lon, limit: Math.trunc(limit) },
        tracts,
      );
      const nearestFullLine = rows.map((r) => {
        const parts = [text(r.address), text(r.city), text(r.state)].filter((p): p is string => p !== null);
        return {
          name: String(r.name ?? ""),
          type: String(r.store_type),
          address: parts.length ? parts.join(", ") : null,
          miles: Math.round(Number(r.miles) * 100) / 100,
        };
      });
      return { byType, nearestFullLine };
    },

    async countsIn(level, geoid) {
      return toMap(
        await query(`SELECT store_type, n FROM ${COUNTS} WHERE level = $level AND geoid = $geoid`, { level, geoid }),
      );
    },

    async close() {
      db.closeSync();
    },
  };
}
