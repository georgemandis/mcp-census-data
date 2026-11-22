/**
 * Builds the SNAP retailer data `nearby_places` reads, from USDA's list of
 * currently authorised retailers and the Census Bureau's tract boundaries.
 * Needs the network; needs no key.
 *
 *   npm run build && npm run build:snap
 *
 * Kept apart from build:places so the list, which USDA refreshes often, can
 * be rebuilt on its own. Assigns each retailer to the census tract
 * containing it and writes to CENSUS_SNAP_DIR or data/snap: the retailers,
 * counts by store type for every county, state and the nation, and a
 * manifest.
 */
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { FULL_LINE, defaultSnapLocation, type SnapManifest } from "../snap/store.js";
import { loadTractShapes } from "./build-places.js";

const DATASET = "https://hub.arcgis.com/api/v3/datasets/8b260f9a10b0459aa441ad8588c2251c_0";
export const SNAP_CSV_URL = `${DATASET}/downloads/data?format=csv&spatialRefId=4326&where=1%3D1`;
export const SNAP_METADATA_URL = DATASET;

const DOWNLOAD_TRIES = 3;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const quote = (path: string) => `'${path.replace(/'/g, "''")}'`;
const rowsOf = async (db: DuckDBConnection, sql: string) =>
  (await db.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[];

/** The date USDA last modified the list, from the Hub's dataset metadata. */
export function asOf(metadata: unknown): string {
  const modified = (metadata as { data?: { attributes?: { modified?: unknown } } })?.data?.attributes?.modified;
  if (typeof modified !== "number" || !Number.isFinite(modified)) {
    throw new Error("Could not read USDA's modified date");
  }
  return new Date(modified).toISOString().slice(0, 10);
}

/**
 * Reads USDA's CSV, assigns each retailer with coordinates to the tract
 * containing it, and writes `<outDir>/retailers.parquet`, sorted by tract.
 */
export async function writeRetailers(
  db: DuckDBConnection,
  csvPath: string,
  tractsTable: string,
  outDir: string,
): Promise<{ retailers: number; dropped: number; without_coordinates: number }> {
  await mkdir(outDir, { recursive: true });
  const text = (column: string) => `nullif(trim("${column}"), '')`;
  const fullLine = FULL_LINE.map((t) => quote(t)).join(", ");
  await db.run(`CREATE OR REPLACE TEMP TABLE snap_raw AS
    SELECT ${text("Store_Name")} AS name,
           concat_ws(' ', ${text("Store_Street_Address")}, ${text("Additonal_Address")}) AS address,
           ${text("City")} AS city,
           ${text("State")} AS state,
           ${text("Zip_Code")} AS zip,
           coalesce(${text("Store_Type")}, 'Other') AS store_type,
           TRY_CAST(${text("Latitude")} AS DOUBLE) AS lat,
           TRY_CAST(${text("Longitude")} AS DOUBLE) AS lon
    FROM read_csv(${quote(csvPath)}, header = true, all_varchar = true)`);
  await db.run(`CREATE OR REPLACE TEMP TABLE snap_placed AS
    SELECT r.*, r.store_type IN (${fullLine}) AS full_line, t.geoid AS tract
    FROM snap_raw r
    LEFT JOIN ${tractsTable} t ON ST_Contains(t.geom, ST_Point(r.lon, r.lat))
    WHERE r.lat IS NOT NULL AND r.lon IS NOT NULL`);
  await db.run(
    `COPY (
       SELECT name, nullif(address, '') AS address, city, state, zip, store_type, full_line, lat, lon, tract
       FROM snap_placed WHERE tract IS NOT NULL
       ORDER BY tract, name
     ) TO ${quote(join(outDir, "retailers.parquet"))} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000)`,
  );
  const [r] = await rowsOf(
    db,
    `SELECT (SELECT count(*) FROM snap_raw) AS total,
            (SELECT count(*) FROM snap_placed) AS placed,
            (SELECT count(tract) FROM snap_placed) AS kept`,
  );
  return {
    retailers: Number(r.kept),
    dropped: Number(r.placed) - Number(r.kept),
    without_coordinates: Number(r.total) - Number(r.placed),
  };
}

/**
 * Writes `<outDir>/snap-counts.parquet`: retailers by store type for every
 * county, state and the nation. Returns the number of rows.
 */
export async function writeSnapCounts(db: DuckDBConnection, outDir: string): Promise<number> {
  const retailers = `read_parquet(${quote(join(outDir, "retailers.parquet"))})`;
  const out = join(outDir, "snap-counts.parquet");
  const level = (name: string, geoid: string) =>
    `SELECT '${name}' AS level, ${geoid} AS geoid, store_type, count(*) AS n FROM ${retailers} GROUP BY ALL`;
  await db.run(
    `COPY (
       SELECT * FROM (
         ${level("county", "substr(tract, 1, 5)")}
         UNION ALL ${level("state", "substr(tract, 1, 2)")}
         UNION ALL ${level("us", "''")}
       ) ORDER BY level, geoid, store_type
     ) TO ${quote(out)} (FORMAT parquet, COMPRESSION zstd)`,
  );
  const [r] = await rowsOf(db, `SELECT count(*) AS n FROM read_parquet(${quote(out)})`);
  return Number(r.n);
}

async function download(url: string, to: string, log: (line: string) => void): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to));
      return;
    } catch (err) {
      if (attempt >= DOWNLOAD_TRIES) throw err;
      log(`Download failed (${err instanceof Error ? err.message : String(err)}); trying again…`);
    }
  }
}

async function main(): Promise<void> {
  const outDir = defaultSnapLocation();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  await mkdir(outDir, { recursive: true });
  const stage = await mkdtemp(join(tmpdir(), "snap-build-"));
  const db = await (
    await DuckDBInstance.create(":memory:", { temp_directory: join(stage, "duckdb") })
  ).connect();

  try {
    await db.run("INSTALL spatial; LOAD spatial;");
    log("Reading USDA's dataset metadata…");
    const meta = await fetch(SNAP_METADATA_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!meta.ok) throw new Error(`HTTP ${meta.status} for ${SNAP_METADATA_URL}`);
    const as_of = asOf(await meta.json());

    log(`Downloading USDA SNAP retailers (as of ${as_of})…`);
    const csv = join(stage, "retailers.csv");
    await download(SNAP_CSV_URL, csv, log);

    await loadTractShapes(db, stage, log);

    log("Assigning retailers to tracts…");
    const written = await writeRetailers(db, csv, "tracts", outDir);
    log(
      `retailers: ${written.retailers} kept, ${written.dropped} in no tract, ${written.without_coordinates} without coordinates`,
    );
    log(`counts: ${await writeSnapCounts(db, outDir)} rows`);

    const byType = await rowsOf(
      db,
      `SELECT store_type, n FROM read_parquet(${quote(join(outDir, "snap-counts.parquet"))})
       WHERE level = 'us' ORDER BY n DESC, store_type`,
    );
    const manifest: SnapManifest = {
      as_of,
      built: new Date().toISOString().slice(0, 10),
      ...written,
      by_type: Object.fromEntries(byType.map((r) => [String(r.store_type), Number(r.n)])),
    };
    await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
    log(`Done: ${outDir}`);
  } finally {
    db.closeSync();
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
