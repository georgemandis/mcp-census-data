import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlacesMissingError, defaultPlacesLocation, openPlaces, type PlacesStore } from "../src/places/store.js";
import { PATHS, buildPlacesFixture } from "./places-fixture.js";
import { CENTRE, TRACT } from "./profile-fixture.js";

let fixture: Awaited<ReturnType<typeof buildPlacesFixture>>;
let places: PlacesStore;
beforeAll(async () => {
  fixture = await buildPlacesFixture();
  places = await openPlaces(fixture.dir);
});
afterAll(async () => {
  await places.close();
  await fixture.cleanup();
});

const AB = [TRACT.A, TRACT.B];

describe("openPlaces", () => {
  it("reads the manifest and the type list", async () => {
    expect(places.manifest).toMatchObject({ release: "2026-11-18.0", places: 35 });
    const types = await places.types();
    expect(types.find((t) => t.path === PATHS.grocery)).toEqual({ path: PATHS.grocery, name: "grocery_store", n: 5000 });
    expect(types.find((t) => t.path === "education")!.n).toBe(5000);
  });

  it("says how to build the data when it is missing", async () => {
    await expect(openPlaces("/nonexistent/places")).rejects.toThrow(PlacesMissingError);
    await expect(openPlaces("/nonexistent/places")).rejects.toThrow(/npm run build:places/);
  });

  it("defaults to data/places in the project, or CENSUS_PLACES_DIR", () => {
    expect(defaultPlacesLocation({}).endsWith("/data/places")).toBe(true);
    expect(defaultPlacesLocation({ CENSUS_PLACES_DIR: "/x/y" })).toBe("/x/y");
  });
});

describe("countHere", () => {
  it("counts a type in the given tracts", async () => {
    expect(await places.countHere(PATHS.library, AB)).toBe(2);
    expect(await places.countHere(PATHS.library, [TRACT.A, TRACT.B, TRACT.C])).toBe(3);
    expect(await places.countHere(PATHS.restaurant, AB)).toBe(5);
  });

  it("takes in sub-types", async () => {
    expect(await places.countHere(PATHS.grocery, AB)).toBe(3);
    expect(await places.countHere(PATHS.asian, AB)).toBe(1);
    expect(await places.countHere("shopping", AB)).toBe(4);
  });

  it("does not take in a look-alike that is not beneath the node", async () => {
    expect(await places.countHere(PATHS.school, AB)).toBe(1);
    expect(await places.countHere("education", AB)).toBe(3);
  });

  it("is zero for no tracts, an absent type, or a tract with no places", async () => {
    expect(await places.countHere(PATHS.library, [])).toBe(0);
    expect(await places.countHere(PATHS.foodBank, AB)).toBe(0);
    expect(await places.countHere(PATHS.library, ["99999999999"])).toBe(0);
  });
});

describe("countIn", () => {
  it("counts a type, with sub-types, in a county, a state and the nation", async () => {
    expect(await places.countIn("county", "53033", PATHS.library)).toBe(20);
    expect(await places.countIn("county", "53033", PATHS.grocery)).toBe(50);
    expect(await places.countIn("state", "53", PATHS.grocery)).toBe(500);
    expect(await places.countIn("us", "", PATHS.grocery)).toBe(5000);
    expect(await places.countIn("county", "53033", PATHS.school)).toBe(30);
  });

  it("is zero for a county with no places", async () => {
    expect(await places.countIn("county", "99999", PATHS.library)).toBe(0);
  });
});

describe("nearest", () => {
  it("writes the state without Overture's country prefix", async () => {
    const [first] = await places.nearest(PATHS.library, [TRACT.A], CENTRE.lat, CENTRE.lon, 1);
    expect(first.address).toBe("100 Main St, Seattle, WA");
  });

  it("returns the closest first, with distance and a joined address", async () => {
    const r = await places.nearest(PATHS.library, [TRACT.A, TRACT.B, TRACT.C], CENTRE.lat, CENTRE.lon, 2);
    expect(r.map((x) => x.name)).toEqual(["Central Library", "North Library"]);
    expect(r[0]).toEqual({
      name: "Central Library",
      type: "library",
      path: PATHS.library,
      address: "100 Main St, Seattle, WA",
      miles: 0.1,
    });
  });

  it("returns a place with no name or address as nulls, never the word null", async () => {
    const r = await places.nearest(PATHS.park, AB, CENTRE.lat, CENTRE.lon, 5);
    expect(r).toEqual([{ name: null, type: "park", path: PATHS.park, address: null, miles: 0.4 }]);
    expect(JSON.stringify(r)).not.toContain('"null"');
  });

  it("is empty for no tracts", async () => {
    expect(await places.nearest(PATHS.library, [], CENTRE.lat, CENTRE.lon, 5)).toEqual([]);
  });
});

describe("broad types", () => {
  it("counts by broad type here, leaving out places without one", async () => {
    const here = await places.broadHere(AB);
    expect(Object.fromEntries(here)).toEqual({
      restaurant: 5, food_and_beverage_store: 3, library: 2, specialty_store: 1, park: 1, school: 1, cafe: 6, bar: 12,
    });
    expect((await places.broadHere([])).size).toBe(0);
  });

  it("counts by broad type in a county", async () => {
    const county = await places.broadIn("county", "53033");
    expect(county.get("food_and_beverage_store")).toBe(50);
    expect(county.get("restaurant")).toBe(400);
    expect(county.has("null")).toBe(false);
    expect(county.size).toBe(10);
  });
});

describe("around", () => {
  it("counts several types and finds their nearest places in one go", async () => {
    const r = await places.around([PATHS.library, PATHS.grocery, PATHS.foodBank], AB, CENTRE.lat, CENTRE.lon, 2);
    expect(r.counts).toEqual([2, 3, 0]);
    expect(r.nearest.map((list) => list.map((p) => p.name))).toEqual([
      ["Central Library", "North Library"],
      ["Corner Grocery", "Asia Market"],
      [],
    ]);
    expect(r.nearest[1][1]).toEqual({
      name: "Asia Market", type: "asian_grocery_store", path: PATHS.asian, address: "250 Main St, Seattle, WA", miles: 0.25,
    });
  });

  it("agrees with the single-type calls", async () => {
    const tracts = [TRACT.A, TRACT.B, TRACT.C, TRACT.D];
    const r = await places.around([PATHS.restaurant, "shopping"], tracts, CENTRE.lat, CENTRE.lon, 5);
    expect(r.counts[0]).toBe(await places.countHere(PATHS.restaurant, tracts));
    expect(r.counts[1]).toBe(await places.countHere("shopping", tracts));
    expect(r.nearest[0]).toEqual(await places.nearest(PATHS.restaurant, tracts, CENTRE.lat, CENTRE.lon, 5));
  });

  it("handles tracts in several counties and an empty request", async () => {
    const r = await places.around([PATHS.library], [TRACT.A, "53061000100", "11001000100"], CENTRE.lat, CENTRE.lon, 5);
    expect(r.counts).toEqual([1]);
    expect(await places.around([], AB, CENTRE.lat, CENTRE.lon, 5)).toEqual({ counts: [], nearest: [] });
    expect(await places.around([PATHS.library], [], CENTRE.lat, CENTRE.lon, 5)).toEqual({ counts: [0], nearest: [[]] });
  });
});
