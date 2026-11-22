/**
 * Read access to the prebuilt places data (see scripts/build-places.ts):
 * every kept place with its type and census tract, counts by type for each
 * county, state and the nation, and the list of types.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance, LIST, VARCHAR, listValue, type DuckDBConnection } from "@duckdb/node-api";
import { DATA_DIR } from "../core/version.js";
import type { TypeNode } from "./types.js";

export interface PlacesManifest {
  /** The Overture Maps release the places came from. */
  release: string;
  built: string;
  places: number;
  /** Places left out because they fell in no census tract. */
  dropped: number;
}

export interface Place {
  name: string | null;
  /** The place's own type, for example "asian_grocery_store". */
  type: string;
  path: string;
  /** Street, city and state, as far as known. */
  address: string | null;
  /** Straight-line distance from the point asked about. */
  miles: number;
}

export type Level = "county" | "state" | "us";

export interface PlacesStore {
  manifest: PlacesManifest;
  types(): Promise<TypeNode[]>;
  /** Places of a type, or beneath it in the type tree, in the given tracts. */
  countHere(node: string, tracts: string[]): Promise<number>;
  /** The same count for a whole county (5 digits), state (2 digits) or the nation (""). */
  countIn(level: Level, geoid: string, node: string): Promise<number>;
  nearest(node: string, tracts: string[], lat: number, lon: number, limit: number): Promise<Place[]>;
  /** Count by Overture's broad category in the given tracts. */
  broadHere(tracts: string[]): Promise<Map<string, number>>;
  broadIn(level: Level, geoid: string): Promise<Map<string, number>>;
  close(): Promise<void>;
}

export class PlacesMissingError extends Error {
  constructor(location: string) {
    super(
      `The places data was not found at ${location}. Build it with: npm run build && npm run build:places`,
    );
    this.name = "PlacesMissingError";
  }
}

/** Limits on DuckDB for places, beside the profile store on a 512 MB machine. */
export const PLACES_DB_SETTINGS = { memory_limit: "192MB", threads: "2" };

/** Where the data is read from: CENSUS_PLACES_DIR, or data/places inside the project. */
export function defaultPlacesLocation(env: Record<string, string | undefined> = process.env): string {
  return env.CENSUS_PLACES_DIR || join(DATA_DIR, "places");
}

// A node of the type tree takes in itself and everything beneath it.
const UNDER = `(path = $node OR starts_with(path, $node || ' > '))`;
// The file is sorted by tract, so the range lets DuckDB skip most of it.
const IN_TRACTS = `tract BETWEEN $lo AND $hi AND tract IN (SELECT unnest($tracts))`;
const MILES = `3958.8 * 2 * asin(sqrt(
  pow(sin(radians(lat - $lat) / 2), 2) +
  cos(radians($lat)) * cos(radians(lat)) * pow(sin(radians(lon - $lon) / 2), 2)))`;

export async function openPlaces(location: string = defaultPlacesLocation()): Promise<PlacesStore> {
  const base = location.replace(/\/+$/, "");
  let manifest: PlacesManifest;
  let types: TypeNode[];
  try {
    manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8")) as PlacesManifest;
    types = JSON.parse(await readFile(join(base, "place-types.json"), "utf8")) as TypeNode[];
  } catch {
    throw new PlacesMissingError(base);
  }
  const file = (name: string) => `read_parquet('${`${base}/${name}`.replace(/'/g, "''")}')`;
  const PLACES = file("places.parquet");
  const COUNTS = file("place-counts.parquet");

  const db: DuckDBConnection = await (
    await DuckDBInstance.create(":memory:", PLACES_DB_SETTINGS)
  ).connect();

  async function query(sql: string, values: Record<string, unknown>, tracts?: string[]) {
    const all = tracts
      ? { ...values, tracts: listValue(tracts), lo: tracts.reduce((a, b) => (a < b ? a : b)), hi: tracts.reduce((a, b) => (a > b ? a : b)) }
      : values;
    const reader = await db.runAndReadAll(sql, all as never, (tracts ? { tracts: LIST(VARCHAR) } : undefined) as never);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  }

  const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
  const toMap = (rows: Record<string, unknown>[]) =>
    new Map(rows.map((r) => [String(r.basic_category), Number(r.n)] as [string, number]));

  return {
    manifest,

    async types() {
      return types;
    },

    async countHere(node, tracts) {
      if (tracts.length === 0) return 0;
      const [r] = await query(
        `SELECT count(*) AS n FROM ${PLACES} WHERE ${IN_TRACTS} AND ${UNDER}`,
        { node },
        tracts,
      );
      return Number(r.n);
    },

    async countIn(level, geoid, node) {
      const [r] = await query(
        `SELECT coalesce(sum(n), 0) AS n FROM ${COUNTS}
         WHERE level = $level AND geoid = $geoid AND ${UNDER}`,
        { level, geoid, node },
      );
      return Number(r.n);
    },

    async nearest(node, tracts, lat, lon, limit) {
      if (tracts.length === 0) return [];
      const rows = await query(
        `SELECT name, category, path, address, city, state, ${MILES} AS miles
         FROM ${PLACES} WHERE ${IN_TRACTS} AND ${UNDER}
         ORDER BY miles, name LIMIT $limit`,
        { node, lat, lon, limit: Math.trunc(limit) },
        tracts,
      );
      return rows.map((r) => {
        const parts = [text(r.address), text(r.city), text(r.state)].filter((p): p is string => p !== null);
        return {
          name: text(r.name),
          type: String(r.category),
          path: String(r.path),
          address: parts.length ? parts.join(", ") : null,
          miles: Math.round(Number(r.miles) * 100) / 100,
        };
      });
    },

    async broadHere(tracts) {
      if (tracts.length === 0) return new Map();
      return toMap(
        await query(
          `SELECT basic_category, count(*) AS n FROM ${PLACES}
           WHERE ${IN_TRACTS} AND basic_category IS NOT NULL GROUP BY 1`,
          {},
          tracts,
        ),
      );
    },

    async broadIn(level, geoid) {
      return toMap(
        await query(
          `SELECT basic_category, sum(n) AS n FROM ${COUNTS}
           WHERE level = $level AND geoid = $geoid AND basic_category IS NOT NULL GROUP BY 1`,
          { level, geoid },
        ),
      );
    },

    async close() {
      db.closeSync();
    },
  };
}
