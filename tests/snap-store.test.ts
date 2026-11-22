import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SnapMissingError, openSnap, type SnapStore } from "../src/snap/store.js";
import { CENTRE, TRACT } from "./profile-fixture.js";
import { OVER_THE_LINE, buildSnapFixture } from "./snap-fixture.js";

let fixture: Awaited<ReturnType<typeof buildSnapFixture>>;
let snap: SnapStore;

beforeAll(async () => {
  fixture = await buildSnapFixture();
  snap = await openSnap(fixture.dir);
});
afterAll(async () => {
  await snap.close();
  await fixture.cleanup();
});

describe("SnapStore", () => {
  it("reads the manifest", () => {
    expect(snap.manifest.as_of).toBe("2026-11-05");
  });

  it("counts retailers by type in an area", async () => {
    const { byType } = await snap.around([TRACT.A, TRACT.B], CENTRE.lat, CENTRE.lon, 5);
    expect(Object.fromEntries(byType)).toEqual({
      Supermarket: 1, "Grocery Store": 1, "Super Store": 1, "Convenience Store": 4, "Specialty Store": 1,
    });
  });

  it("gives the nearest full-line stores, nearest first", async () => {
    const { nearestFullLine } = await snap.around([TRACT.A, TRACT.B], CENTRE.lat, CENTRE.lon, 5);
    expect(nearestFullLine.map((x) => x.name)).toEqual(["Fresh Mart", "Corner Grocery", "Big Box"]);
    expect(nearestFullLine.map((x) => x.type)).toEqual(["Supermarket", "Grocery Store", "Super Store"]);
    expect(nearestFullLine[0].address).toBe("100 Main St, Seattle, WA");
    for (const [i, miles] of [0.1, 0.2, 0.75].entries()) {
      expect(Math.abs(nearestFullLine[i].miles - miles)).toBeLessThan(0.01);
    }
    const two = await snap.around([TRACT.A, TRACT.B], CENTRE.lat, CENTRE.lon, 2);
    expect(two.nearestFullLine).toHaveLength(2);
  });

  it("gives nothing for no tracts", async () => {
    const r = await snap.around([], CENTRE.lat, CENTRE.lon, 5);
    expect(r.byType.size).toBe(0);
    expect(r.nearestFullLine).toEqual([]);
  });

  it("counts an area across a county line", async () => {
    const { byType } = await snap.around([TRACT.A, OVER_THE_LINE], CENTRE.lat, CENTRE.lon, 5);
    expect(byType.get("Convenience Store")).toBe(4);
  });

  it("gives counts for a county and the nation", async () => {
    expect((await snap.countsIn("county", "53033")).get("Supermarket")).toBe(10);
    expect((await snap.countsIn("us", "")).get("Convenience Store")).toBe(4000);
  });

  it("refuses a directory without the data", async () => {
    const empty = await mkdtemp(join(tmpdir(), "snap-empty-"));
    await expect(openSnap(empty)).rejects.toBeInstanceOf(SnapMissingError);
    await expect(openSnap(empty)).rejects.toThrow(/npm run build:snap/);
    await rm(empty, { recursive: true });
  });
});
