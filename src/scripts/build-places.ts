/**
 * Builds the data `nearby_places` reads, from Overture Maps Places and the
 * Census Bureau's tract boundaries. Needs the network; needs no key.
 *
 *   npm run build && npm run build:places
 *
 * Keeps places in the United States and its territories that Overture marks
 * open with confidence 0.75 or more and that have a type, assigns each to
 * the census tract containing it, and writes to CENSUS_PLACES_DIR or
 * data/places: the places, counts by type for every county, state and the
 * nation, the list of types, and a manifest.
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { defaultPlacesLocation, type PlacesManifest } from "../places/store.js";

const run = promisify(execFile);

export const OVERTURE_RELEASE = "2026-11-18.0";
export const TRACT_SHAPES =
  "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_tract_500k.zip";

/** Country codes Overture uses for the United States and its territories. */
const COUNTRIES = ["US", "PR", "VI", "GU", "AS", "MP"];
const MIN_CONFIDENCE = 0.75;
const GIB = 1024 ** 3;

export function overtureSource(release: string): string {
  return `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`;
}

const quote = (path: string) => `'${path.replace(/'/g, "''")}'`;

/**
 * The places to keep, as one SELECT over an Overture-shaped relation
 * (a table name, or a read_parquet(...) call).
 */
export function selectPlacesSql(source: string): string {
  return `
    SELECT names."primary" AS name,
           taxonomy."primary" AS category,
           array_to_string(taxonomy.hierarchy, ' > ') AS path,
           basic_category,
           addresses[1].freeform AS address,
           addresses[1].locality AS city,
           addresses[1].region AS state,
           addresses[1].postcode AS postcode,
           (bbox.xmin + bbox.xmax) / 2 AS lon,
           (bbox.ymin + bbox.ymax) / 2 AS lat,
           sources[1].dataset AS source,
           sources[1].license AS license
    FROM ${source}
    WHERE addresses[1].country IN (${COUNTRIES.map((c) => `'${c}'`).join(", ")})
      AND operating_status = 'open'
      AND confidence >= ${MIN_CONFIDENCE}
      AND taxonomy."primary" IS NOT NULL
      AND len(taxonomy.hierarchy) > 0`;
}

const rowsOf = async (db: DuckDBConnection, sql: string) =>
  (await db.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[];

/**
 * Assigns each selected place to the tract containing it and writes
 * `<outDir>/places.parquet`, sorted by tract. `tractsTable` has columns
 * `geoid` and `geom`. Places in no tract are dropped and counted.
 */
export async function writePlaces(
  db: DuckDBConnection,
  selectSql: string,
  tractsTable: string,
  outDir: string,
): Promise<{ places: number; dropped: number; sources: { dataset: string; license: string; n: number }[] }> {
  await mkdir(outDir, { recursive: true });
  const staged = join(outDir, "places-staged.parquet");
  const out = join(outDir, "places.parquet");
  try {
    // Staged first, so places in no tract can be counted without reading the source twice.
    await db.run(
      `COPY (
         SELECT p.*, t.geoid AS tract
         FROM (${selectSql}) p
         LEFT JOIN ${tractsTable} t ON ST_Contains(t.geom, ST_Point(p.lon, p.lat))
       ) TO ${quote(staged)} (FORMAT parquet, COMPRESSION zstd)`,
    );
    const [totals] = await rowsOf(
      db,
      `SELECT count(*) AS n, count(tract) AS kept FROM read_parquet(${quote(staged)})`,
    );
    await db.run(
      `COPY (
         SELECT name, category, path, basic_category, address, city, state, postcode, lon, lat, tract, source
         FROM read_parquet(${quote(staged)})
         WHERE tract IS NOT NULL
         ORDER BY tract, path, name
       ) TO ${quote(out)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000)`,
    );
    const sources = (
      await rowsOf(
        db,
        `SELECT coalesce(source, 'unknown') AS dataset, coalesce(license, 'unknown') AS license, count(*) AS n
         FROM read_parquet(${quote(staged)}) WHERE tract IS NOT NULL GROUP BY 1, 2 ORDER BY n DESC, dataset`,
      )
    ).map((r) => ({ dataset: String(r.dataset), license: String(r.license), n: Number(r.n) }));
    const kept = Number(totals.kept);
    return { places: kept, dropped: Number(totals.n) - kept, sources };
  } finally {
    await rm(staged, { force: true });
  }
}

/**
 * Writes `<outDir>/place-counts.parquet`: places by type and broad type for
 * every county, state and the nation. Returns the number of rows.
 */
export async function writeCounts(db: DuckDBConnection, outDir: string): Promise<number> {
  const places = `read_parquet(${quote(join(outDir, "places.parquet"))})`;
  const out = join(outDir, "place-counts.parquet");
  const level = (name: string, geoid: string) =>
    `SELECT '${name}' AS level, ${geoid} AS geoid, path, basic_category, count(*) AS n FROM ${places} GROUP BY ALL`;
  await db.run(
    `COPY (
       SELECT * FROM (
         ${level("county", "substr(tract, 1, 5)")}
         UNION ALL ${level("state", "substr(tract, 1, 2)")}
         UNION ALL ${level("us", "''")}
       ) ORDER BY level, geoid, path
     ) TO ${quote(out)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 20000)`,
  );
  const [r] = await rowsOf(db, `SELECT count(*) AS n FROM read_parquet(${quote(out)})`);
  return Number(r.n);
}

/**
 * Writes `<outDir>/place-types.json`: every node of the type tree (each
 * prefix of each path) with its national count. Returns the number of nodes.
 */
export async function writeTypes(db: DuckDBConnection, outDir: string): Promise<number> {
  const leaves = await rowsOf(
    db,
    `SELECT path, sum(n) AS n FROM read_parquet(${quote(join(outDir, "place-counts.parquet"))})
     WHERE level = 'us' GROUP BY path`,
  );
  const nodes = new Map<string, number>();
  for (const leaf of leaves) {
    const levels = String(leaf.path).split(" > ");
    for (let i = 1; i <= levels.length; i++) {
      const node = levels.slice(0, i).join(" > ");
      nodes.set(node, (nodes.get(node) ?? 0) + Number(leaf.n));
    }
  }
  const types = [...nodes]
    .map(([path, n]) => ({ path, name: path.split(" > ").at(-1)!, n }))
    .sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(join(outDir, "place-types.json"), JSON.stringify(types));
  return types.length;
}

const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

async function main(): Promise<void> {
  const outDir = defaultPlacesLocation();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  await mkdir(outDir, { recursive: true });
  const stage = await mkdtemp(join(tmpdir(), "places-build-"));
  const db = await (
    await DuckDBInstance.create(":memory:", { temp_directory: join(stage, "duckdb") })
  ).connect();

  try {
    await db.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region = 'us-west-2';");

    log("Downloading census tract boundaries…");
    const zip = join(stage, "tracts.zip");
    const res = await fetch(TRACT_SHAPES);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${TRACT_SHAPES}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zip));
    try {
      await run("unzip", ["-o", "-q", zip, "-d", join(stage, "tracts")]);
    } catch {
      throw new Error("Could not unzip the tract boundaries. The `unzip` command is required.");
    }
    const [shp] = (await readdir(join(stage, "tracts"))).filter((f) => f.endsWith(".shp"));
    if (!shp) throw new Error(`No shapefile inside ${TRACT_SHAPES}`);
    await db.run(
      `CREATE TABLE tracts AS SELECT GEOID AS geoid, geom FROM ST_Read(${quote(join(stage, "tracts", shp))})`,
    );

    log(`Reading Overture Maps Places ${OVERTURE_RELEASE} and assigning tracts (a few minutes)…`);
    const source = `read_parquet(${quote(overtureSource(OVERTURE_RELEASE))}, hive_partitioning = 1)`;
    const written = await writePlaces(db, selectPlacesSql(source), "tracts", outDir);
    log(`places: ${written.places} kept, ${written.dropped} in no tract`);
    log(`counts: ${await writeCounts(db, outDir)} rows`);
    log(`types: ${await writeTypes(db, outDir)} nodes`);

    let total = 0;
    for (const name of await readdir(outDir)) total += (await stat(join(outDir, name))).size;
    if (total > GIB) throw new Error(`The built places data is ${mb(total)}, over the ${mb(GIB)} limit.`);

    const manifest: PlacesManifest & { sources: typeof written.sources } = {
      release: OVERTURE_RELEASE,
      built: new Date().toISOString().slice(0, 10),
      places: written.places,
      dropped: written.dropped,
      sources: written.sources,
    };
    await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
    log(`Done: ${mb(total)} in ${outDir}`);
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
