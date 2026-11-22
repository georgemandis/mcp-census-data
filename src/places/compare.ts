/**
 * Turning place counts into something comparable: a rate per resident (or
 * per a group of residents), the count an area would have at another
 * area's rate, and a plain-words comparison.
 *
 * Place counts have no published margin of error, so nothing here claims a
 * statistical difference. Small numbers are not compared at all.
 */
import type { Cell } from "../profile/definition.js";

export type PerGroup =
  | "people"
  | "households"
  | "children"
  | "older_adults"
  | "snap_households"
  | "people_below_poverty";

const pad = (n: number) => String(n).padStart(3, "0");
// B01001 lists ages for men from line 3 and for women from line 27; 65 and over is lines 20-25 and 44-49.
const AGE_65_PLUS: Cell[] = [20, 21, 22, 23, 24, 25, 44, 45, 46, 47, 48, 49].map((n) => `B01001_${pad(n)}`);

/** What a rate can be per: its unit, a label, and the ACS cells that count the group. */
export const PER: Record<PerGroup, { unit: number; label: string; cells: Cell[] }> = {
  people: { unit: 10000, label: "residents", cells: ["B01003_001"] },
  households: { unit: 10000, label: "households", cells: ["B11001_001"] },
  children: { unit: 1000, label: "children under 18", cells: ["B09001_001"] },
  older_adults: { unit: 1000, label: "people 65 and over", cells: AGE_65_PLUS },
  snap_households: { unit: 1000, label: "households on SNAP", cells: ["B22003_002"] },
  people_below_poverty: { unit: 1000, label: "people below the poverty line", cells: ["C17002_002", "C17002_003"] },
};

/** A rate is not given for a group smaller than this. */
export const MIN_GROUP = 100;
/** Counts (actual or expected) below this are too small to compare. */
const MIN_COUNT = 5;

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/** Places per `unit` members of the group. Null when the group is missing or too small. */
export function rate(count: number, group: number | null, unit: number): number | null {
  if (group === null || group < MIN_GROUP) return null;
  return round((count / group) * unit, 2);
}

/** How many places this area would have at the other area's rate. */
export function expected(
  groupHere: number | null,
  countThere: number,
  groupThere: number | null,
): number | null {
  if (groupHere === null || groupThere === null || groupThere <= 0) return null;
  return (countThere / groupThere) * groupHere;
}

/** Wording used when the area has more than the county rate gives but too few would be expected here to build a ratio on. */
export const MORE_BUT_SMALL =
  "more here than the county rate would give, but the numbers are too small to say how much";
export const NOT_CLEARLY_DIFFERENT = "not clearly different from the county";

/**
 * The count here against the count expected at the county's rate, in words.
 *
 * A ratio is given only when the expected count is at least 5 (so the
 * county's rate rests on something) and the difference is larger than
 * chance alone would often produce: about two standard deviations of a
 * count of that size. Place counts are approximate, so this is a floor
 * against reading noise, not a statistical verdict.
 */
export function versus(
  here: number,
  exp: number | null,
  groupHere: number | null,
  groupLabel: string,
): string {
  if (groupHere === null || groupHere < MIN_GROUP) return `too few ${groupLabel} here to give a rate`;
  const e = exp ?? 0;
  if (here < MIN_COUNT && e < MIN_COUNT) return "too few to compare";
  if (e <= 0) return "none in the county to compare with";
  if (e < MIN_COUNT) return MORE_BUT_SMALL;
  if (here === 0) return `none found here; about ${Math.round(e)} would be expected at the county rate`;
  const ratio = here / e;
  if (ratio >= 0.8 && ratio <= 1.25) return "about the same as the county";
  if (Math.abs(here - e) < 2 * Math.sqrt(e)) return NOT_CLEARLY_DIFFERENT;
  if (ratio > 1.25) {
    return `about ${ratio < 10 ? round(ratio, 1) : Math.round(ratio)} times the county rate`;
  }
  return `about ${Math.max(1, Math.round(ratio * 100))}% of the county rate`;
}

/** True when `versus` would state a ratio or a clear absence for these numbers. */
export function clearlyDiffers(here: number, exp: number | null): boolean {
  const e = exp ?? 0;
  if (e < MIN_COUNT) return false;
  const ratio = here / e;
  return (ratio < 0.8 || ratio > 1.25) && Math.abs(here - e) >= 2 * Math.sqrt(e);
}
