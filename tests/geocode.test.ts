import { describe, expect, it, vi } from "vitest";
import { GeocoderError, createGeocoder } from "../src/profile/geocode.js";

const SECRET = "123 Secret St, Seattle WA";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const tract = { GEOID: "53033008102", NAME: "Census Tract 81.02" };

const addressHit = {
  result: {
    addressMatches: [
      {
        matchedAddress: "400 BROAD ST, SEATTLE, WA, 98109",
        coordinates: { x: -122.3493, y: 47.6205 },
        geographies: { "Census Tracts": [{ GEOID: "53033007200" }] },
      },
    ],
  },
};

describe("address", () => {
  it("returns the point, tract and matched address", async () => {
    const fetch = vi.fn(async () => json(addressHit));
    const hit = await createGeocoder({ fetch }).address("400 Broad St, Seattle, WA");
    expect(hit).toEqual({
      lat: 47.6205,
      lon: -122.3493,
      tract: "53033007200",
      matched: "400 BROAD ST, SEATTLE, WA, 98109",
    });
  });

  it("asks the Census geocoder, once, with the address as a parameter", async () => {
    const fetch = vi.fn(async () => json(addressHit));
    await createGeocoder({ fetch }).address("400 Broad St & 5th, Seattle");
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.host).toBe("geocoding.geo.census.gov");
    expect(url.pathname).toBe("/geocoder/geographies/onelineaddress");
    expect(url.searchParams.get("address")).toBe("400 Broad St & 5th, Seattle");
    expect(url.searchParams.get("format")).toBe("json");
  });

  it("returns null when nothing matches", async () => {
    const fetch = vi.fn(async () => json({ result: { addressMatches: [] } }));
    expect(await createGeocoder({ fetch }).address(SECRET)).toBeNull();
  });

  it("returns a hit without a tract when the tract layer is absent", async () => {
    const body = { result: { addressMatches: [{ coordinates: { x: -122.3, y: 47.6 }, geographies: {} }] } };
    const hit = await createGeocoder({ fetch: vi.fn(async () => json(body)) }).address(SECRET);
    expect(hit).toEqual({ lat: 47.6, lon: -122.3, tract: undefined, matched: undefined });
  });

  it.each([
    ["an HTTP error", async () => json({ error: SECRET }, 500)],
    ["a body that is not JSON", async () => new Response(`<html>${SECRET}</html>`)],
    ["an unexpected shape", async () => json({ nope: true })],
    ["a network failure", async () => { throw new Error(`connect failed for ${SECRET}`); }],
  ])("fails without repeating the address on %s", async (_name, impl) => {
    const fetch = vi.fn(impl as () => Promise<Response>);
    const err = await createGeocoder({ fetch }).address(SECRET).catch((e) => e);
    expect(err).toBeInstanceOf(GeocoderError);
    expect(String(err.message)).not.toContain("Secret");
    expect(String(err.stack)).not.toContain("Secret");
    expect(err.cause).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after the timeout", async () => {
    const fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const err = await createGeocoder({ fetch: fetch as never, timeoutMs: 20 })
      .address(SECRET)
      .catch((e) => e);
    expect(err).toBeInstanceOf(GeocoderError);
    expect(String(err.message)).not.toContain("Secret");
  });
});

describe("coordinates", () => {
  it("returns the tract containing a point", async () => {
    const fetch = vi.fn(async () => json({ result: { geographies: { "Census Tracts": [tract] } } }));
    const hit = await createGeocoder({ fetch }).coordinates(47.6062, -122.3321);
    expect(hit).toEqual({ lat: 47.6062, lon: -122.3321, tract: "53033008102" });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe("/geocoder/geographies/coordinates");
    expect(url.searchParams.get("x")).toBe("-122.3321");
    expect(url.searchParams.get("y")).toBe("47.6062");
  });

  it("returns null for a point in no tract", async () => {
    const fetch = vi.fn(async () => json({ result: { geographies: {} } }));
    expect(await createGeocoder({ fetch }).coordinates(0, -150)).toBeNull();
  });
});
