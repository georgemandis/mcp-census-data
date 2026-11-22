/**
 * Read access to the prebuilt places data (see scripts/build-places.ts):
 * every kept place with its type and census tract, counts by type for each
 * county, state and the nation, and the list of types.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance, INTEGER, LIST, VARCHAR, listValue, type DuckDBConnection } from "@duckdb/node-api";
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
  /** Counts and nearest places for several types at once, in the order given. */
  around(
    nodes: string[],
    tracts: string[],
    lat: number,
    lon: number,
    limit: number,
  ): Promise<{ counts: number[]; nearest: Place[][] }>;
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
// Replaced in each query by a filter on the area's tracts; see tractFilter.
const IN_TRACTS = "/*IN_TRACTS*/";
/** Beyond this many counties, one range over all of them is used. */
const MAX_RANGES = 60;

/**
 * A filter for the given tracts. The file is sorted by tract, so a range
 * lets DuckDB skip most of it. One range per county keeps that true when an
 * area crosses a county or state line; a single range from the lowest tract
 * to the highest would then take in whole states in between.
 */
export function tractFilter(tracts: string[]): { sql: string; values: Record<string, string> } {
  const byCounty = new Map<string, { lo: string; hi: string }>();
  for (const t of tracts) {
    const county = t.slice(0, 5);
    const r = byCounty.get(county);
    if (!r) byCounty.set(county, { lo: t, hi: t });
    else {
      if (t < r.lo) r.lo = t;
      if (t > r.hi) r.hi = t;
    }
  }
  let ranges = [...byCounty.values()];
  if (ranges.length > MAX_RANGES) {
    ranges = [{ lo: tracts.reduce((a, b) => (a < b ? a : b)), hi: tracts.reduce((a, b) => (a > b ? a : b)) }];
  }
  const values: Record<string, string> = {};
  const parts = ranges.map((r, i) => {
    values[`lo${i}`] = r.lo;
    values[`hi${i}`] = r.hi;
    return `tract BETWEEN $lo${i} AND $hi${i}`;
  });
  return { sql: `(${parts.join(" OR ")}) AND tract IN (SELECT unnest($tracts))`, values };
}
/** Straight-line miles from ($lat, $lon) to a row's lat and lon. */
export const MILES_SQL = `3958.8 * 2 * asin(sqrt(
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

  async function query(
    sql: string,
    values: Record<string, unknown>,
    tracts?: string[],
    types: Record<string, unknown> = {},
  ) {
    let all = values;
    let allTypes = types;
    let text = sql;
    if (tracts) {
      const filter = tractFilter(tracts);
      text = sql.replace(IN_TRACTS, filter.sql);
      all = { ...values, ...filter.values, tracts: listValue(tracts) };
      allTypes = { ...types, tracts: LIST(VARCHAR) };
    }
    const reader = await db.runAndReadAll(
      text,
      all as never,
      (Object.keys(allTypes).length ? allTypes : undefined) as never,
    );
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  }

  const toPlace = (r: Record<string, unknown>): Place => {
    // Overture writes the state as "US-WA".
    const state = text(r.state)?.replace(/^US-/, "") ?? null;
    const parts = [text(r.address), text(r.city), state].filter((p): p is string => p !== null);
    return {
      name: text(r.name),
      type: String(r.category),
      path: String(r.path),
      address: parts.length ? parts.join(", ") : null,
      miles: Math.round(Number(r.miles) * 100) / 100,
    };
  };

  /** Counts and nearest places for several types, in two reads of the area. */
  async function around(nodes: string[], tracts: string[], lat: number, lon: number, limit: number) {
    if (nodes.length === 0) return { counts: [], nearest: [] };
    if (tracts.length === 0) return { counts: nodes.map(() => 0), nearest: nodes.map(() => []) };
    const names = Object.fromEntries(nodes.map((node, i) => [`n${i}`, node]));
    const filters = nodes.map(
      (_, i) => `count(*) FILTER (WHERE path = $n${i} OR starts_with(path, $n${i} || ' > ')) AS c${i}`,
    );
    const [counted] = await query(`SELECT ${filters.join(", ")} FROM ${PLACES} WHERE ${IN_TRACTS}`, names, tracts);
    const counts = nodes.map((_, i) => Number(counted[`c${i}`]));

    const nearest: Place[][] = nodes.map(() => []);
    if (counts.some((c) => c > 0)) {
      const rows = await query(
        `SELECT k, name, category, path, address, city, state, miles FROM (
           SELECT n.k, p.name, p.category, p.path, p.address, p.city, p.state, ${MILES_SQL} AS miles,
                  row_number() OVER (PARTITION BY n.k ORDER BY ${MILES_SQL}, p.name) AS rn
           FROM ${PLACES} p
           JOIN (SELECT unnest($ks) AS k, unnest($nodes) AS node) n
             ON p.path = n.node OR starts_with(p.path, n.node || ' > ')
           WHERE ${IN_TRACTS}
         ) WHERE rn <= $limit ORDER BY k, rn`,
        { ks: listValue(nodes.map((_, i) => i)), nodes: listValue(nodes), lat, lon, limit: Math.trunc(limit) },
        tracts,
        { ks: LIST(INTEGER), nodes: LIST(VARCHAR) },
      );
      for (const r of rows) nearest[Number(r.k)].push(toPlace(r));
    }
    return { counts, nearest };
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
      return (await around([node], tracts, 0, 0, 0)).counts[0];
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
      return (await around([node], tracts, lat, lon, limit)).nearest[0];
    },

    around,

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
