/**
 * Read access to the prebuilt profile data (see scripts/build-acs.ts):
 * one Parquet file per ACS table, a file of centre points, and a manifest.
 * DuckDB reads the files; nothing here calls the Census API.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DuckDBInstance, LIST, VARCHAR, listValue, type DuckDBConnection } from "@duckdb/node-api";
import { plain } from "../core/geography.js";
import { tablesUsed } from "./definition.js";

export interface Manifest {
  acs_year: number;
  period: string;
  built: string;
  tables: Record<string, number>;
  points: number;
}

export interface TractPoint {
  /** 11-digit tract code. */
  geoid: string;
  lat: number;
  lon: number;
  miles: number;
}

export interface PlacePoint {
  geoid: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
}

/** Column name (for example "B22003_E002") to value. */
export type Row = Record<string, number | null>;

export interface Store {
  manifest: Manifest;
  /** Rows of one table for the given full GEO_IDs, keyed by GEO_ID. */
  rows(table: string, geoIds: string[]): Promise<Map<string, Row>>;
  tractsNear(
    lat: number,
    lon: number,
    radiusMiles: number,
    limit: number,
  ): Promise<{ tracts: TractPoint[]; inRange: number }>;
  nearestTract(lat: number, lon: number): Promise<TractPoint | null>;
  zip(zip: string): Promise<PlacePoint | null>;
  places(name: string, state?: string): Promise<PlacePoint[]>;
  close(): Promise<void>;
}

export class DataMissingError extends Error {
  constructor(location: string) {
    super(
      `The profile data was not found at ${location}. Build it with: npm run build && npm run build:acs`,
    );
    this.name = "DataMissingError";
  }
}

export function geoId(level: "us" | "state" | "county" | "tract", fips = ""): string {
  const prefix = { us: "0100000US", state: "0400000US", county: "0500000US", tract: "1400000US" };
  return prefix[level] + (level === "us" ? "" : fips);
}

// Words the Census Bureau appends to place names ("Seattle city").
const PLACE_SUFFIX =
  / (city|town|village|borough|municipality|cdp|comunidad|zona urbana|city and borough|urban county|(consolidated|metropolitan|unified) government)( \(balance\))?$/;

/** A place name as people type it: folded case and accents, no type suffix. */
export function placeKey(name: string): string {
  return plain(name).replace(PLACE_SUFFIX, "").replace(/ \(balance\)$/, "");
}

// Great-circle distance in miles between ($lat, $lon) and a row's lat/lon.
const MILES = `3958.8 * 2 * asin(sqrt(
  pow(sin(radians(lat - $lat) / 2), 2) +
  cos(radians($lat)) * cos(radians(lat)) * pow(sin(radians(lon - $lon) / 2), 2)))`;

const isRemote = (location: string) => /^https?:\/\//i.test(location);

async function readManifest(location: string): Promise<Manifest> {
  try {
    if (isRemote(location)) {
      const res = await fetch(`${location}/manifest.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Manifest;
    }
    return JSON.parse(await readFile(join(location, "manifest.json"), "utf8")) as Manifest;
  } catch {
    throw new DataMissingError(location);
  }
}

export async function openStore(
  location: string = process.env.CENSUS_DATA_DIR ?? "data/acs",
): Promise<Store> {
  const base = location.replace(/\/+$/, "");
  const manifest = await readManifest(base);
  const file = (name: string) => `${base}/${name}`.replace(/'/g, "''");

  const instance = await DuckDBInstance.create(":memory:");
  const db: DuckDBConnection = await instance.connect();
  if (isRemote(base)) {
    await db.run("INSTALL httpfs");
    await db.run("LOAD httpfs");
  }
  // Points are small (about 150,000 rows) and used on every request.
  await db.run(
    `CREATE TABLE points AS
     SELECT kind, geoid, name, state, CAST(lat AS DOUBLE) AS lat, CAST(lon AS DOUBLE) AS lon
     FROM read_parquet('${file("points.parquet")}')`,
  );

  const known = new Set(tablesUsed());
  let placeIndex: Map<string, PlacePoint[]> | undefined;

  async function query(
    sql: string,
    values: Record<string, unknown> = {},
    types?: Record<string, unknown>,
  ) {
    const reader = await db.runAndReadAll(sql, values as never, types as never);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  }

  const toTract = (r: Record<string, unknown>): TractPoint => ({
    geoid: String(r.geoid),
    lat: Number(r.lat),
    lon: Number(r.lon),
    miles: Number(r.miles),
  });

  const toPlace = (r: Record<string, unknown>): PlacePoint => ({
    geoid: String(r.geoid),
    name: String(r.name ?? ""),
    state: String(r.state ?? ""),
    lat: Number(r.lat),
    lon: Number(r.lon),
  });

  return {
    manifest,

    async rows(table, geoIds) {
      if (!known.has(table)) throw new Error(`Table ${table} is not part of the profile.`);
      const out = new Map<string, Row>();
      if (geoIds.length === 0) return out;
      const found = await query(
        `SELECT GEO_ID, CAST(COLUMNS(* EXCLUDE (GEO_ID)) AS DOUBLE)
         FROM read_parquet('${file(`${table.toLowerCase()}.parquet`)}')
         WHERE GEO_ID IN (SELECT unnest($ids))`,
        { ids: listValue(geoIds) },
        { ids: LIST(VARCHAR) },
      );
      for (const r of found) {
        const { GEO_ID, ...cells } = r;
        const row: Row = {};
        for (const [k, v] of Object.entries(cells)) row[k] = v === null ? null : Number(v);
        out.set(String(GEO_ID), row);
      }
      return out;
    },

    async tractsNear(lat, lon, radiusMiles, limit) {
      const found = await query(
        `SELECT geoid, lat, lon, miles, count(*) OVER () AS in_range
         FROM (SELECT geoid, lat, lon, ${MILES} AS miles FROM points WHERE kind = 'tract')
         WHERE miles <= $radius
         ORDER BY miles, geoid
         LIMIT $limit`,
        { lat, lon, radius: radiusMiles, limit: Math.trunc(limit) },
      );
      return { tracts: found.map(toTract), inRange: found.length ? Number(found[0].in_range) : 0 };
    },

    async nearestTract(lat, lon) {
      const found = await query(
        `SELECT geoid, lat, lon, ${MILES} AS miles FROM points WHERE kind = 'tract'
         ORDER BY miles, geoid LIMIT 1`,
        { lat, lon },
      );
      return found.length ? toTract(found[0]) : null;
    },

    async zip(zip) {
      const found = await query(
        `SELECT geoid, name, state, lat, lon FROM points WHERE kind = 'zcta' AND geoid = $zip LIMIT 1`,
        { zip },
      );
      return found.length ? toPlace(found[0]) : null;
    },

    async places(name, state) {
      if (!placeIndex) {
        placeIndex = new Map();
        const all = await query(
          `SELECT geoid, name, state, lat, lon FROM points WHERE kind = 'place' ORDER BY state, name`,
        );
        for (const r of all) {
          const p = toPlace(r);
          for (const key of new Set([placeKey(p.name), plain(p.name)])) {
            const list = placeIndex.get(key);
            if (list) list.push(p);
            else placeIndex.set(key, [p]);
          }
        }
      }
      const matches = placeIndex.get(placeKey(name)) ?? placeIndex.get(plain(name)) ?? [];
      const st = state?.trim().toUpperCase();
      return st ? matches.filter((p) => p.state === st) : [...matches];
    },

    async close() {
      db.closeSync();
    },
  };
}
