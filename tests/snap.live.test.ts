/**
 * Checks SNAP answers against the real built data. Runs only when the
 * profile, places and SNAP data all exist (npm run build:acs, build:places,
 * build:snap). Uses no network and no key.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { nearbyPlaces, type Nearby, type SnapAnswer } from "../src/places/nearby.js";
import { defaultPlacesLocation, openPlaces, type PlacesStore } from "../src/places/store.js";
import { selectArea } from "../src/profile/area.js";
import type { Geocoder } from "../src/profile/geocode.js";
import { locate } from "../src/profile/locate.js";
import { defaultLocation, openStore, type Store } from "../src/profile/store.js";
import { FULL_LINE, defaultSnapLocation, openSnap, type SnapStore } from "../src/snap/store.js";

const dir = defaultSnapLocation();
const built = [dir, defaultPlacesLocation(), defaultLocation()].every((d) => existsSync(join(d, "manifest.json")));

const noGeocoder: Geocoder = {
  address: async () => { throw new Error("geocoder used"); },
  coordinates: async () => { throw new Error("geocoder used"); },
};

describe.skipIf(!built)("SNAP retailers on built data", () => {
  let store: Store;
  let places: PlacesStore;
  let snap: SnapStore;

  const at = (location: string) => locate(location, { store, geocoder: noGeocoder });
  const ask = async (location: string, types: string[], radiusMiles?: number): Promise<Nearby> =>
    nearbyPlaces(await at(location), store, places, { types, snap, radiusMiles });
  const direct = async (sql: string) => {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    const rows = (await db.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[];
    db.closeSync();
    return rows;
  };

  beforeAll(async () => {
    store = await openStore();
    places = await openPlaces();
    snap = await openSnap();
  });
  afterAll(async () => {
    await store.close();
    await places.close();
    await snap.close();
  });

  test("national counts are in the expected range", async () => {
    const us = await snap.countsIn("us", "");
    const full = FULL_LINE.reduce((a, t) => a + (us.get(t) ?? 0), 0);
    const all = [...us.values()].reduce((a, b) => a + b, 0);
    expect(full).toBeGreaterThanOrEqual(55_000);
    expect(full).toBeLessThanOrEqual(70_000);
    expect(all).toBeGreaterThanOrEqual(230_000);
    expect(all).toBeLessThanOrEqual(270_000);
    expect(snap.manifest.dropped).toBeLessThan(snap.manifest.retailers * 0.01);
  });

  test("an area's counts equal a direct query of the retailers file", async () => {
    const area = await selectArea(await at("98101"), store, 1);
    const a = (await ask("98101", ["SNAP stores"])).types![0] as SnapAnswer;
    const inArea = `FROM read_parquet('${join(dir, "retailers.parquet")}') WHERE tract IN (${area.tracts.map((t) => `'${t}'`).join(", ")})`;
    const [all] = await direct(`SELECT count(*) AS n ${inArea}`);
    const [full] = await direct(`SELECT count(*) AS n ${inArea} AND full_line`);
    expect(a.all_retailers.here.count).toBe(Number(all.n));
    expect(a.full_line.here.count).toBe(Number(full.n));
    expect(a.full_line.here.count).toBeGreaterThan(0);
    expect(a.nearest_full_line.length).toBeGreaterThan(0);
  });

  test("Puerto Rico is outside SNAP; Guam is answered", async () => {
    const pr = (await ask("San Juan, PR", ["SNAP stores"], 3)).types![0] as { note?: string };
    expect(pr.note).toMatch(/^Puerto Rico does not take part in SNAP/);
    // The profile data has no tracts in Guam (the ACS does not cover it), so a
    // located point there counts its own tract, without rates.
    const guam = { kind: "coordinates" as const, label: "13.4757, 144.7489", lat: 13.4757, lon: 144.7489, anchor: "66010953400", exact: true };
    const r = await nearbyPlaces(guam, store, places, { types: ["SNAP stores"], snap, radiusMiles: 0 });
    const gu = r.types![0] as SnapAnswer;
    expect(gu.all_retailers.here.count).toBeGreaterThan(0);
    expect(gu.all_retailers.here.rate).toBeNull();
  });

  test("a mixed answer is quick and compact", async () => {
    await ask("98101", ["grocery stores", "SNAP stores", "libraries"]); // warm
    const started = Date.now();
    const r = await ask("98101", ["grocery stores", "SNAP stores", "libraries"]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(JSON.stringify(r).length).toBeLessThan(15000);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  test("memory stays within the machine after many SNAP calls", async () => {
    const locations = ["98101", "10001", "60601", "59001", "30303"];
    for (let i = 0; i < 20; i++) {
      await ask(locations[i % locations.length], ["SNAP stores", "grocery stores"], i % 2 ? 5 : 1);
    }
    const rss = process.memoryUsage().rss / 1024 ** 2;
    console.log(`rss after 20 SNAP calls: ${Math.round(rss)} MB`);
    expect(rss).toBeLessThan(450);
  }, 120_000);
});
