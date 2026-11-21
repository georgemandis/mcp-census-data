/**
 * Builds the data `profile_place` reads, from files the Census Bureau
 * publishes for bulk download. Needs no API key.
 *
 *   npm run build && npm run build:acs [-- --force]
 *
 * For each ACS table the profile uses, downloads the national file (one row
 * per geography of every kind), keeps the nation, states, counties and
 * tracts, keeps only the columns in use, and writes one Parquet file. Also
 * writes centre points for tracts, ZIP code areas and places, and a
 * manifest. Output goes to CENSUS_DATA_DIR, or data/acs.
 */
import { execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { ACS_PERIOD, ACS_YEAR, columnsFor, tablesUsed } from "../profile/definition.js";
import { defaultLocation, type Manifest } from "../profile/store.js";

const run = promisify(execFile);

export function tableUrl(table: string): string {
  return `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_YEAR}/table-based-SF/data/5YRData/acsdt5y${ACS_YEAR}-${table.toLowerCase()}.dat`;
}

const GAZ = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${ACS_YEAR}_Gazetteer/${ACS_YEAR}_Gaz_`;

export const GAZETTEER: Record<"tract" | "zcta" | "place", string> = {
  tract: `${GAZ}tracts_national.zip`,
  zcta: `${GAZ}zcta_national.zip`,
  place: `${GAZ}place_national.zip`,
};

const GIB = 1024 ** 3;
const quote = (path: string) => `'${path.replace(/'/g, "''")}'`;

async function withDb<T>(fn: (db: DuckDBConnection) => Promise<T>): Promise<T> {
  const db = await (await DuckDBInstance.create(":memory:")).connect();
  try {
    return await fn(db);
  } finally {
    db.closeSync();
  }
}

// The margin value the Bureau uses for a controlled estimate, which has no
// sampling error. Every other negative value is a "not available" marker.
const CONTROLLED = -555555555;

function columnSql(column: string): string {
  const v = `TRY_CAST("${column}" AS DOUBLE)`;
  const isMargin = /_M\d{3}$/.test(column);
  return isMargin
    ? `CASE WHEN ${v} = ${CONTROLLED} THEN 0 WHEN ${v} >= 0 THEN ${v} END AS "${column}"`
    : `CASE WHEN ${v} >= 0 THEN ${v} END AS "${column}"`;
}

/**
 * Converts one bulk table file to `<outDir>/<table>.parquet` and returns the
 * number of rows written.
 */
export async function convertTable(datPath: string, table: string, outDir: string): Promise<number> {
  await mkdir(outDir, { recursive: true });
  const source = `read_csv(${quote(datPath)}, delim = '|', header = true, all_varchar = true)`;
  const out = join(outDir, `${table.toLowerCase()}.parquet`);
  const wanted = columnsFor(table);

  return withDb(async (db) => {
    const described = await db.runAndReadAll(`DESCRIBE SELECT * FROM ${source}`);
    const present = new Set(described.getRowObjectsJson().map((r) => String(r.column_name)));
    const missing = ["GEO_ID", ...wanted].filter((c) => !present.has(c));
    if (missing.length) {
      throw new Error(`${table}: the Census file has no column ${missing.join(", ")}.`);
    }
    await db.run(
      `COPY (
         SELECT GEO_ID, ${wanted.map(columnSql).join(", ")}
         FROM ${source}
         WHERE GEO_ID = '0100000US'
            OR GEO_ID LIKE '0400000US%'
            OR GEO_ID LIKE '0500000US%'
            OR GEO_ID LIKE '1400000US%'
         ORDER BY GEO_ID
       ) TO ${quote(out)} (FORMAT parquet, COMPRESSION zstd)`,
    );
    const counted = await db.runAndReadAll(`SELECT count(*) AS n FROM read_parquet(${quote(out)})`);
    return Number(counted.getRowObjectsJson()[0].n);
  });
}

/**
 * Converts the three Gazetteer text files to `<outDir>/points.parquet` and
 * returns the number of rows written. The files are tab-separated and every
 * line is padded with trailing spaces, so columns are read by position.
 */
export async function convertPoints(
  files: { tract: string; zcta: string; place: string },
  outDir: string,
): Promise<number> {
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, "points.parquet");
  const csv = (path: string, n: number) =>
    `read_csv(${quote(path)}, delim = '\t', header = false, skip = 1, all_varchar = true, quote = '',
       columns = {${Array.from({ length: n }, (_, i) => `'c${i}': 'VARCHAR'`).join(", ")}})`;
  const num = (c: string) => `CAST(trim(${c}) AS DOUBLE)`;

  return withDb(async (db) => {
    await db.run(
      `COPY (
         SELECT 'tract' AS kind, trim(c1) AS geoid, CAST(NULL AS VARCHAR) AS name, trim(c0) AS state,
                ${num("c6")} AS lat, ${num("c7")} AS lon
         FROM ${csv(files.tract, 8)}
         UNION ALL
         SELECT 'zcta', trim(c0), NULL, NULL, ${num("c5")}, ${num("c6")}
         FROM ${csv(files.zcta, 7)}
         UNION ALL
         SELECT 'place', trim(c1), trim(c3), trim(c0), ${num("c10")}, ${num("c11")}
         FROM ${csv(files.place, 12)}
       ) TO ${quote(out)} (FORMAT parquet, COMPRESSION zstd)`,
    );
    const counted = await db.runAndReadAll(`SELECT count(*) AS n FROM read_parquet(${quote(out)})`);
    return Number(counted.getRowObjectsJson()[0].n);
  });
}

/** Sizes of the Parquet files in `outDir`. Throws when the total is over the limit. */
export async function checkSize(
  outDir: string,
  limitBytes: number = GIB,
): Promise<{ total: number; files: Record<string, number> }> {
  const files: Record<string, number> = {};
  for (const name of (await readdir(outDir)).sort()) {
    if (name.endsWith(".parquet")) files[name] = (await stat(join(outDir, name))).size;
  }
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  if (total > limitBytes) {
    const list = Object.entries(files)
      .map(([name, size]) => `  ${name}: ${mb(size)}`)
      .join("\n");
    throw new Error(`The built data is ${mb(total)}, over the ${mb(limitBytes)} limit.\n${list}`);
  }
  return { total, files };
}

const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

async function download(url: string, to: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to));
  return (await stat(to)).size;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const outDir = defaultLocation();
  if (/^https?:/i.test(outDir)) throw new Error("CENSUS_DATA_DIR must be a local directory to build into.");
  const log = (line: string) => process.stderr.write(`${line}\n`);
  await mkdir(outDir, { recursive: true });
  const stage = await mkdtemp(join(tmpdir(), "acs-build-"));
  const tables: Record<string, number> = {};

  try {
    const names = tablesUsed();
    for (const [i, table] of names.entries()) {
      const out = join(outDir, `${table.toLowerCase()}.parquet`);
      const tag = `[${i + 1}/${names.length}] ${table}`;
      if (existsSync(out) && !force) {
        tables[table] = await withDb(async (db) => {
          const r = await db.runAndReadAll(`SELECT count(*) AS n FROM read_parquet(${quote(out)})`);
          return Number(r.getRowObjectsJson()[0].n);
        });
        log(`${tag}: already built (${tables[table]} rows)`);
        continue;
      }
      const dat = join(stage, `${table}.dat`);
      const size = await download(tableUrl(table), dat);
      tables[table] = await convertTable(dat, table, outDir);
      await rm(dat, { force: true });
      log(`${tag}: ${mb(size)} downloaded, ${tables[table]} rows kept`);
    }

    const texts: Record<string, string> = {};
    for (const [kind, url] of Object.entries(GAZETTEER)) {
      const zip = join(stage, `${kind}.zip`);
      const dir = join(stage, kind);
      await download(url, zip);
      await mkdir(dir);
      try {
        await run("unzip", ["-o", "-q", zip, "-d", dir]);
      } catch {
        throw new Error("Could not unzip the Gazetteer files. The `unzip` command is required.");
      }
      const [name] = (await readdir(dir)).filter((f) => f.endsWith(".txt"));
      if (!name) throw new Error(`No text file inside ${url}`);
      texts[kind] = join(dir, name);
    }
    const points = await convertPoints(
      { tract: texts.tract, zcta: texts.zcta, place: texts.place },
      outDir,
    );
    log(`points: ${points} centre points`);

    const sizes = await checkSize(outDir);
    const manifest: Manifest = {
      acs_year: ACS_YEAR,
      period: ACS_PERIOD,
      built: new Date().toISOString().slice(0, 10),
      tables,
      points,
    };
    await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
    log(`Done: ${Object.keys(tables).length} tables, ${mb(sizes.total)} in ${outDir}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
