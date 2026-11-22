/**
 * Which census tracts make up "the area around a point". Used by both
 * profile_place and nearby_places, so their figures describe one area.
 */
import type { Located } from "./locate.js";
import type { Store } from "./store.js";

export const DEFAULT_RADIUS_MILES = 1;
export const MAX_RADIUS_MILES = 10;
export const MAX_TRACTS = 500;

export interface Area {
  /** 11-digit tract codes, nearest first, with the anchor tract always included. */
  tracts: string[];
  /** How many tract centres are within the radius. */
  inRange: number;
  /** True when more were in range than could be used. */
  truncated: boolean;
  /** The distance the area reaches: the radius, or less when truncated. */
  coveredMiles: number;
  radiusMiles: number;
}

/**
 * Tracts whose centre lies within the radius, nearest first, at most
 * `maxTracts`, plus the anchor tract. A radius of 0 is the anchor alone.
 */
export async function selectArea(
  located: Located,
  store: Store,
  radiusMiles: number,
  maxTracts: number = MAX_TRACTS,
): Promise<Area> {
  const near =
    radiusMiles > 0
      ? await store.tractsNear(located.lat, located.lon, radiusMiles, maxTracts)
      : { tracts: [], inRange: 0 };
  const truncated = near.inRange > near.tracts.length;
  const tracts = near.tracts.map((t) => t.geoid);
  if (!tracts.includes(located.anchor)) tracts.push(located.anchor);
  return {
    tracts,
    inRange: near.inRange,
    truncated,
    coveredMiles: truncated ? near.tracts[near.tracts.length - 1].miles : radiusMiles,
    radiusMiles,
  };
}
