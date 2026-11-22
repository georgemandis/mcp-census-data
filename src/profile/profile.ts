/**
 * Builds the profile of an area: the tracts around a point, combined, set
 * beside the anchor tract's county, state and the nation.
 *
 * Reads only the prebuilt data in the store. No Census API requests.
 */
import { countyName, stateName } from "../core/geography.js";
import {
  ACS_PERIOD,
  GAPS,
  INCOME_BANDS,
  SECTIONS,
  estColumn,
  moeColumn,
  tableOf,
  type Cell,
  type Line,
} from "./definition.js";
import { DEFAULT_RADIUS_MILES, MAX_RADIUS_MILES, MAX_TRACTS, selectArea } from "./area.js";
import type { Located } from "./locate.js";
import {
  differs,
  interpolatedMedian,
  reliability,
  share,
  sumEst,
  type Est,
  type Reliability,
} from "./moe.js";
import { geoId, type Row, type Store } from "./store.js";

export const SECTION_IDS: string[] = [...SECTIONS.map((s) => s.id), "gaps"];

export { DEFAULT_RADIUS_MILES, MAX_RADIUS_MILES, MAX_TRACTS };

export interface ProfileOptions {
  radiusMiles?: number;
  sections?: string[];
  /** Most tracts to combine. A test seam; the default is MAX_TRACTS. */
  maxTracts?: number;
}

export class ProfileInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileInputError";
  }
}

export interface OutLine {
  id: string;
  label: string;
  /** The combined area. Absent where a figure cannot be combined across tracts. */
  area?: {
    count?: number | null;
    share?: number | null;
    value?: number | null;
    moe?: number | null;
    reliability?: Reliability;
    approximate?: true;
    /** The value is a limit: the real figure is this "or more" / "or less". */
    bound?: "or more" | "or less";
  };
  /** The tract the address is in. Only when known exactly and reliable. */
  home?: {
    count?: number;
    share?: number;
    value?: number;
    moe: number | null;
    bound?: "or more" | "or less";
  };
  county: number | null;
  state: number | null;
  us: number | null;
  vs_county?: "higher" | "lower" | "not distinguishable";
}

export interface Profile {
  location: {
    input: Located["kind"];
    label: string;
    lat: number;
    lon: number;
    anchor_tract: string;
    county: string | null;
    state: string | null;
  };
  area: {
    radius_miles: number;
    tracts: number;
    population: number | null;
    single_tract: boolean;
    tracts_in_range: number;
    covered_miles: number;
    tracts_without_data: number;
  };
  sections: { id: string; title: string; tables: string[]; lines: OutLine[] }[];
  gaps?: OutLine[];
  notes: string[];
  data: { source: string; period: string; built: string };
}

const NOTES = [
  `Figures are ${ACS_PERIOD} averages from the American Community Survey, not a single year.`,
  "The survey undercounts benefit receipt, so real receipt is likely higher and the gaps somewhat smaller than shown.",
  "Margins for the combined area are approximations.",
  "Religion is not collected by the Census Bureau.",
];

const round = (v: number | null, places = 0): number | null => {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

// The Bureau does not publish a median household income above $250,000 or
// below $2,500. It publishes these two codes instead, with no margin.
const MEDIAN_CODES: Record<number, { value: number; bound: "or more" | "or less" }> = {
  250001: { value: 250000, bound: "or more" },
  2499: { value: 2500, bound: "or less" },
};

/** A published median or index, with a coded median turned into a bound. */
function publishedValue(kind: string, e: Est, places: number) {
  const coded = kind === "median" && e.est !== null ? MEDIAN_CODES[e.est] : undefined;
  if (coded) return { ...coded, moe: null };
  return { value: round(e.est, places), moe: round(e.moe, places) };
}

const tablesOf = (lines: Line[]): string[] =>
  [...new Set(lines.flatMap((l) => [...l.num, ...(l.den ?? [])]).map(tableOf))].sort();

/** All rows the profile needs, by table then GEO_ID. */
type Rows = Map<string, Map<string, Row>>;

function cell(rows: Rows, geo: string, c: Cell): Est {
  const row = rows.get(tableOf(c))?.get(geo);
  if (!row) return { est: null, moe: null };
  return { est: row[estColumn(c)] ?? null, moe: row[moeColumn(c)] ?? null };
}

/** Sum of the given cells over the given geographies. */
const total = (rows: Rows, geos: string[], cells: Cell[]): Est =>
  sumEst(geos.flatMap((g) => cells.map((c) => cell(rows, g, c))));

export async function buildProfile(
  located: Located,
  store: Store,
  opts: ProfileOptions = {},
): Promise<Profile> {
  const radius = opts.radiusMiles ?? DEFAULT_RADIUS_MILES;
  const maxTracts = opts.maxTracts ?? MAX_TRACTS;

  const wanted = opts.sections?.length ? opts.sections : SECTION_IDS;
  const unknown = wanted.filter((s) => !SECTION_IDS.includes(s));
  if (unknown.length) {
    throw new ProfileInputError(
      `Unknown section: ${unknown.join(", ")}. Sections are: ${SECTION_IDS.join(", ")}.`,
    );
  }
  const sections = SECTIONS.filter((s) => wanted.includes(s.id));
  const withGaps = wanted.includes("gaps");

  // The area: tract centres within the radius, plus the anchor.
  const area = await selectArea(located, store, radius, maxTracts);
  const { truncated, coveredMiles } = area;
  const tractCodes = area.tracts;

  const anchorGeo = geoId("tract", located.anchor);
  const countyGeo = geoId("county", located.anchor.slice(0, 5));
  const stateGeo = geoId("state", located.anchor.slice(0, 2));
  const usGeo = geoId("us");
  const candidateGeos = tractCodes.map((t) => geoId("tract", t));

  // One read per table, for every geography at once.
  const lines = [...sections.flatMap((s) => s.lines), ...(withGaps ? GAPS : [])];
  const tables = new Set(["B01003", ...tablesOf(lines)]);
  if (lines.some((l) => l.kind === "median")) tables.add("B19001");
  const geos = [usGeo, stateGeo, countyGeo, ...candidateGeos];
  const rows: Rows = new Map();
  for (const table of tables) rows.set(table, await store.rows(table, geos));

  // Tracts with a centre point but no figures are left out, and counted.
  const population = rows.get("B01003")!;
  const areaGeos = candidateGeos.filter((g) => population.has(g));
  const withoutData = candidateGeos.length - areaGeos.length;
  const single = areaGeos.length === 1;
  // A separate home-tract column only when it adds something.
  const showHome = located.exact && areaGeos.length > 1 && areaGeos.includes(anchorGeo);

  const rounded = (e: Est, places: number) => round(e.est, places);

  function outLine(line: Line): OutLine {
    const base = { id: line.id, label: line.label };
    const kind = line.kind ?? "share";

    if (kind === "share") {
      const figure = (g: string[]) => share(total(rows, g, line.num), total(rows, g, line.den!));
      const area = figure(areaGeos);
      const county = figure([countyGeo]);
      const out: OutLine = {
        ...base,
        area: {
          count: rounded(total(rows, areaGeos, line.num), 0),
          share: round(area.est, 3),
          moe: round(area.moe, 3),
          reliability: reliability(area),
        },
        county: round(county.est, 3),
        state: round(figure([stateGeo]).est, 3),
        us: round(figure([usGeo]).est, 3),
        vs_county: differs(area, county),
      };
      if (showHome) {
        const home = figure([anchorGeo]);
        if (home.est !== null && reliability(home) !== "unreliable") {
          out.home = { share: round(home.est, 3)!, moe: round(home.moe, 3) };
        }
      }
      return out;
    }

    // Counts, medians and indexes: one published value per geography.
    const places = kind === "index" ? 3 : 0;
    const published = (g: string) => total(rows, [g], line.num);
    const out: OutLine = {
      ...base,
      county: rounded(published(countyGeo), places),
      state: rounded(published(stateGeo), places),
      us: rounded(published(usGeo), places),
    };

    if (kind === "count") {
      const area = total(rows, areaGeos, line.num);
      out.area = { count: round(area.est, 0), moe: round(area.moe, 0), reliability: reliability(area) };
    } else if (single) {
      const area = published(areaGeos[0]);
      out.area = { ...publishedValue(kind, area, places), reliability: reliability(area) };
    } else if (kind === "median" && areaGeos.length > 1) {
      // Medians cannot be added. Estimate one from the combined income bands.
      const bands = INCOME_BANDS.map((b) => ({
        lower: b.lower,
        upper: b.upper,
        count: total(rows, areaGeos, [b.cell]).est ?? 0,
      }));
      out.area = { value: round(interpolatedMedian(bands), 0), approximate: true };
    } else if (kind === "median") {
      out.area = { value: null, reliability: "no data" };
    }
    // An index for several tracts combined is left out: it cannot be added.

    if (showHome) {
      const home = published(anchorGeo);
      if (home.est !== null && reliability(home) !== "unreliable") {
        out.home = (
          kind === "count"
            ? { count: round(home.est, 0)!, moe: round(home.moe, 0) }
            : publishedValue(kind, home, places)
        ) as OutLine["home"];
      }
    }
    return out;
  }

  /** Cuts each ranked group to its top N by area share, in place of its first line. */
  function ranked(all: Line[], top: Record<string, number> = {}): OutLine[] {
    const out: OutLine[] = [];
    const done = new Set<string>();
    for (const line of all) {
      if (!line.group) {
        out.push(outLine(line));
      } else if (!done.has(line.group)) {
        done.add(line.group);
        const group = all.filter((l) => l.group === line.group).map(outLine);
        group.sort((a, b) => (b.area?.share ?? -1) - (a.area?.share ?? -1));
        out.push(...group.slice(0, top[line.group] ?? group.length));
      }
    }
    return out;
  }

  const notes = [...NOTES];
  if (areaGeos.length === 0) {
    notes.push("The census tract here has no figures in this data, so the area columns are empty.");
  } else if (single) {
    notes.push("Only one census tract falls in this area, so figures are for that tract alone.");
  }
  if (truncated) {
    notes.push(
      `${area.inRange} tracts are within ${radius} miles. The nearest ${maxTracts} were used, which reach ${round(coveredMiles, 1)} miles.`,
    );
  }
  if (withoutData > 0 && areaGeos.length > 0) {
    notes.push(`${withoutData} tract(s) in range have no figures in this data and were left out.`);
  }
  if (located.kind === "zip" || located.kind === "place") {
    notes.push(`The area is centred on the middle of ${located.label}; it is not the whole of it.`);
  }

  const areaPopulation = total(rows, areaGeos, ["B01003_001"]);
  const profile: Profile = {
    location: {
      input: located.kind,
      label: located.label,
      lat: located.lat,
      lon: located.lon,
      anchor_tract: located.anchor,
      county: countyName(located.anchor.slice(0, 5)) ?? null,
      state: stateName(located.anchor.slice(0, 2)) ?? null,
    },
    area: {
      radius_miles: radius,
      tracts: areaGeos.length,
      population: round(areaPopulation.est, 0),
      single_tract: single,
      tracts_in_range: area.inRange,
      covered_miles: round(coveredMiles, 2)!,
      tracts_without_data: withoutData,
    },
    sections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      tables: tablesOf(s.lines),
      lines: ranked(s.lines, s.top),
    })),
    ...(withGaps ? { gaps: GAPS.map(outLine) } : {}),
    notes,
    data: { source: "ACS 5-year", period: store.manifest.period, built: store.manifest.built },
  };
  return profile;
}
