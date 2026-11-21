import {
  BUSY_MESSAGE,
  CensusError,
  INVALID_KEY_MESSAGE,
  MISSING_KEY_MESSAGE,
} from "./errors.js";

const BASE = "https://api.census.gov/data";
const DAY_MS = 24 * 60 * 60 * 1000;
const BODY_PREVIEW = 300;

export interface ClientOptions {
  /** Defaults to process.env.CENSUS_API_KEY. */
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Retries after the first attempt. */
  retries?: number;
  /** First retry delay; doubles each retry. */
  backoffMs?: number;
  /** Upstream attempts allowed per rolling minute. Protects the shared key. */
  maxRequestsPerMinute?: number;
  cacheMaxEntries?: number;
  /** Ceiling on cached response text. One ACS variable list is several MB. */
  cacheMaxBytes?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CensusClient {
  hasKey: boolean;
  /** GET https://api.census.gov/data/{path}. Returns parsed JSON, or null on 204. */
  getJson(
    path: string,
    opts?: { ttlMs?: number; requiresKey?: boolean }
  ): Promise<unknown>;
  /** Strips the API key from text bound for a result or a log. */
  redact(text: string): string;
}

function envInt(name: string): number | undefined {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function createCensusClient(options: ClientOptions = {}): CensusClient {
  const apiKey = (options.apiKey ?? process.env.CENSUS_API_KEY ?? "").trim();
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 250;
  const maxPerMinute =
    options.maxRequestsPerMinute ??
    envInt("CENSUS_MAX_REQUESTS_PER_MINUTE") ??
    120;
  const cacheMax = options.cacheMaxEntries ?? 200;
  const cacheMaxBytes = options.cacheMaxBytes ?? 64 * 1024 * 1024;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Insertion order doubles as recency: a hit is re-inserted at the end.
  const cache = new Map<string, { value: unknown; expires: number; bytes: number }>();
  let cachedBytes = 0;
  const inFlight = new Map<string, Promise<unknown>>();
  let attempts: number[] = [];

  function redact(text: string): string {
    let out = text.replace(/key=[^&\s)"']*/g, "key=REDACTED");
    if (apiKey) out = out.split(apiKey).join("REDACTED");
    return out;
  }

  function spendBudget(): void {
    const t = now();
    attempts = attempts.filter((a) => t - a < 60_000);
    if (attempts.length >= maxPerMinute) {
      throw new CensusError("busy", BUSY_MESSAGE);
    }
    attempts.push(t);
  }

  function evict(path: string): void {
    const entry = cache.get(path);
    if (!entry) return;
    cachedBytes -= entry.bytes;
    cache.delete(path);
  }

  function remember(path: string, value: unknown, bytes: number, ttlMs: number): void {
    evict(path);
    if (bytes > cacheMaxBytes) return;
    cache.set(path, { value, expires: now() + ttlMs, bytes });
    cachedBytes += bytes;
    while (cache.size > cacheMax || cachedBytes > cacheMaxBytes) {
      evict(cache.keys().next().value as string);
    }
  }

  interface Fetched {
    value: unknown;
    /** Length of the response text; a stand-in for memory held. */
    bytes: number;
  }

  /** One upstream attempt. Throws CensusError; `retryable` marks transient failures. */
  async function attempt(url: string): Promise<Fetched> {
    spendBudget();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    let body: string;
    try {
      res = await doFetch(url, { signal: controller.signal, redirect: "manual" });
      body = res.status === 204 ? "" : await res.text();
    } catch (e) {
      const err =
        (e as Error).name === "AbortError"
          ? new CensusError("timeout", `Census API timed out after ${timeoutMs}ms.`)
          : new CensusError(
              "http",
              redact(`Could not reach the Census API: ${(e as Error).message}`)
            );
      throw Object.assign(err, { retryable: true });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") ?? "";
      const keyError =
        res.headers.has("x-datawebapi-keyerror") ||
        /missing_key|invalid_key/.test(location);
      if (keyError) {
        throw location.includes("invalid_key")
          ? new CensusError("invalid_key", INVALID_KEY_MESSAGE)
          : new CensusError("missing_key", MISSING_KEY_MESSAGE);
      }
    }
    if (res.status === 204) return { value: null, bytes: 0 };
    if (!res.ok) {
      const err = new CensusError(
        "http",
        redact(`Census API ${res.status}: ${body.slice(0, BODY_PREVIEW)}`),
        res.status
      );
      const retryable = res.status === 429 || res.status >= 500;
      throw Object.assign(err, { retryable });
    }
    try {
      return { value: JSON.parse(body), bytes: body.length };
    } catch {
      throw new CensusError(
        "bad_response",
        redact(
          `Census API returned something that is not JSON: ${body.slice(0, BODY_PREVIEW)}`
        )
      );
    }
  }

  async function fetchWithRetry(url: string): Promise<Fetched> {
    for (let i = 0; ; i++) {
      try {
        return await attempt(url);
      } catch (e) {
        if (!(e as { retryable?: boolean }).retryable || i >= retries) throw e;
        await sleep(backoffMs * 2 ** i);
      }
    }
  }

  async function getJson(
    path: string,
    opts: { ttlMs?: number; requiresKey?: boolean } = {}
  ): Promise<unknown> {
    if (opts.requiresKey && !apiKey) {
      throw new CensusError("missing_key", MISSING_KEY_MESSAGE);
    }
    const hit = cache.get(path);
    if (hit && hit.expires > now()) {
      cache.delete(path);
      cache.set(path, hit);
      return hit.value;
    }
    evict(path);

    const pending = inFlight.get(path);
    if (pending) return pending;

    const bare = `${BASE}/${path}`;
    const keyed = apiKey
      ? `${bare}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`
      : bare;

    const request = fetchWithRetry(keyed)
      .catch((e) => {
        // Metadata needs no key. A revoked or mistyped key should cost the
        // data tools only, so ask again without it.
        const keyRejected =
          e instanceof CensusError && (e.kind === "invalid_key" || e.kind === "missing_key");
        if (keyRejected && apiKey && !opts.requiresKey) return fetchWithRetry(bare);
        throw e;
      })
      .then(({ value, bytes }) => {
        remember(path, value, bytes, opts.ttlMs ?? DAY_MS);
        return value;
      })
      .finally(() => inFlight.delete(path));
    inFlight.set(path, request);
    return request;
  }

  return { hasKey: apiKey !== "", getJson, redact };
}
