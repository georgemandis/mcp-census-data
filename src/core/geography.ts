import { readFileSync } from "fs";
import { join } from "node:path";
import { DATA_DIR } from "./version.js";
import { fetchCensusJson } from "./client.js";

const dataDir = DATA_DIR;

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
  readFileSync(join(dataDir, "states.json"), "utf8")
);
const counties: CountyEntry[] = JSON.parse(
  readFileSync(join(dataDir, "counties.json"), "utf8")
);

export interface GeoMatch {
  fips: string;
  name: string;
  level: "state" | "county";
  state_fips?: string;
  for_clause: string;
  in_clause?: string;
}

export function resolveGeography(
  name: string,
  level?: "state" | "county"
): GeoMatch[] {
  const kw = name.toLowerCase();
  const results: GeoMatch[] = [];

  if (!level || level === "state") {
    for (const s of states) {
      if (
        s.name.toLowerCase().includes(kw) ||
        s.abbreviation.toLowerCase() === kw
      ) {
        results.push({
          fips: s.fips,
          name: s.name,
          level: "state",
          for_clause: `state:${s.fips}`,
        });
      }
    }
  }

  if (!level || level === "county") {
    for (const c of counties) {
      if (c.name.toLowerCase().includes(kw)) {
        const state = states.find((s) => s.fips === c.state_fips);
        results.push({
          fips: c.fips,
          name: `${c.name}, ${state?.name ?? c.state_abbreviation}`,
          level: "county",
          state_fips: c.state_fips,
          for_clause: `county:${c.fips}`,
          in_clause: `state:${c.state_fips}`,
        });
      }
    }
  }

  return results.slice(0, 20);
}

export interface GeoLevel {
  name: string;
  geoLevelDisplay: string;
  requires?: string[];
  wildcard?: string[];
}

export async function listGeographies(
  dataset: string,
  vintage: number
): Promise<GeoLevel[]> {
  const data = (await fetchCensusJson(
    `${vintage}/${dataset}/geography.json`
  )) as { fips: GeoLevel[] } | null;

  if (!data || !data.fips) return [];
  return data.fips.map((g) => ({
    name: g.name,
    geoLevelDisplay: g.geoLevelDisplay,
    requires: g.requires,
    wildcard: g.wildcard,
  }));
}
