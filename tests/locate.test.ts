import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeocoderError, type Geocoder } from "../src/profile/geocode.js";
import { LocateError, classify, locate } from "../src/profile/locate.js";
import { openStore, type Store } from "../src/profile/store.js";
import { CENTRE, TRACT, buildFixture } from "./profile-fixture.js";

const SECRET = "123 Secret St, Seattle WA";

let fixture: Awaited<ReturnType<typeof buildFixture>>;
let store: Store;

beforeAll(async () => {
  fixture = await buildFixture();
  store = await openStore(fixture.dir);
});

afterAll(async () => {
  await store.close();
  await fixture.cleanup();
});

const geocoder = (over: Partial<Geocoder> = {}): Geocoder => ({
  address: async () => ({ lat: CENTRE.lat, lon: CENTRE.lon, tract: TRACT.A, matched: "123 SECRET ST" }),
  coordinates: async (lat, lon) => ({ lat, lon, tract: TRACT.B }),
  ...over,
});

const down: Partial<Geocoder> = {
  address: async () => { throw new GeocoderError(); },
  coordinates: async () => { throw new GeocoderError(); },
};

describe("classify", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["98101", { kind: "zip", zip: "98101" }],
    [" 98101 ", { kind: "zip", zip: "98101" }],
    ["981011", { kind: "address" }],
    ["47.6062, -122.3321", { kind: "coordinates", lat: 47.6062, lon: -122.3321 }],
    ["47.6062,-122.3321", { kind: "coordinates", lat: 47.6062, lon: -122.3321 }],
    ["95, 200", { kind: "address" }],
    ["Seattle, WA", { kind: "place", name: "Seattle", state: "WA" }],
    ["Seattle, Washington", { kind: "place", name: "Seattle", state: "WA" }],
    ["seattle wa", { kind: "place", name: "seattle", state: "WA" }],
    ["Springfield", { kind: "place", name: "Springfield" }],
    ["Winston-Salem, NC", { kind: "place", name: "Winston-Salem", state: "NC" }],
    ["Paris, France", { kind: "place", name: "Paris, France" }],
    ["400 Broad St, Seattle", { kind: "address" }],
    ["Pier 57, Seattle WA", { kind: "address" }],
  ])("%j", (input, expected) => {
    expect(classify(input)).toEqual(expected);
  });
});

describe("locate", () => {
  it("asks for a location when given none", async () => {
    const err = await locate("  ", { store, geocoder: geocoder() }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.message).toMatch(/street address, a 5-digit ZIP/);
  });

  it("resolves a ZIP to its centre and the nearest tract", async () => {
    const r = await locate("98101", { store, geocoder: geocoder(down) });
    expect(r).toMatchObject({
      kind: "zip",
      label: "ZIP code area 98101",
      lat: 47.6101,
      lon: -122.3344,
      anchor: TRACT.A,
      exact: false,
    });
  });

  it("explains a ZIP with no area", async () => {
    const err = await locate("00000", { store, geocoder: geocoder() }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.message).toMatch(/PO boxes/);
  });

  it("resolves a place with a state", async () => {
    const r = await locate("Seattle, WA", { store, geocoder: geocoder(down) });
    expect(r).toMatchObject({ kind: "place", label: "Seattle city, WA", exact: false });
    expect(r.anchor).toBe(TRACT.B);
  });

  it("resolves a place whose name is unique without a state", async () => {
    const r = await locate("seattle", { store, geocoder: geocoder(down) });
    expect(r.label).toBe("Seattle city, WA");
  });

  it("offers the candidates when a name is shared", async () => {
    const err = await locate("Springfield", { store, geocoder: geocoder() }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.candidates).toEqual(["Springfield city, IL", "Springfield city, MO"]);
    expect(err.message).toMatch(/Add a state/);
    expect(err.message).toContain("Springfield city, IL");
  });

  it("uses the state to pick between places sharing a name", async () => {
    const r = await locate("Springfield, IL", { store, geocoder: geocoder() });
    expect(r).toMatchObject({ kind: "place", label: "Springfield city, IL", exact: false });
  });

  it("says when no place has the name", async () => {
    const err = await locate("Nowhereville, WA", { store, geocoder: geocoder() }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.message).toMatch(/No place by that name/);
  });

  it("resolves coordinates to the tract that contains them", async () => {
    const r = await locate("47.6062, -122.3321", { store, geocoder: geocoder() });
    expect(r).toEqual({
      kind: "coordinates",
      label: "47.6062, -122.3321",
      lat: 47.6062,
      lon: -122.3321,
      anchor: TRACT.B,
      exact: true,
    });
  });

  it("falls back to the nearest tract when the lookup service is down", async () => {
    const r = await locate("47.6062, -122.3321", { store, geocoder: geocoder(down) });
    expect(r).toMatchObject({ kind: "coordinates", anchor: TRACT.A, exact: false });
  });

  it("refuses coordinates the lookup service places in no tract", async () => {
    const g = geocoder({ coordinates: async () => null });
    const err = await locate("0, -150", { store, geocoder: g }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.message).toMatch(/outside the United States/);
  });

  it("does not call coordinates foreign just because the lookup service is down", async () => {
    const err = await locate("0, -150", { store, geocoder: geocoder(down) }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.message).not.toMatch(/outside the United States/);
    expect(err.message).toMatch(/lookup service did not respond/);
    expect(err.message).toMatch(/ZIP or a place name/);
  });

  it("asks for the full name when two places in one state share a name", async () => {
    const err = await locate("Pewaukee, WI", { store, geocoder: geocoder() }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.candidates).toEqual(["Pewaukee city, WI", "Pewaukee village, WI"]);
    expect(err.message).toMatch(/Use the full name/);
    expect(err.message).not.toMatch(/Add a state/);
    const r = await locate("Pewaukee village, WI", { store, geocoder: geocoder() });
    expect(r.label).toBe("Pewaukee village, WI");
  });

  it("finds Kansas City, MO", async () => {
    const r = await locate("Kansas City, MO", { store, geocoder: geocoder(down) });
    expect(r.label).toBe("Kansas City city, MO");
  });

  it("resolves an address through the geocoder", async () => {
    const r = await locate(SECRET, { store, geocoder: geocoder() });
    expect(r).toEqual({
      kind: "address",
      label: "123 SECRET ST",
      lat: CENTRE.lat,
      lon: CENTRE.lon,
      anchor: TRACT.A,
      exact: true,
    });
  });

  it("uses the nearest tract when the geocoder gives a point but no tract", async () => {
    const g = geocoder({ address: async () => ({ lat: CENTRE.lat, lon: CENTRE.lon }) });
    const r = await locate(SECRET, { store, geocoder: g });
    expect(r).toMatchObject({ anchor: TRACT.A, exact: false, label: "the address given" });
  });

  it("says so when the address is not matched, without repeating it", async () => {
    const err = await locate(SECRET, { store, geocoder: geocoder({ address: async () => null }) }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.message).toBe("The address could not be matched. Try a ZIP or a place name.");
  });

  it("says so when the lookup service fails, without repeating the address", async () => {
    const err = await locate(SECRET, { store, geocoder: geocoder(down) }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.message).toBe("The address lookup service did not respond. Try a ZIP or a place name.");
    expect(String(err.stack)).not.toContain("Secret");
  });
});

describe("locate in the Island Areas", () => {
  it.each([
    ["96910", "66010953400"],
    ["00802", "78030961200"],
  ])("places ZIP %s with the geocoder, not the nearest tract with data", async (zip, tract) => {
    const asked: [number, number][] = [];
    const r = await locate(zip, {
      store,
      geocoder: geocoder({ coordinates: async (lat, lon) => { asked.push([lat, lon]); return { lat, lon, tract }; } }),
    });
    expect(asked).toHaveLength(1);
    expect(r).toMatchObject({ kind: "zip", anchor: tract, exact: true });
  });

  it("says so when the geocoder cannot place it", async () => {
    const err = await locate("96910", { store, geocoder: geocoder(down) }).catch((e) => e);
    expect(err).toBeInstanceOf(LocateError);
    expect(err.message).toBe("The location lookup service did not respond, so that place could not be placed. Try again shortly.");
  });

  it("leaves a far-flung Alaska village on its nearest tract, without the geocoder", async () => {
    const r = await locate("Anvik, AK", {
      store,
      geocoder: geocoder({ coordinates: async () => { throw new Error("geocoder used"); } }),
    });
    expect(r.kind).toBe("place");
    expect(r.anchor).toMatch(/^53/);
  });

  it.each([
    [13.45, 144.75, "66"], [15.18, 145.75, "69"], [-14.28, -170.7, "60"], [18.34, -64.93, "78"], [17.73, -64.75, "78"],
    [18.3, -65.3, null], [18.12, -65.44, null], [21.3, -157.85, null], [47.6, -122.3, null],
  ])("islandArea(%f, %f) is %s", async (lat, lon, state) => {
    const { islandArea } = await import("../src/profile/locate.js");
    expect(islandArea(lat, lon)).toBe(state);
  });
});
