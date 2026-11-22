/**
 * Read access to the prebuilt SNAP retailer data (see scripts/build-snap.ts):
 * every store USDA currently authorises to take SNAP, with its type and
 * census tract, and counts by type for each county, state and the nation.
 */
import { join } from "node:path";
import { DATA_DIR } from "../core/version.js";

/** USDA's store types, as written in its data. */
export const STORE_TYPES: readonly string[] = [
  "Convenience Store",
  "Other",
  "Grocery Store",
  "Super Store",
  "Supermarket",
  "Restaurant Meals Program",
  "Farmers and Markets",
  "Specialty Store",
];

/** Stores that sell a full range of food: the headline count. */
export const FULL_LINE: readonly string[] = ["Supermarket", "Super Store", "Grocery Store"];

export interface SnapManifest {
  /** The date USDA last modified its list. */
  as_of: string;
  built: string;
  retailers: number;
  /** Retailers left out because they fell in no census tract. */
  dropped: number;
  /** Retailers left out because USDA gives no coordinates. */
  without_coordinates: number;
  /** National count by store type. */
  by_type: Record<string, number>;
}

/** Where the data is read from: CENSUS_SNAP_DIR, or data/snap inside the project. */
export function defaultSnapLocation(env: Record<string, string | undefined> = process.env): string {
  return env.CENSUS_SNAP_DIR || join(DATA_DIR, "snap");
}
