/**
 * Builds the answer to "what is around here, set against who lives here":
 * for each type asked about, how many there are in the area, as a rate per
 * resident (or per a group of residents), beside the county, state and US.
 *
 * The area is the same set of census tracts profile_place uses. Place
 * counts come from the prebuilt places data and the group sizes from the
 * profile data; nothing here calls an outside service.
 */
import { countyName, stateName } from "../core/geography.js";
import { DEFAULT_RADIUS_MILES, MAX_TRACTS, selectArea } from "../profile/area.js";
import { estColumn, moeColumn, tableOf, type Cell } from "../profile/definition.js";
import type { Located } from "../profile/locate.js";
import { reliability, sumEst, type Est, type Reliability } from "../profile/moe.js";
import { geoId, type Row, type Store } from "../profile/store.js";
import { MIN_GROUP, PER, clearlyDiffers, expected, rate, versus, type PerGroup } from "./compare.js";
import { FULL_LINE, STORE_TYPES, type Retailer, type SnapStore } from "../snap/store.js";
import { SNAP_ATTRIBUTION, SNAP_MISSING, SNAP_NOTE, SNAP_SOURCE, isSnapRequest, snapTerritoryNote } from "../snap/words.js";
import type { PlacesStore } from "./store.js";
import { matchType, type TypeMatch } from "./types.js";

export const MAX_TYPES = 5;
const MAX_NEAREST = 5;
const LIST_SIZE = 8;
/** A broad type needs this many in the county to have a meaningful county rate. */
const MIN_COUNTY = 20;

export interface NearbyOptions {
  types?: string[];
  radiusMiles?: number;
  per?: PerGroup;
  /** A test seam; the default is MAX_TRACTS. */
  maxTracts?: number;
  /** USDA's SNAP retailers. Absent or null when the data is not available. */
  snap?: SnapStore | null;
}

export class NearbyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NearbyInputError";
  }
}

interface Counted {
  count: number;
  rate: number | null;
}

/** A count here beside the county, state and US, with the comparison in words. */
export interface Line {
  here: Counted;
  county: Counted;
  state: Counted;
  us: Counted;
  expected_at_county_rate: number | null;
  vs_county: string;
}

/** USDA's SNAP retailers, for a SNAP request. */
export interface SnapAnswer {
  asked: string;
  source: typeof SNAP_SOURCE;
  as_of: string;
  /** Supermarkets, super stores and grocery stores. */
  full_line: Line;
  all_retailers: Line;
  by_type: ({ type: string } & Pick<Line, "here" | "county" | "vs_county">)[];
  nearest_full_line: Retailer[];
}

/** A SNAP request that cannot be answered here, and why. */
export interface SnapNote {
  asked: string;
  source: typeof SNAP_SOURCE;
  note: string;
}

export type Official = { source: typeof SNAP_SOURCE; as_of: string; what: string } & Line;

export interface PerBlock {
  group: PerGroup;
  label: string;
  unit: number;
  here: number | null;
  county: number | null;
  state: number | null;
  us: number | null;
  reliability: Reliability;
}

export interface TypeAnswer {
  asked: string;
  /** The node of the type tree that was counted, with everything beneath it. */
  matched: string;
  here: Counted;
  county: Counted;
  state: Counted;
  us: Counted;
  expected_at_county_rate: number | null;
  vs_county: string;
  nearest: { name: string | null; type: string; address: string | null; miles: number }[];
  /** USDA's count of SNAP-authorised full-line food stores, for grocery stores. */
  official?: Official;
}

export interface TypeCandidates {
  asked: string;
  candidates: { type: string; path: string; us_count: number }[];
  note: string;
}

export interface OverviewItem {
  type: string;
  here: Counted;
  county: Counted;
  vs_county: string;
}

export interface Nearby {
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
    tracts_in_range: number;
    covered_miles: number;
  };
  /** What Overture rates are per; `usda` says what USDA rates are per when it differs. */
  per: PerBlock & { usda?: PerBlock };
  types?: (TypeAnswer | TypeCandidates | SnapAnswer | SnapNote)[];
  overview?: {
    over: OverviewItem[];
    under: OverviewItem[];
    commonest: OverviewItem[];
    none_found_here: OverviewItem[];
  };
  notes: string[];
  data: {
    source: string;
    release: string;
    built: string;
    attribution: string;
    snap?: { source: typeof SNAP_SOURCE; as_of: string; built: string; attribution: string };
  };
}

const NOTES = [
  "Places come from Overture Maps, a merged open dataset. Types are sometimes wrong and coverage varies from place to place, so counts are approximate.",
  "Only places marked open with high confidence are counted.",
  "A lower rate than the county can mean fewer places or less complete mapping.",
  "Distances are straight-line.",
];
const TOO_FEW = "too few to compare";
const NO_POPULATION = "no population figures here to compare with";
const OPEN_ONLY = NOTES[1];
const TERRITORY_NOTE =
  "Overture does not record whether places here are open, so places are counted on confidence alone, and coverage is thinner than in the states. Comparisons with US figures are weak.";
/** State codes of American Samoa, Guam, the Northern Marianas, Puerto Rico and the Virgin Islands. */
const TERRITORIES = new Set(["60", "66", "69", "72", "78"]);

/**
 * Cautions about the county the area is compared with: the county is that
 * of the anchor tract, which misleads when much of the area lies outside
 * it, or when the area is most of the county.
 */
export function baselineNotes(
  populationByCounty: Map<string, number>,
  anchorCounty: string,
  countyPopulation: number | null,
  countyLabel: string | null,
): string[] {
  const total = [...populationByCounty.values()].reduce((a, b) => a + b, 0);
  if (total <= 0 || !countyLabel) return [];
  const inside = populationByCounty.get(anchorCounty) ?? 0;
  const notes: string[] = [];
  const outsideShare = (total - inside) / total;
  if (outsideShare >= 0.25) {
    notes.push(
      `About ${Math.round(outsideShare * 100)}% of this area's residents live outside ${countyLabel}, so the county comparison is a rough guide. The state figures may be a fairer yardstick.`,
    );
  }
  if (countyPopulation && inside / countyPopulation >= 0.5) {
    notes.push(
      `This area holds about ${Math.round((inside / countyPopulation) * 100)}% of the residents of ${countyLabel}, so comparing it with the county mostly compares it with itself.`,
    );
  }
  return notes;
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
const OFFICIAL_WHAT = "SNAP-authorised supermarkets, super stores and grocery stores";
const sumOf = (counts: Map<string, number>, types?: readonly string[]) =>
  types
    ? types.reduce((a, t) => a + (counts.get(t) ?? 0), 0)
    : [...counts.values()].reduce((a, b) => a + b, 0);

export async function nearbyPlaces(
  located: Located,
  store: Store,
  places: PlacesStore,
  opts: NearbyOptions = {},
): Promise<Nearby> {
  const asked = (opts.types ?? []).map((t) => t.trim()).filter(Boolean);
  if (asked.length > MAX_TYPES) {
    throw new NearbyInputError(`Ask about at most ${MAX_TYPES} types of place at a time.`);
  }
  const group = opts.per ?? "people";
  const per = PER[group];
  if (!per) {
    throw new NearbyInputError(`Unknown group "${group}". Groups are: ${Object.keys(PER).join(", ")}.`);
  }

  const area = await selectArea(
    located,
    store,
    opts.radiusMiles ?? DEFAULT_RADIUS_MILES,
    opts.maxTracts ?? MAX_TRACTS,
  );
  const county = located.anchor.slice(0, 5);
  const state = located.anchor.slice(0, 2);
  const tractGeos = area.tracts.map((t) => geoId("tract", t));
  const countyGeo = geoId("county", county);
  const stateGeo = geoId("state", state);
  const usGeo = geoId("us");

  // USDA lines are rated per household on SNAP unless a group was asked for.
  const usdaGroup: PerGroup = opts.per ?? "snap_households";
  const groups = asked.length > 0 ? [group, usdaGroup] : [group];

  // Group sizes come from the profile data: one read per table for every geography.
  const cells: Cell[] = [...new Set([...groups.flatMap((g) => PER[g].cells), "B01003_001"])];
  const rows = new Map<string, Map<string, Row>>();
  for (const table of new Set(cells.map(tableOf))) {
    rows.set(table, await store.rows(table, [usGeo, stateGeo, countyGeo, ...tractGeos]));
  }
  const size = (geos: string[], of: Cell[]): Est =>
    sumEst(
      geos.flatMap((g) =>
        of.map((c) => {
          const row = rows.get(tableOf(c))?.get(g);
          return row
            ? { est: row[estColumn(c)] ?? null, moe: row[moeColumn(c)] ?? null }
            : { est: null, moe: null };
        }),
      ),
    );
  const whole = (e: Est) => (e.est === null ? null : Math.round(e.est));

  /** Sizes of a group here and in each larger area, and how counts are rated and compared against it. */
  const groupContext = (g: PerGroup) => {
    const def = PER[g];
    const groupHere = size(tractGeos, def.cells);
    const here = whole(groupHere);
    const inCounty = whole(size([countyGeo], def.cells));
    const inState = whole(size([stateGeo], def.cells));
    const inUs = whole(size([usGeo], def.cells));
    // A group whose size here is itself unreliable cannot carry a rate.
    const shaky = reliability(groupHere) === "unreliable";
    const usable = here !== null && here >= MIN_GROUP && !shaky;
    const counted = (count: number, members: number | null): Counted => ({
      count,
      rate: rate(count, members, def.unit),
    });
    const countedHere = (count: number): Counted => ({ count, rate: usable ? rate(count, here, def.unit) : null });
    /** The count here against the county, in words. */
    const compare = (countHere: number, countCounty: number): { exp: number | null; words: string } => {
      if (here === null) return { exp: null, words: NO_POPULATION };
      if (shaky && here >= MIN_GROUP) {
        return { exp: null, words: `the number of ${def.label} here is too uncertain to compare` };
      }
      const exp = usable ? expected(here, countCounty, inCounty) : null;
      return { exp, words: versus(countHere, exp, here, def.label) };
    };
    /** A count here beside the county, state and US. */
    const line = (countHere: number, countCounty: number, countState: number, countUs: number): Line => {
      const { exp, words } = compare(countHere, countCounty);
      return {
        here: countedHere(countHere),
        county: counted(countCounty, inCounty),
        state: counted(countState, inState),
        us: counted(countUs, inUs),
        expected_at_county_rate: exp === null ? null : round(exp, 1),
        vs_county: words,
      };
    };
    const block: PerBlock = {
      group: g,
      label: def.label,
      unit: def.unit,
      here,
      county: inCounty,
      state: inState,
      us: inUs,
      reliability: reliability(groupHere),
    };
    return { def, here, inCounty, inState, inUs, shaky, usable, counted, countedHere, compare, line, block };
  };

  const main = groupContext(group);
  const { here, inCounty, inState, inUs, shaky, usable, counted, countedHere, compare } = main;
  const population = whole(size(tractGeos, ["B01003_001"]));

  const result: Nearby = {
    location: {
      input: located.kind,
      label: located.label,
      lat: located.lat,
      lon: located.lon,
      anchor_tract: located.anchor,
      county: countyName(county) ?? null,
      state: stateName(state) ?? null,
    },
    area: {
      radius_miles: area.radiusMiles,
      tracts: area.tracts.length,
      population,
      tracts_in_range: area.inRange,
      covered_miles: round(area.coveredMiles, 2),
    },
    per: { ...main.block },
    notes: [...NOTES],
    data: {
      source: "Overture Maps Places",
      release: places.manifest.release,
      built: places.manifest.built,
      attribution: "Overture Maps Foundation, overturemaps.org",
    },
  };

  if (asked.length > 0) {
    const nodes = await places.types();
    const answers: (TypeAnswer | TypeCandidates | SnapAnswer | SnapNote)[] = [];
    // SNAP words are answered from USDA's list, before any Overture matching.
    const matches: (TypeMatch | "snap")[] = asked.map((words) => (isSnapRequest(words) ? "snap" : matchType(words, nodes)));
    const isGrocery = (m: TypeMatch | "snap") => m !== "snap" && "path" in m && m.name === "grocery_store";

    // One read of USDA's list serves every SNAP entry and every grocery answer.
    const territoryNote = snapTerritoryNote(state);
    const snap = opts.snap ?? null;
    const wantsUsda = matches.some((m) => m === "snap" || isGrocery(m));
    let usda:
      | { ctx: ReturnType<typeof groupContext>; asOf: string; fullLine: Line; all: Line; snapAnswer: (words: string) => SnapAnswer }
      | undefined;
    if (wantsUsda && snap && !territoryNote) {
      const ctx = usdaGroup === group ? main : groupContext(usdaGroup);
      const found = await snap.around(area.tracts, located.lat, located.lon, MAX_NEAREST);
      const inCountyTypes = await snap.countsIn("county", county);
      const inStateTypes = await snap.countsIn("state", state);
      const inUsTypes = await snap.countsIn("us", "");
      const lineOf = (types?: readonly string[]) =>
        ctx.line(sumOf(found.byType, types), sumOf(inCountyTypes, types), sumOf(inStateTypes, types), sumOf(inUsTypes, types));
      const fullLine = lineOf(FULL_LINE);
      const all = lineOf();
      const typeNames = [...new Set([...STORE_TYPES, ...found.byType.keys(), ...inCountyTypes.keys()])];
      const byType = typeNames
        .map((type) => {
          const countHere = found.byType.get(type) ?? 0;
          const countCounty = inCountyTypes.get(type) ?? 0;
          return {
            type,
            here: ctx.countedHere(countHere),
            county: ctx.counted(countCounty, ctx.inCounty),
            vs_county: ctx.compare(countHere, countCounty).words,
          };
        })
        .sort((a, b) => b.here.count - a.here.count || a.type.localeCompare(b.type));
      const asOf = snap.manifest.as_of;
      usda = {
        ctx,
        asOf,
        fullLine,
        all,
        snapAnswer: (words) => ({
          asked: words,
          source: SNAP_SOURCE,
          as_of: asOf,
          full_line: fullLine,
          all_retailers: all,
          by_type: byType,
          nearest_full_line: found.nearestFullLine,
        }),
      };
    }

    // One pass over the area's places for every type that matched.
    const matchedPaths = matches.flatMap((m) => (m !== "snap" && "path" in m ? [m.path] : []));
    const found = await places.around(matchedPaths, area.tracts, located.lat, located.lon, MAX_NEAREST);
    for (const [i, words] of asked.entries()) {
      const match = matches[i];
      if (match === "snap") {
        answers.push(
          usda
            ? usda.snapAnswer(words)
            : { asked: words, source: SNAP_SOURCE, note: territoryNote ?? SNAP_MISSING },
        );
        continue;
      }
      if ("candidates" in match) {
        answers.push({
          asked: words,
          candidates: match.candidates.map((c) => ({ type: c.name, path: c.path, us_count: c.n })),
          note: match.candidates.length
            ? "Nothing was counted: it is not clear which type is meant. Ask again with one of these types."
            : "Nothing was counted: no place type matches these words. Try other words, or omit types for an overview.",
        });
        continue;
      }
      const node = match.path;
      const at = matchedPaths.indexOf(node);
      const countHere = found.counts[at];
      const countCounty = await places.countIn("county", county, node);
      const { exp, words: vs } = compare(countHere, countCounty);
      const nearest = found.nearest[at];
      const answer: TypeAnswer = {
        asked: words,
        matched: node,
        here: countedHere(countHere),
        county: counted(countCounty, inCounty),
        state: counted(await places.countIn("state", state, node), inState),
        us: counted(match.n, inUs),
        expected_at_county_rate: exp === null ? null : round(exp, 1),
        vs_county: vs,
        nearest: nearest.map(({ name, type, address, miles }) => ({ name, type, address, miles })),
      };
      if (usda && isGrocery(match)) {
        answer.official = { source: SNAP_SOURCE, as_of: usda.asOf, what: OFFICIAL_WHAT, ...usda.fullLine };
      }
      answers.push(answer);
    }
    result.types = answers;
    if (usda) {
      if (usdaGroup !== group) result.per.usda = usda.ctx.block;
      result.data.snap = {
        source: SNAP_SOURCE,
        as_of: usda.asOf,
        built: snap!.manifest.built,
        attribution: SNAP_ATTRIBUTION(usda.asOf),
      };
    }
  } else {
    const broadHere = await places.broadHere(area.tracts);
    const broadCounty = await places.broadIn("county", county);
    const item = (type: string): OverviewItem & { exp: number | null } => {
      const countHere = broadHere.get(type) ?? 0;
      const countCounty = broadCounty.get(type) ?? 0;
      const { exp, words } = compare(countHere, countCounty);
      return { type, here: countedHere(countHere), county: counted(countCounty, inCounty), vs_county: words, exp };
    };
    const strip = ({ exp: _exp, ...rest }: OverviewItem & { exp: number | null }): OverviewItem => rest;
    const byName = (a: OverviewItem, b: OverviewItem) => a.type.localeCompare(b.type);

    const all = [...new Set([...broadHere.keys(), ...broadCounty.keys()])].map(item);
    // Only types whose difference from the county is more than chance, on a county rate worth trusting.
    const comparable = all.filter(
      (x) => usable && x.county.count >= MIN_COUNTY && clearlyDiffers(x.here.count, x.exp),
    );
    const ratio = (x: { here: Counted; exp: number | null }) => x.here.count / (x.exp as number);
    result.overview = {
      over: comparable
        .filter((x) => ratio(x) > 1)
        .sort((a, b) => ratio(b) - ratio(a) || byName(a, b))
        .slice(0, LIST_SIZE)
        .map(strip),
      under: comparable
        .filter((x) => x.here.count > 0 && ratio(x) < 1)
        .sort((a, b) => ratio(a) - ratio(b) || byName(a, b))
        .slice(0, LIST_SIZE)
        .map(strip),
      commonest: all
        .filter((x) => x.here.count > 0)
        .sort((a, b) => b.here.count - a.here.count || byName(a, b))
        .slice(0, LIST_SIZE)
        .map(strip),
      none_found_here: comparable
        .filter((x) => x.here.count === 0)
        .sort((a, b) => (b.exp as number) - (a.exp as number) || byName(a, b))
        .slice(0, LIST_SIZE)
        .map(strip),
    };
  }

  // Situational notes.
  const notes = result.notes;
  if (TERRITORIES.has(state)) notes[notes.indexOf(OPEN_ONLY)] = TERRITORY_NOTE;
  if (here === null) {
    notes.push("There are no population figures for this area, so only counts are given.");
  } else if (shaky && here >= MIN_GROUP) {
    notes.push(
      `The number of ${per.label} here is too uncertain to give rates. Try a wider radius, or rates per resident.`,
    );
  }
  const populationByCounty = new Map<string, number>();
  for (const tract of area.tracts) {
    const people = rows.get("B01003")?.get(geoId("tract", tract))?.B01003_E001;
    if (people) populationByCounty.set(tract.slice(0, 5), (populationByCounty.get(tract.slice(0, 5)) ?? 0) + people);
  }
  notes.push(
    ...baselineNotes(populationByCounty, county, whole(size([countyGeo], ["B01003_001"])), result.location.county),
  );
  if (area.tracts.length === 1) {
    notes.push("Only one census tract falls in this area, so figures are for that tract alone.");
  }
  if (area.truncated) {
    notes.push(
      `${area.inRange} tracts are within ${area.radiusMiles} miles. The nearest ${opts.maxTracts ?? MAX_TRACTS} were used, which reach ${round(area.coveredMiles, 1)} miles.`,
    );
  }
  if (located.kind === "zip" || located.kind === "place") {
    notes.push(`The area is centred on the middle of ${located.label}; it is not the whole of it.`);
  }
  if (result.types?.some((t) => "vs_county" in t && t.vs_county === TOO_FEW)) {
    notes.push("Try a wider radius for rarer types.");
  }
  if (result.data.snap) notes.push(SNAP_NOTE(result.data.snap.as_of));
  return result;
}
