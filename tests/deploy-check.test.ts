import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDeployable } from "../src/scripts/deploy-check.js";
import { buildFixture } from "./profile-fixture.js";

let fixture: Awaited<ReturnType<typeof buildFixture>>;

beforeAll(async () => {
  fixture = await buildFixture();
});
afterAll(async () => {
  await fixture.cleanup();
});

describe("checkDeployable", () => {
  it("passes when the manifest and every file it names are present", async () => {
    const r = await checkDeployable(fixture.dir);
    expect(r.tables).toBe(30);
    expect(r.megabytes).toBeGreaterThan(0);
  });

  it("refuses an empty directory and says how to build the data", async () => {
    const empty = await mkdtemp(join(tmpdir(), "deploy-empty-"));
    await expect(checkDeployable(empty)).rejects.toThrow(/npm run build:acs/);
    await rm(empty, { recursive: true });
  });

  it("refuses a directory that does not exist", async () => {
    await expect(checkDeployable("/nonexistent/acs")).rejects.toThrow(/npm run build:acs/);
  });

  it("names a table file that is missing", async () => {
    const broken = await buildFixture();
    await rm(join(broken.dir, "b22003.parquet"));
    await expect(checkDeployable(broken.dir)).rejects.toThrow(/b22003\.parquet/);
    await rm(join(broken.dir, "points.parquet"));
    await expect(checkDeployable(broken.dir)).rejects.toThrow(/points\.parquet/);
    await broken.cleanup();
  });
});

describe("checkPlacesDeployable", () => {
  it("passes on a complete places directory and names a missing file", async () => {
    const { checkPlacesDeployable } = await import("../src/scripts/deploy-check.js");
    const { buildPlacesFixture } = await import("./places-fixture.js");
    const places = await buildPlacesFixture();
    expect((await checkPlacesDeployable(places.dir)).places).toBe(35);
    await rm(join(places.dir, "place-counts.parquet"));
    await expect(checkPlacesDeployable(places.dir)).rejects.toThrow(/place-counts\.parquet/);
    await expect(checkPlacesDeployable(places.dir)).rejects.toThrow(/npm run build:places/);
    await expect(checkPlacesDeployable("/nonexistent/places")).rejects.toThrow(/npm run build:places/);
    await places.cleanup();
  });
});

describe("checkSnapDeployable", () => {
  it("passes on a complete SNAP directory and names a missing file", async () => {
    const { checkSnapDeployable } = await import("../src/scripts/deploy-check.js");
    const { buildSnapFixture } = await import("./snap-fixture.js");
    const snap = await buildSnapFixture();
    expect((await checkSnapDeployable(snap.dir)).retailers).toBe(12);
    await rm(join(snap.dir, "snap-counts.parquet"));
    await expect(checkSnapDeployable(snap.dir)).rejects.toThrow(/snap-counts\.parquet/);
    await expect(checkSnapDeployable(snap.dir)).rejects.toThrow(/npm run build:snap/);
    await expect(checkSnapDeployable("/nonexistent/snap")).rejects.toThrow(/npm run build:snap/);
    await snap.cleanup();
  });
});
