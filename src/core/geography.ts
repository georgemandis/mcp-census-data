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
  /** Last data year that uses this county (Connecticut's counties: 2021). */
  valid_through?: number;
  /** First data year that uses this area (Connecticut's planning regions: 2022). */
  valid_from?: number;
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
  /** Present when the code only works for some years of data. */
  note?: string;
}

const MAX_RESULTS = 20;

/** What the Census Bureau calls a county-equivalent, by state. */
const COUNTY_SUFFIXES = [
  "county",
  "planning region",
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

/**
 * Folds the spellings people actually type: "Saint Louis", "St. Louis" and
 * "St Louis" are one place, and so are "Doña Ana" and "Dona Ana".
 */
export function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bsainte\b|\bste\./g, "ste")
    .replace(/\bsaint\b|\bst\./g, "st")
    .replace(/\s+/g, " ")
    .trim();
}

function validityNote(c: CountyEntry): string | undefined {
  if (c.valid_through !== undefined) {
    return `Census data for ${c.valid_through + 1} and later does not use this county. For newer data, look up the area that replaced it (in Connecticut, a planning region).`;
  }
  if (c.valid_from !== undefined) {
    return `Census data for ${c.valid_from - 1} and earlier does not use this area.`;
  }
  return undefined;
}

function tier(name: string, kw: string, suffixes: string[] = []): number | undefined {
  const n = plain(name);
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
  let kw = plain(name);
  if (!kw) return [];

  let within: StateEntry | undefined;
  const comma = kw.lastIndexOf(",");
  if (comma !== -1) {
    within = findState(kw.slice(comma + 1));
    kw = kw.slice(0, comma).trim();
    if (!kw) return [];
  }

  // "Washington, DC" is the District itself, which Census treats as a state.
  if (within?.abbreviation === "DC" && kw === "washington" && level !== "county") {
    return [
      { fips: within.fips, name: within.name, level: "state", for_clause: `state:${within.fips}` },
    ];
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
      const note = validityNote(c);
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
          ...(note ? { note } : {}),
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

/** Postal code for a state given its name or code ("Washington", "wa"). */
export function stateCode(text: string): string | undefined {
  return findState(text)?.abbreviation;
}

/** State name from its two-digit code. */
export function stateName(fips: string): string | undefined {
  return stateByFips.get(fips)?.name;
}

/** "King County, Washington" from a five-digit state-plus-county code. */
export function countyName(fips: string): string | undefined {
  const state = stateByFips.get(fips.slice(0, 2));
  const county = counties.find((c) => c.state_fips === fips.slice(0, 2) && c.fips === fips.slice(2));
  return state && county ? `${county.name}, ${state.name}` : undefined;
}
