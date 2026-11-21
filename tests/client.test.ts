import { createCensusClient } from "../src/core/client.js";
import { CensusError } from "../src/core/errors.js";
import { fake, jsonResponse } from "./helpers.js";

const noSleep = async () => {};
const KEY_MSG =
  "The Census API requires a key for data queries. Get a free key at https://api.census.gov/data/key_signup.html and set CENSUS_API_KEY.";

function keyRedirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: { location, "x-datawebapi-keyerror": "1" },
  });
}

test("fetches from api.census.gov with the key and manual redirects", async () => {
  const f = fake([jsonResponse({ a: 1 })]);
  const c = createCensusClient({ apiKey: "K1", fetch: f });
  expect(await c.getJson("2024/acs/acs5?get=NAME&for=us:1")).toEqual({ a: 1 });
  expect(f.calls[0].url).toBe(
    "https://api.census.gov/data/2024/acs/acs5?get=NAME&for=us:1&key=K1"
  );
  expect(f.calls[0].init?.redirect).toBe("manual");
});

test("adds no key parameter when no key is configured", async () => {
  const f = fake([jsonResponse({})]);
  const c = createCensusClient({ apiKey: "", fetch: f });
  await c.getJson("2024/acs/acs5/variables.json");
  expect(f.calls[0].url).toBe(
    "https://api.census.gov/data/2024/acs/acs5/variables.json"
  );
  expect(c.hasKey).toBe(false);
});

test("returns null on 204", async () => {
  const c = createCensusClient({ fetch: fake([new Response(null, { status: 204 })]) });
  expect(await c.getJson("x")).toBeNull();
});

test("serves repeat requests from cache", async () => {
  const f = fake([jsonResponse({ n: 1 })]);
  const c = createCensusClient({ fetch: f });
  await c.getJson("x.json");
  expect(await c.getJson("x.json")).toEqual({ n: 1 });
  expect(f.calls.length).toBe(1);
});

test("cache entries expire after ttlMs", async () => {
  let t = 0;
  const f = fake([jsonResponse({ n: 1 }), jsonResponse({ n: 2 })]);
  const c = createCensusClient({ fetch: f, now: () => t });
  await c.getJson("x.json", { ttlMs: 1000 });
  t = 1001;
  expect(await c.getJson("x.json", { ttlMs: 1000 })).toEqual({ n: 2 });
});

test("evicts the oldest entry past cacheMaxEntries", async () => {
  const f = fake([jsonResponse(1), jsonResponse(2), jsonResponse(3), jsonResponse(4)]);
  const c = createCensusClient({ fetch: f, cacheMaxEntries: 2 });
  await c.getJson("a");
  await c.getJson("b");
  await c.getJson("c");
  await c.getJson("a");
  expect(f.calls.length).toBe(4);
});

test("errors are not cached", async () => {
  const f = fake([new Response("nope", { status: 400 }), jsonResponse({ ok: 1 })]);
  const c = createCensusClient({ fetch: f });
  await expect(c.getJson("x")).rejects.toBeInstanceOf(CensusError);
  expect(await c.getJson("x")).toEqual({ ok: 1 });
});

test("identical in-flight requests share one upstream call", async () => {
  const f = fake([jsonResponse({ ok: 1 })]);
  const c = createCensusClient({ fetch: f });
  const [a, b] = await Promise.all([c.getJson("x.json"), c.getJson("x.json")]);
  expect(f.calls.length).toBe(1);
  expect(a).toEqual(b);
});

test("missing-key redirect becomes a missing_key error and is not retried", async () => {
  const f = fake([keyRedirect("https://api.census.gov/data/missing_key.html")]);
  const c = createCensusClient({ apiKey: "", fetch: f, sleep: noSleep });
  await expect(c.getJson("2024/acs/acs5?get=NAME&for=us:1")).rejects.toMatchObject({
    kind: "missing_key",
    message: KEY_MSG,
  });
  expect(f.calls.length).toBe(1);
});

test("invalid-key redirect becomes an invalid_key error", async () => {
  const f = fake([keyRedirect("https://api.census.gov/data/invalid_key.html")]);
  const c = createCensusClient({ apiKey: "BAD", fetch: f, sleep: noSleep });
  await expect(c.getJson("x", { requiresKey: true })).rejects.toMatchObject({ kind: "invalid_key" });
});

test("requiresKey without a key fails before any request", async () => {
  const f = fake([]);
  const c = createCensusClient({ apiKey: "", fetch: f });
  await expect(c.getJson("x", { requiresKey: true })).rejects.toMatchObject({
    kind: "missing_key",
    message: KEY_MSG,
  });
  expect(f.calls.length).toBe(0);
});

test.each([429, 500, 503])("retries on %i then succeeds", async (status) => {
  const f = fake([new Response("busy", { status }), jsonResponse({ ok: 1 })]);
  const c = createCensusClient({ fetch: f, sleep: noSleep });
  expect(await c.getJson("x")).toEqual({ ok: 1 });
  expect(f.calls.length).toBe(2);
});

test("retries on a network error", async () => {
  const f = fake([new TypeError("fetch failed"), jsonResponse({ ok: 1 })]);
  const c = createCensusClient({ fetch: f, sleep: noSleep });
  expect(await c.getJson("x")).toEqual({ ok: 1 });
});

test("gives up after retries with an http error", async () => {
  const f = fake([500, 500, 500].map((s) => new Response("down", { status: s })));
  const c = createCensusClient({ fetch: f, sleep: noSleep });
  await expect(c.getJson("x")).rejects.toMatchObject({
    kind: "http",
    status: 500,
    message: "Census API 500: down",
  });
  expect(f.calls.length).toBe(3);
});

test("backoff doubles between retries", async () => {
  const waits: number[] = [];
  const f = fake([500, 500, 500].map((s) => new Response("down", { status: s })));
  const c = createCensusClient({ fetch: f, sleep: async (ms) => void waits.push(ms) });
  await expect(c.getJson("x")).rejects.toBeInstanceOf(CensusError);
  expect(waits).toEqual([250, 500]);
});

test("does not retry other 4xx", async () => {
  const f = fake([new Response("not found", { status: 404 })]);
  const c = createCensusClient({ fetch: f, sleep: noSleep });
  await expect(c.getJson("x")).rejects.toMatchObject({ kind: "http", status: 404 });
  expect(f.calls.length).toBe(1);
});

test("a request that outlives timeoutMs fails as timeout after retries", async () => {
  const hang = () =>
    (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      });
  let calls = 0;
  const f = ((u: unknown, init?: RequestInit) => {
    calls++;
    return hang()(u, init);
  }) as typeof fetch;
  const c = createCensusClient({ fetch: f, timeoutMs: 5, retries: 1, sleep: noSleep });
  await expect(c.getJson("x")).rejects.toMatchObject({ kind: "timeout" });
  expect(calls).toBe(2);
});

test("plain-text Census error is quoted and key-free", async () => {
  const body = "error: unknown variable 'B19013_001X' (key=SECRET123)";
  const f = fake([new Response(body, { status: 400 })]);
  const c = createCensusClient({ apiKey: "SECRET123", fetch: f });
  const err = await c.getJson("2024/acs/acs5?get=B19013_001X&for=us:1").catch((e) => e);
  expect(err).toMatchObject({ kind: "http" });
  expect(err.message).toContain("unknown variable 'B19013_001X'");
  expect(err.message).not.toContain("SECRET123");
});

test("2xx with a non-JSON body is a bad_response", async () => {
  const f = fake([new Response("<html>maintenance</html>", { status: 200 })]);
  const c = createCensusClient({ fetch: f });
  await expect(c.getJson("x")).rejects.toMatchObject({
    kind: "bad_response",
    message: expect.stringContaining("<html>maintenance</html>"),
  });
});

test("over the per-minute budget fails as busy without a request", async () => {
  let t = 0;
  const f = fake([jsonResponse(1), jsonResponse(2), jsonResponse(3)]);
  const c = createCensusClient({ fetch: f, maxRequestsPerMinute: 2, now: () => t });
  await c.getJson("a");
  await c.getJson("b");
  await expect(c.getJson("c")).rejects.toMatchObject({
    kind: "busy",
    message: "The Census connector is at its request limit. Try again in a minute.",
  });
  expect(f.calls.length).toBe(2);
  t = 60_001;
  expect(await c.getJson("c")).toBe(3);
});

test("cache hits do not spend the budget", async () => {
  const f = fake([jsonResponse(1)]);
  const c = createCensusClient({ fetch: f, maxRequestsPerMinute: 1 });
  await c.getJson("a");
  expect(await c.getJson("a")).toBe(1);
});

test("redact removes the key value and any key parameter", () => {
  const c = createCensusClient({ apiKey: "SECRET123", fetch: fake([]) });
  expect(c.redact("https://x/y?get=A&key=SECRET123&for=us:1 and SECRET123")).toBe(
    "https://x/y?get=A&key=REDACTED&for=us:1 and REDACTED"
  );
  expect(c.redact("?key=otherkey")).toBe("?key=REDACTED");
});

// --- Final review fixes ---

test("the cache is bounded by bytes, evicting least recently used first", async () => {
  const big = (n: number) => jsonResponse("x".repeat(n));
  const f = fake([big(400), big(400), big(400), big(400)]);
  const c = createCensusClient({ fetch: f, cacheMaxBytes: 1000 });
  await c.getJson("a");
  await c.getJson("b");
  await c.getJson("a"); // a is now the most recently used
  await c.getJson("c"); // evicts b, not a
  await c.getJson("a");
  expect(f.calls.length).toBe(3);
  await c.getJson("b");
  expect(f.calls.length).toBe(4);
});

test("a response larger than the whole cache is returned but not cached", async () => {
  const f = fake([jsonResponse("x".repeat(500)), jsonResponse("x".repeat(500))]);
  const c = createCensusClient({ fetch: f, cacheMaxBytes: 100 });
  await c.getJson("a");
  await c.getJson("a");
  expect(f.calls.length).toBe(2);
});

test("a rejected key does not take down requests that need no key", async () => {
  const f = fake([keyRedirect("https://api.census.gov/data/invalid_key.html"), jsonResponse({ variables: {} })]);
  const c = createCensusClient({ apiKey: "BAD", fetch: f, sleep: noSleep });
  expect(await c.getJson("2024/acs/acs5/variables.json")).toEqual({ variables: {} });
  expect(f.calls[1].url).toBe("https://api.census.gov/data/2024/acs/acs5/variables.json");
});

test("a rejected key still fails requests that do need one", async () => {
  const f = fake([keyRedirect("https://api.census.gov/data/invalid_key.html")]);
  const c = createCensusClient({ apiKey: "BAD", fetch: f, sleep: noSleep });
  await expect(c.getJson("x", { requiresKey: true })).rejects.toMatchObject({ kind: "invalid_key" });
  expect(f.calls.length).toBe(1);
});
