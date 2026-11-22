/**
 * Recognising a question about SNAP, and the fixed wording SNAP answers use.
 */
import { stateName } from "../core/geography.js";

const wordsOf = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** True when the words ask about SNAP: "snap", "ebt" or "food stamp(s)". */
export function isSnapRequest(text: string): boolean {
  const ws = wordsOf(text);
  return ws.some(
    (w, i) => w === "snap" || w === "ebt" || (w === "food" && (ws[i + 1] === "stamp" || ws[i + 1] === "stamps")),
  );
}

/** American Samoa, the Northern Mariana Islands and Puerto Rico run their own programs in place of SNAP. */
const OUTSIDE_SNAP = new Set(["60", "69", "72"]);

/** For a territory outside SNAP, why there are no SNAP counts; otherwise null. */
export function snapTerritoryNote(state: string): string | null {
  if (!OUTSIDE_SNAP.has(state)) return null;
  return `${stateName(state) ?? "This territory"} does not take part in SNAP; it runs its own nutrition assistance program, and its stores are not in USDA's SNAP list.`;
}

export const SNAP_SOURCE = "USDA SNAP retailers";
export const SNAP_MISSING =
  "The SNAP retailer data has not been built on this server. Run: npm run build && npm run build:snap";
export const SNAP_NOTE = (asOf: string) =>
  `SNAP retailers are USDA's list of currently authorised stores as of ${asOf}. Counts are exact for that date; 'full-line' means supermarkets, super stores and grocery stores.`;
export const SNAP_ATTRIBUTION = (asOf: string) =>
  `U.S. Department of Agriculture, Food and Nutrition Service, SNAP Retailer Locator data, as of ${asOf}.`;
