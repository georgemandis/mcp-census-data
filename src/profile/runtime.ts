/**
 * What `profile_place` needs at run time: the data store, opened once and
 * shared by every request, and the geocoder.
 */
import { createGeocoder, type Geocoder } from "./geocode.js";
import { openStore, type Store } from "./store.js";

export interface ProfileRuntime {
  /** The open store. A failed open is tried again on the next call. */
  store(): Promise<Store>;
  geocoder: Geocoder;
}

export function createProfileRuntime(
  opts: { openStore?: () => Promise<Store>; geocoder?: Geocoder } = {},
): ProfileRuntime {
  const open = opts.openStore ?? (() => openStore());
  let pending: Promise<Store> | undefined;
  return {
    geocoder: opts.geocoder ?? createGeocoder(),
    store() {
      pending ??= open().catch((err) => {
        pending = undefined;
        throw err;
      });
      return pending;
    },
  };
}

let shared: ProfileRuntime | undefined;

/** The process-wide runtime, reading from CENSUS_DATA_DIR or data/acs. */
export function defaultProfileRuntime(): ProfileRuntime {
  shared ??= createProfileRuntime();
  return shared;
}
