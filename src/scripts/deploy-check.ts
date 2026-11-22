/**
 * Refuses a deploy when the profile data is not fully built, so an image
 * without it cannot be shipped by accident.
 *
 *   npm run deploy:check
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DATA_DIR } from "../core/version.js";
import type { Manifest } from "../profile/store.js";

const HOW = "Build it first: npm run build && npm run build:acs";

export async function checkDeployable(
  dataDir: string,
): Promise<{ tables: number; megabytes: number }> {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(join(dataDir, "manifest.json"), "utf8")) as Manifest;
  } catch {
    throw new Error(`No profile data at ${dataDir}. ${HOW}`);
  }
  const files = [...Object.keys(manifest.tables).map((t) => `${t.toLowerCase()}.parquet`), "points.parquet"];
  const missing: string[] = [];
  let bytes = 0;
  for (const name of files) {
    try {
      bytes += (await stat(join(dataDir, name))).size;
    } catch {
      missing.push(name);
    }
  }
  if (missing.length) {
    throw new Error(`The profile data at ${dataDir} is incomplete: ${missing.join(", ")} missing. ${HOW}`);
  }
  return { tables: Object.keys(manifest.tables).length, megabytes: Math.round((bytes / 1024 ** 2) * 10) / 10 };
}

const HOW_PLACES = "Build it first: npm run build && npm run build:places";

export async function checkPlacesDeployable(
  dataDir: string,
): Promise<{ places: number; megabytes: number }> {
  let manifest: { places: number };
  try {
    manifest = JSON.parse(await readFile(join(dataDir, "manifest.json"), "utf8")) as { places: number };
  } catch {
    throw new Error(`No places data at ${dataDir}. ${HOW_PLACES}`);
  }
  const missing: string[] = [];
  let bytes = 0;
  for (const name of ["places.parquet", "place-counts.parquet", "place-types.json"]) {
    try {
      bytes += (await stat(join(dataDir, name))).size;
    } catch {
      missing.push(name);
    }
  }
  if (missing.length) {
    throw new Error(`The places data at ${dataDir} is incomplete: ${missing.join(", ")} missing. ${HOW_PLACES}`);
  }
  return { places: manifest.places, megabytes: Math.round((bytes / 1024 ** 2) * 10) / 10 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The image always carries data/acs from the project, whatever CENSUS_DATA_DIR says.
  (async () => {
    const r = await checkDeployable(join(DATA_DIR, "acs"));
    process.stderr.write(`Profile data ready: ${r.tables} tables, ${r.megabytes} MB.\n`);
    const p = await checkPlacesDeployable(join(DATA_DIR, "places"));
    process.stderr.write(`Places data ready: ${p.places} places, ${p.megabytes} MB.\n`);
  })().then(
    () => undefined,
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
