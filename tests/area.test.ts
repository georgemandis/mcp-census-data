import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { selectArea } from "../src/profile/area.js";
import type { Located } from "../src/profile/locate.js";
import { openStore, type Store } from "../src/profile/store.js";
import { CENTRE, TRACT, buildFixture } from "./profile-fixture.js";

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

const at = (anchor: string): Located => ({
  kind: "zip", label: "x", lat: CENTRE.lat, lon: CENTRE.lon, anchor, exact: false,
});

describe("selectArea", () => {
  it("takes tracts whose centre is within the radius", async () => {
    expect(await selectArea(at(TRACT.A), store, 1)).toEqual({
      tracts: [TRACT.A, TRACT.B], inRange: 2, truncated: false, coveredMiles: 1, radiusMiles: 1,
    });
  });

  it("adds the anchor when it is outside the radius", async () => {
    const a = await selectArea(at(TRACT.D), store, 1);
    expect(a.tracts).toEqual([TRACT.A, TRACT.B, TRACT.D]);
  });

  it("is the anchor alone at radius zero", async () => {
    expect(await selectArea(at(TRACT.C), store, 0)).toEqual({
      tracts: [TRACT.C], inRange: 0, truncated: false, coveredMiles: 0, radiusMiles: 0,
    });
  });

  it("keeps the nearest when more are in range than allowed", async () => {
    const a = await selectArea(at(TRACT.A), store, 10, 1);
    expect(a.tracts).toEqual([TRACT.A]);
    expect(a.inRange).toBe(6);
    expect(a.truncated).toBe(true);
    expect(a.coveredMiles).toBeCloseTo(0.3, 1);
  });
});
