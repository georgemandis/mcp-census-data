#!/usr/bin/env node
/**
 * Regenerates data/counties.json. Needs CENSUS_API_KEY.
 *
 * County lists change: Connecticut replaced its eight counties with nine
 * planning regions from the 2022 data year. Both sets are kept, each marked
 * with the years it applies to, so a lookup can say which data it works for.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCensusClient } from "../core/client.js";
import { DATA_DIR } from "../core/version.js";

/** The last year of data that uses the older county list. */
const LEGACY_LAST_YEAR = 2021;
const CURRENT = "2024/acs/acs5?get=NAME&for=county:*";
const LEGACY = "2020/dec/pl?get=NAME&for=county:*";

export interface CountyRecord {
  name: string;
  state_fips: string;
  fips: string;
  state_abbreviation: string;
  valid_through?: number;
  valid_from?: number;
}

/** Rows are [NAME, state, county], NAME being "Cook County, Illinois". */
export function buildCounties(
  current: string[][],
  legacy: string[][],
  carried: CountyRecord[],
  stateAbbreviations: Record<string, string>
): CountyRecord[] {
  const key = (state: string, county: string) => state + county;
  const record = ([name, state, county]: string[]): CountyRecord => ({
    name: name.slice(0, name.lastIndexOf(", ")),
    state_fips: state,
    fips: county,
    state_abbreviation: stateAbbreviations[state] ?? "",
  });

  const currentKeys = new Set(current.map((r) => key(r[1], r[2])));
  const legacyKeys = new Set(legacy.map((r) => key(r[1], r[2])));
  const out = new Map<string, CountyRecord>();

  for (const r of current) {
    const rec = record(r);
    if (!legacyKeys.has(key(r[1], r[2]))) rec.valid_from = LEGACY_LAST_YEAR + 1;
    out.set(key(r[1], r[2]), rec);
  }
  for (const r of legacy) {
    if (currentKeys.has(key(r[1], r[2]))) continue;
    out.set(key(r[1], r[2]), { ...record(r), valid_through: LEGACY_LAST_YEAR });
  }
  // Island territories appear in neither list; keep what the file already had.
  for (const c of carried) {
    const k = key(c.state_fips, c.fips);
    if (!out.has(k)) out.set(k, c);
  }

  return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, rec]) => rec);
}

async function main(): Promise<void> {
  const client = createCensusClient();
  const states: Array<{ fips: string; abbreviation: string }> = JSON.parse(
    readFileSync(join(DATA_DIR, "states.json"), "utf8")
  );
  const file = join(DATA_DIR, "counties.json");
  const carried: CountyRecord[] = JSON.parse(readFileSync(file, "utf8")).map(
    ({ valid_from, valid_through, ...rest }: CountyRecord) => rest
  );
  const fetchRows = async (path: string) =>
    ((await client.getJson(path, { requiresKey: true })) as string[][]).slice(1);

  const counties = buildCounties(
    await fetchRows(CURRENT),
    await fetchRows(LEGACY),
    carried,
    Object.fromEntries(states.map((s) => [s.fips, s.abbreviation]))
  );
  writeFileSync(file, JSON.stringify(counties, null, 1) + "\n");

  const changed = counties.filter((c) => c.valid_from || c.valid_through);
  console.log(`Wrote ${counties.length} counties; ${changed.length} apply to only some years:`);
  for (const c of changed) {
    console.log(
      `  ${c.state_abbreviation} ${c.fips} ${c.name} (${c.valid_from ? `from ${c.valid_from}` : `through ${c.valid_through}`})`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
