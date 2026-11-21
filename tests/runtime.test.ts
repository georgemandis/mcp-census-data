import { describe, expect, it } from "vitest";
import { createProfileRuntime, profileLimit } from "../src/profile/runtime.js";

describe("profileLimit", () => {
  it("defaults to 120 a minute", () => {
    expect(profileLimit({})).toBe(120);
  });

  it("reads PROFILE_MAX_PER_MINUTE", () => {
    expect(profileLimit({ PROFILE_MAX_PER_MINUTE: "30" })).toBe(30);
  });

  it.each(["", "abc", "0", "-5", "1.5", "Infinity"])("falls back to 120 for %j", (value) => {
    expect(profileLimit({ PROFILE_MAX_PER_MINUTE: value })).toBe(120);
  });
});

describe("admit", () => {
  it("lets through the limit in a minute, then refuses", () => {
    let now = 1_000_000;
    const rt = createProfileRuntime({ maxPerMinute: 3, now: () => now });
    expect([rt.admit(), rt.admit(), rt.admit()]).toEqual([true, true, true]);
    expect(rt.admit()).toBe(false);
    now += 59_000;
    expect(rt.admit()).toBe(false);
  });

  it("lets calls through again once the minute has passed", () => {
    let now = 1_000_000;
    const rt = createProfileRuntime({ maxPerMinute: 3, now: () => now });
    rt.admit(); rt.admit(); rt.admit();
    now += 60_001;
    expect(rt.admit()).toBe(true);
  });

  it("does not count refused calls against the next minute", () => {
    let now = 0;
    const rt = createProfileRuntime({ maxPerMinute: 1, now: () => now });
    rt.admit();
    for (let i = 0; i < 50; i++) rt.admit();
    now += 60_001;
    expect(rt.admit()).toBe(true);
  });

  it("gives exactly one refusal for 121 calls at the default limit", () => {
    const rt = createProfileRuntime({ now: () => 5 });
    const results = Array.from({ length: 121 }, () => rt.admit());
    expect(results.filter((r) => !r)).toHaveLength(1);
  });
});

describe("warm", () => {
  it("opens the store and reads every table once, so the first request does not pay for it", async () => {
    const { buildFixture } = await import("./profile-fixture.js");
    const { openStore } = await import("../src/profile/store.js");
    const fixture = await buildFixture();
    const read: string[] = [];
    let opens = 0;
    const rt = createProfileRuntime({
      openStore: async () => {
        opens++;
        const store = await openStore(fixture.dir);
        return { ...store, rows: (table, ids) => { read.push(table); return store.rows(table, ids); } };
      },
    });
    await rt.warm();
    expect(opens).toBe(1);
    expect(new Set(read).size).toBe(30);
    await rt.store();
    expect(opens).toBe(1);
    await (await rt.store()).close();
    await fixture.cleanup();
  });

  it("never throws, even when the data is missing", async () => {
    const rt = createProfileRuntime({ openStore: async () => { throw new Error("no data"); } });
    await expect(rt.warm()).resolves.toBeUndefined();
  });
});
