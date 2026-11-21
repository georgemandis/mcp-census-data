/**
 * Turns what a person typed (an address, a ZIP, a place, or coordinates)
 * into a point and an anchor tract.
 *
 * ZIPs and places are resolved from the bundled centre points, with no
 * outside request. Only addresses and coordinates use the geocoder.
 */
import { stateCode } from "../core/geography.js";
import type { Geocoder } from "./geocode.js";
import type { PlacePoint, Store } from "./store.js";

export type InputKind = "address" | "coordinates" | "zip" | "place";

export interface Classified {
  kind: InputKind;
  lat?: number;
  lon?: number;
  zip?: string;
  name?: string;
  state?: string;
}

export interface Located {
  kind: InputKind;
  /** What the area is centred on, in words. */
  label: string;
  lat: number;
  lon: number;
  /** 11-digit code of the tract the point is in, or the nearest one. */
  anchor: string;
  /** True when the anchor is known to contain the point. */
  exact: boolean;
}

export class LocateError extends Error {
  candidates?: string[];
  constructor(message: string, candidates?: string[]) {
    super(message);
    this.name = "LocateError";
    if (candidates) this.candidates = candidates;
  }
}

const NO_INPUT =
  'Give a street address, a 5-digit ZIP, a place like "Seattle, WA", or coordinates like "47.61, -122.33".';
const NO_ZIP =
  "That ZIP has no Census ZIP code area (some ZIPs are PO boxes only). Try a nearby ZIP or a place name.";
const NO_PLACE = "No place by that name was found. Try a ZIP or a nearby city.";
const NO_MATCH = "The address could not be matched. Try a ZIP or a place name.";
const NO_SERVICE = "The address lookup service did not respond. Try a ZIP or a place name.";
const OUTSIDE = "Those coordinates are outside the United States or its territories.";

/** How far a point may be from the nearest tract centre and still be used. */
const MAX_FALLBACK_MILES = 5;
const MAX_CANDIDATES = 10;

const COORDS = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;

/** Splits "Seattle, WA", "Seattle, Washington" or "seattle wa" into name and state. */
function splitPlace(text: string): { name: string; state?: string } {
  const comma = text.lastIndexOf(",");
  if (comma > 0) {
    const state = stateCode(text.slice(comma + 1));
    return state ? { name: text.slice(0, comma).trim(), state } : { name: text };
  }
  const words = text.split(/\s+/);
  // A state at the end: its name can be up to three words ("District of Columbia" aside).
  for (const n of [3, 2, 1]) {
    if (words.length <= n) continue;
    const state = stateCode(words.slice(-n).join(" "));
    if (state) return { name: words.slice(0, -n).join(" "), state };
  }
  return { name: text };
}

export function classify(location: string): Classified | null {
  const text = location.trim();
  if (!text) return null;

  const c = COORDS.exec(text);
  if (c) {
    const lat = Number(c[1]);
    const lon = Number(c[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { kind: "coordinates", lat, lon };
  }
  if (/^\d{5}$/.test(text)) return { kind: "zip", zip: text };
  if (!/\d/.test(text)) return { kind: "place", ...splitPlace(text) };
  return { kind: "address" };
}

const placeLabel = (p: PlacePoint) => `${p.name}, ${p.state}`;

async function anchorNear(store: Store, lat: number, lon: number): Promise<string> {
  const nearest = await store.nearestTract(lat, lon);
  if (!nearest) throw new LocateError(NO_PLACE);
  return nearest.geoid;
}

export async function locate(
  location: string,
  deps: { store: Store; geocoder: Geocoder },
): Promise<Located> {
  const { store, geocoder } = deps;
  const c = classify(location);
  if (!c) throw new LocateError(NO_INPUT);

  if (c.kind === "zip") {
    const z = await store.zip(c.zip!);
    if (!z) throw new LocateError(NO_ZIP);
    return {
      kind: "zip",
      label: `ZIP code area ${c.zip}`,
      lat: z.lat,
      lon: z.lon,
      anchor: await anchorNear(store, z.lat, z.lon),
      exact: false,
    };
  }

  if (c.kind === "place") {
    let found = await store.places(c.name!, c.state);
    // "Lake Mary Jane" must not lose its last word to a state guess.
    if (found.length === 0 && c.state && !location.includes(",")) {
      found = await store.places(location.trim());
    }
    if (found.length === 0) throw new LocateError(NO_PLACE);
    if (found.length > 1) {
      const candidates = found.slice(0, MAX_CANDIDATES).map(placeLabel);
      throw new LocateError(
        `More than one place has that name. Add a state, for example: ${candidates.join("; ")}.`,
        candidates,
      );
    }
    const p = found[0];
    return {
      kind: "place",
      label: placeLabel(p),
      lat: p.lat,
      lon: p.lon,
      anchor: await anchorNear(store, p.lat, p.lon),
      exact: false,
    };
  }

  if (c.kind === "coordinates") {
    const lat = c.lat!;
    const lon = c.lon!;
    const label = `${lat}, ${lon}`;
    const hit = await geocoder.coordinates(lat, lon).catch(() => null);
    if (hit?.tract) return { kind: "coordinates", label, lat, lon, anchor: hit.tract, exact: true };
    const nearest = await store.nearestTract(lat, lon);
    if (!nearest || nearest.miles > MAX_FALLBACK_MILES) throw new LocateError(OUTSIDE);
    return { kind: "coordinates", label, lat, lon, anchor: nearest.geoid, exact: false };
  }

  // An address. Errors here use fixed text so the address is never repeated.
  let hit;
  try {
    hit = await geocoder.address(location.trim());
  } catch {
    throw new LocateError(NO_SERVICE);
  }
  if (!hit) throw new LocateError(NO_MATCH);
  if (hit.tract) {
    return {
      kind: "address",
      label: hit.matched ?? "the address given",
      lat: hit.lat,
      lon: hit.lon,
      anchor: hit.tract,
      exact: true,
    };
  }
  const nearest = await store.nearestTract(hit.lat, hit.lon);
  if (!nearest || nearest.miles > MAX_FALLBACK_MILES) throw new LocateError(NO_MATCH);
  return {
    kind: "address",
    label: "the address given",
    lat: hit.lat,
    lon: hit.lon,
    anchor: nearest.geoid,
    exact: false,
  };
}
