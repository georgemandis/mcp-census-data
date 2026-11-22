import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nearbyPlaces } from "../src/places/nearby.js";
import { openPlaces, type PlacesStore } from "../src/places/store.js";
import type { Located } from "../src/profile/locate.js";
import { ProfileInputError, buildProfile } from "../src/profile/profile.js";
import { openStore, type Store } from "../src/profile/store.js";
import { buildPlacesFixture } from "./places-fixture.js";
import { buildFixture } from "./profile-fixture.js";

let profileFixture: Awaited<ReturnType<typeof buildFixture>>;
let placesFixture: Awaited<ReturnType<typeof buildPlacesFixture>>;
let store: Store;
let places: PlacesStore;

beforeAll(async () => {
  profileFixture = await buildFixture();
  placesFixture = await buildPlacesFixture();
  store = await openStore(profileFixture.dir);
  places = await openPlaces(placesFixture.dir);
});
afterAll(async () => {
  await store.close();
  await places.close();
  await profileFixture.cleanup();
  await placesFixture.cleanup();
});

const guam: Located = { kind: "zip", label: "ZIP code area 96910", lat: 13.4505, lon: 144.7507, anchor: "66010953400", exact: true };
const vi: Located = { kind: "zip", label: "ZIP code area 00802", lat: 18.3429, lon: -64.9251, anchor: "78030961200", exact: true };

describe("profile_place in the Island Areas", () => {
  it.each([
    [guam, "Guam"],
    [vi, "U.S. Virgin Islands"],
  ])("refuses with the reason", async (located, name) => {
    const err = await buildProfile(located, store).catch((e) => e);
    expect(err).toBeInstanceOf(ProfileInputError);
    expect(err.message).toBe(
      `The American Community Survey does not cover ${name}, so there is no profile here. nearby_places can still count places and SNAP retailers there.`,
    );
  });
});

describe("nearby_places in the Island Areas", () => {
  it("gives counts without rates and says why", async () => {
    const r = await nearbyPlaces(guam, store, places, { types: ["libraries"], radiusMiles: 5 });
    expect((r.types![0] as any).here.rate).toBeNull();
    expect(r.notes).toContain(
      "The American Community Survey does not cover Guam, so there are no population figures or rates here, and the area is the census tract at this point whatever the radius.",
    );
    expect(r.notes).not.toContain("There are no population figures for this area, so only counts are given.");
    expect(r.notes.some((n) => n.startsWith("Only one census tract"))).toBe(false);
  });
});
