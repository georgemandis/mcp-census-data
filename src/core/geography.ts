import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CensusClient } from "./client.js";
import { getFromDataset } from "./query.js";
import { DATA_DIR } from "./version.js";

interface StateEntry {
  name: string;
  abbreviation: string;
  fips: string;
}

interface CountyEntry {
  name: string;
  state_fips: string;
  fips: string;
  state_abbreviation: string;
}

const states: StateEntry[] = JSON.parse(
  readFileSync(join(DATA_DIR, "states.json"), "utf8")
);
const counties: CountyEntry[] = JSON.parse(
  readFileSync(join(DATA_DIR, "counties.json"), "utf8")
);
const stateByFips = new Map(states.map((s) => [s.fips, s]));

export interface GeoMatch {
  fips: string;
  name: string;
  level: "state" | "county";
  state_fips?: string;
  for_clause: string;
  in_clause?: string;
}

const MAX_RESULTS = 20;

/** What the Census Bureau calls a county-equivalent, by state. */
const COUNTY_SUFFIXES = [
  "county",
  "parish",
  "borough",
  "census area",
  "municipality",
  "municipio",
  "city and borough",
  "city",
];

// Lower tier is a better match.
const EXACT = 0;
const EXACT_WITH_SUFFIX = 1;
const PREFIX = 2;
const CONTAINS = 3;

function findState(text: string): StateEntry | undefined {
  const t = text.trim().toLowerCase();
  return states.find(
    (s) => s.abbreviation.toLowerCase() === t || s.name.toLowerCase() === t
  );
}

function tier(name: string, kw: string, suffixes: string[] = []): number | undefined {
  const n = name.toLowerCase();
  if (n === kw) return EXACT;
  if (suffixes.some((s) => n === `${kw} ${s}`)) return EXACT_WITH_SUFFIX;
  if (n.startsWith(kw)) return PREFIX;
  if (n.includes(kw)) return CONTAINS;
  return undefined;
}

/**
 * Finds states and counties by name. Accepts "Cook County, IL" and
 * "Orleans, Louisiana"; the part after the last comma narrows counties to
 * that state. Best matches first, states ahead of counties on a tie.
 */
export function resolveGeography(
  name: string,
  level?: "state" | "county"
): GeoMatch[] {
  let kw = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!kw) return [];

  let within: StateEntry | undefined;
  const comma = kw.lastIndexOf(",");
  if (comma !== -1) {
    within = findState(kw.slice(comma + 1));
    kw = kw.slice(0, comma).trim();
    if (!kw) return [];
  }

  const found: Array<{ match: GeoMatch; tier: number; order: number }> = [];

  // A bare two-letter abbreviation means the state, never "any county containing tx".
  const abbreviated =
    !within && kw.length === 2
      ? states.find((s) => s.abbreviation.toLowerCase() === kw)
      : undefined;

  if (level !== "county" && !within) {
    for (const s of states) {
      const t = s === abbreviated ? EXACT : abbreviated ? undefined : tier(s.name, kw);
      if (t === undefined) continue;
      found.push({
        tier: t,
        order: 0,
        match: { fips: s.fips, name: s.name, level: "state", for_clause: `state:${s.fips}` },
      });
    }
  }

  if (level !== "state" && !(abbreviated && level !== "county")) {
    for (const c of counties) {
      if (within && c.state_fips !== within.fips) continue;
      const t = tier(c.name, kw, COUNTY_SUFFIXES);
      if (t === undefined) continue;
      const state = stateByFips.get(c.state_fips);
      found.push({
        tier: t,
        order: 1,
        match: {
          fips: c.fips,
          name: `${c.name}, ${state?.name ?? c.state_abbreviation}`,
          level: "county",
          state_fips: c.state_fips,
          for_clause: `county:${c.fips}`,
          in_clause: `state:${c.state_fips}`,
        },
      });
    }
  }

  return found
    .sort((a, b) => a.tier - b.tier || a.order - b.order)
    .slice(0, MAX_RESULTS)
    .map((f) => f.match);
}

export interface GeoLevel {
  name: string;
  geoLevelDisplay: string;
  requires?: string[];
  wildcard?: string[];
}

export async function listGeographies(
  client: CensusClient,
  dataset: string,
  vintage?: number
): Promise<GeoLevel[]> {
  const data = (await getFromDataset(client, dataset, vintage, "/geography.json")) as {
    fips?: GeoLevel[];
  } | null;

  if (!data?.fips) return [];
  return data.fips.map((g) => ({
    name: g.name,
    geoLevelDisplay: g.geoLevelDisplay,
    requires: g.requires,
    wildcard: g.wildcard,
  }));
}
