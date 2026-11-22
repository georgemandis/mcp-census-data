/**
 * What `profile_place` needs at run time: the data store, opened once and
 * shared by every request, the geocoder, and a ceiling on how many profiles
 * are built per minute so a public address cannot be run flat out.
 */
import { createGeocoder, type Geocoder } from "./geocode.js";
import { tablesUsed } from "./definition.js";
import { geoId, openStore, type Store } from "./store.js";
import { openPlaces, type PlacesStore } from "../places/store.js";

export interface ProfileRuntime {
  /** The open store. A failed open is tried again on the next call. */
  store(): Promise<Store>;
  /** The open places data, for nearby_places. A failed open is tried again. */
  places(): Promise<PlacesStore>;
  geocoder: Geocoder;
  /** Counts a profile or places request. False when this minute's ceiling is reached. */
  admit(): boolean;
  /**
   * Runs the work of building one profile. Only a few run at once and a few
   * more wait their turn; beyond that it rejects with ProfileBusyError. This
   * is what bounds memory: each profile in flight holds its rows in the heap.
   */
  run<T>(work: () => Promise<T>): Promise<T>;
  /**
   * Opens the store and reads each table once, so the first request does not
   * wait for it. Never throws; a server without data still starts.
   */
  warm(): Promise<void>;
}

/** Too many profiles are already being built or waiting. */
export class ProfileBusyError extends Error {
  constructor() {
    super("busy");
    this.name = "ProfileBusyError";
  }
}

const DEFAULT_PER_MINUTE = 120;
// Sized for one shared CPU and 512 MB: a heavy profile is CPU-bound and all
// profiles share one DuckDB connection, so more at once only adds memory.
const DEFAULT_CONCURRENT = 2;
const DEFAULT_QUEUED = 8;
const WINDOW_MS = 60_000;

/** Profiles allowed per minute: PROFILE_MAX_PER_MINUTE if a whole number above zero, else 120. */
export function profileLimit(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.PROFILE_MAX_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PER_MINUTE;
}

export function createProfileRuntime(
  opts: {
    openStore?: () => Promise<Store>;
    openPlaces?: () => Promise<PlacesStore>;
    geocoder?: Geocoder;
    maxPerMinute?: number;
    maxConcurrent?: number;
    maxQueued?: number;
    now?: () => number;
  } = {},
): ProfileRuntime {
  const open = opts.openStore ?? (() => openStore());
  const limit = opts.maxPerMinute ?? profileLimit();
  const now = opts.now ?? Date.now;
  const maxConcurrent = opts.maxConcurrent ?? DEFAULT_CONCURRENT;
  const maxQueued = opts.maxQueued ?? DEFAULT_QUEUED;
  let running = 0;
  const waiting: (() => void)[] = [];
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
  const openPlacesData = opts.openPlaces ?? (() => openPlaces());
  let pendingPlaces: Promise<PlacesStore> | undefined;
  const places = () => {
    pendingPlaces ??= openPlacesData().catch((err) => {
      pendingPlaces = undefined;
      throw err;
    });
    return pendingPlaces;
  };
  return {
    geocoder: opts.geocoder ?? createGeocoder(),
    store,
    places,
    async warm() {
      try {
        const s = await store();
        for (const table of tablesUsed()) await s.rows(table, [geoId("us")]);
        await s.places("warm");
      } catch {
        // The first profile_place call will report what is wrong.
      }
      try {
        const p = await places();
        await p.countIn("us", "", "warm");
      } catch {
        // The first nearby_places call will report what is wrong.
      }
    },
    async run(work) {
      if (running >= maxConcurrent) {
        if (waiting.length >= maxQueued) throw new ProfileBusyError();
        // The finishing job hands its place straight to the next in line.
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        running++;
      }
      try {
        return await work();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else running--;
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
