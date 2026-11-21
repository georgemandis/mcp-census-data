/**
 * What `profile_place` needs at run time: the data store, opened once and
 * shared by every request, the geocoder, and a ceiling on how many profiles
 * are built per minute so a public address cannot be run flat out.
 */
import { createGeocoder, type Geocoder } from "./geocode.js";
import { tablesUsed } from "./definition.js";
import { geoId, openStore, type Store } from "./store.js";

export interface ProfileRuntime {
  /** The open store. A failed open is tried again on the next call. */
  store(): Promise<Store>;
  geocoder: Geocoder;
  /** Counts a profile request. False when this minute's ceiling is reached. */
  admit(): boolean;
  /**
   * Opens the store and reads each table once, so the first request does not
   * wait for it. Never throws; a server without data still starts.
   */
  warm(): Promise<void>;
}

const DEFAULT_PER_MINUTE = 120;
const WINDOW_MS = 60_000;

/** Profiles allowed per minute: PROFILE_MAX_PER_MINUTE if a whole number above zero, else 120. */
export function profileLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PROFILE_MAX_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PER_MINUTE;
}

export function createProfileRuntime(
  opts: {
    openStore?: () => Promise<Store>;
    geocoder?: Geocoder;
    maxPerMinute?: number;
    now?: () => number;
  } = {},
): ProfileRuntime {
  const open = opts.openStore ?? (() => openStore());
  const limit = opts.maxPerMinute ?? profileLimit();
  const now = opts.now ?? Date.now;
  let pending: Promise<Store> | undefined;
  // Start times of admitted requests in the last minute, oldest first.
  const admitted: number[] = [];
  const store = () => {
    pending ??= open().catch((err) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
  return {
    geocoder: opts.geocoder ?? createGeocoder(),
    store,
    async warm() {
      try {
        const s = await store();
        for (const table of tablesUsed()) await s.rows(table, [geoId("us")]);
        await s.places("warm");
      } catch {
        // The first profile_place call will report what is wrong.
      }
    },
    admit() {
      const t = now();
      while (admitted.length && t - admitted[0] > WINDOW_MS) admitted.shift();
      if (admitted.length >= limit) return false;
      admitted.push(t);
      return true;
    },
  };
}

let shared: ProfileRuntime | undefined;

/** The process-wide runtime, reading from CENSUS_DATA_DIR or data/acs. */
export function defaultProfileRuntime(): ProfileRuntime {
  shared ??= createProfileRuntime();
  return shared;
}
