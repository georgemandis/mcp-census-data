/**
 * The Census Bureau's geocoder: address to point and tract, and point to
 * tract. It needs no key.
 *
 * Privacy: an address is personal. These calls do not go through the
 * caching Census client, nothing here is cached or logged, and no error
 * carries the input or the service's reply.
 */

const BASE = "https://geocoding.geo.census.gov/geocoder/geographies";
const COMMON = {
  benchmark: "Public_AR_Current",
  vintage: "Current_Current",
  layers: "Census Tracts",
  format: "json",
};

export interface GeocodeHit {
  lat: number;
  lon: number;
  /** 11-digit tract code, when the service returned one. */
  tract?: string;
  /** The address as the service matched it. */
  matched?: string;
}

export interface Geocoder {
  /** Null means the service answered but found no match. */
  address(text: string): Promise<GeocodeHit | null>;
  coordinates(lat: number, lon: number): Promise<GeocodeHit | null>;
}

/** The service failed or answered in a form we cannot read. Carries no input. */
export class GeocoderError extends Error {
  constructor() {
    super("The address lookup service did not respond.");
    this.name = "GeocoderError";
  }
}

interface TractLayer {
  "Census Tracts"?: { GEOID?: string }[];
}

interface AddressReply {
  result?: {
    addressMatches?: {
      matchedAddress?: string;
      coordinates?: { x?: number; y?: number };
      geographies?: TractLayer;
    }[];
  };
}

interface CoordinateReply {
  result?: { geographies?: TractLayer };
}

const tractOf = (layer: TractLayer | undefined): string | undefined => {
  const id = layer?.["Census Tracts"]?.[0]?.GEOID;
  return typeof id === "string" && /^\d{11}$/.test(id) ? id : undefined;
};

export function createGeocoder(
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Geocoder {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  // One attempt. Any failure becomes a GeocoderError with a fixed message,
  // so neither the address nor the service's reply can leak through it.
  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${BASE}/${path}?${new URLSearchParams({ ...params, ...COMMON })}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error("status");
      const body = (await res.json()) as T & { result?: unknown };
      if (!body || typeof body !== "object" || !body.result) throw new Error("shape");
      return body;
    } catch {
      throw new GeocoderError();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async address(text) {
      const reply = await get<AddressReply>("onelineaddress", { address: text });
      const matches = reply.result?.addressMatches;
      if (!Array.isArray(matches)) throw new GeocoderError();
      const m = matches[0];
      const lat = m?.coordinates?.y;
      const lon = m?.coordinates?.x;
      if (!m || typeof lat !== "number" || typeof lon !== "number") return null;
      return { lat, lon, tract: tractOf(m.geographies), matched: m.matchedAddress };
    },

    async coordinates(lat, lon) {
      const reply = await get<CoordinateReply>("coordinates", { x: String(lon), y: String(lat) });
      const tract = tractOf(reply.result?.geographies);
      return tract ? { lat, lon, tract } : null;
    },
  };
}
