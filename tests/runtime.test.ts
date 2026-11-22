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

describe("run", () => {
  const deferred = () => {
    let release!: () => void;
    const done = new Promise<void>((r) => (release = r));
    return { done, release };
  };

  it("builds at most the allowed number at once, queues a few, and refuses the rest", async () => {
    const { ProfileBusyError } = await import("../src/profile/runtime.js");
    const rt = createProfileRuntime({ maxConcurrent: 2, maxQueued: 1 });
    let running = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred()];
    const work = (i: number) => async () => {
      running++;
      peak = Math.max(peak, running);
      await gates[i].done;
      running--;
      return i;
    };
    const a = rt.run(work(0));
    const b = rt.run(work(1));
    const c = rt.run(work(2)); // queued
    await expect(rt.run(work(0))).rejects.toBeInstanceOf(ProfileBusyError);
    await Promise.resolve();
    expect(running).toBe(2);
    gates[0].release();
    expect(await a).toBe(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(running).toBe(2); // the queued one took the free place
    gates[1].release();
    gates[2].release();
    expect(await Promise.all([b, c])).toEqual([1, 2]);
    expect(peak).toBe(2);
    expect(running).toBe(0);
  });

  it("frees its place when the work fails", async () => {
    const rt = createProfileRuntime({ maxConcurrent: 1, maxQueued: 0 });
    await expect(rt.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await rt.run(async () => "ok")).toBe("ok");
  });

  it("never lets a burst of 100 exceed the limit", async () => {
    const rt = createProfileRuntime({ maxConcurrent: 2, maxQueued: 8 });
    let running = 0;
    let peak = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        rt.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 2));
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(90);
  });
});

describe("snap", () => {
  it("opens the SNAP data once and shares it", async () => {
    let opens = 0;
    const fake = { manifest: {}, close: async () => undefined } as never;
    const rt = createProfileRuntime({ openSnap: async () => { opens++; return fake; } });
    expect(await rt.snap()).toBe(fake);
    expect(await rt.snap()).toBe(fake);
    expect(opens).toBe(1);
  });

  it("tries again after a failed open", async () => {
    let opens = 0;
    const fake = { manifest: {} } as never;
    const rt = createProfileRuntime({
      openSnap: async () => {
        opens++;
        if (opens === 1) throw new Error("not yet");
        return fake;
      },
    });
    await expect(rt.snap()).rejects.toThrow("not yet");
    expect(await rt.snap()).toBe(fake);
  });

  it("is warmed with the rest", async () => {
    const counted: string[] = [];
    const rt = createProfileRuntime({
      openStore: async () => { throw new Error("no data"); },
      openPlaces: async () => { throw new Error("no data"); },
      openSnap: async () => ({ countsIn: async (level: string) => { counted.push(level); return new Map(); } }) as never,
    });
    await rt.warm();
    expect(counted).toEqual(["us"]);
  });
});
