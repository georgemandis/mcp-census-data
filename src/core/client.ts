const BASE = "https://api.census.gov/data";
const TIMEOUT_MS = 10_000;
const cache = new Map<string, unknown>();

const API_KEY = process.env.CENSUS_API_KEY;

if (!API_KEY) {
  console.error(
    "[census-mcp] Warning: CENSUS_API_KEY not set. Requests may be rate-limited."
  );
}

export async function fetchCensusJson(path: string): Promise<unknown> {
  const url = `${BASE}/${path}`;

  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") {
      throw new Error(`Census API timeout after ${TIMEOUT_MS}ms: ${url}`);
    }
    throw e;
  }
  clearTimeout(timer);

  if (res.status === 204) return null;
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Census API ${res.status} for ${url}\n${body.slice(0, 500)}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(
      `Census API returned non-JSON for ${url}:\n${body.slice(0, 500)}`
    );
  }
  cache.set(url, parsed);
  return parsed;
}

export function buildQueryUrl(
  dataset: string,
  vintage: number,
  params: {
    get: string[];
    for: string;
    in?: string;
    predicates?: Record<string, string>;
  }
): string {
  const query = new URLSearchParams({
    get: params.get.join(","),
    for: params.for,
  });
  if (params.in) query.set("in", params.in);
  if (params.predicates) {
    for (const [k, v] of Object.entries(params.predicates)) {
      query.set(k, v);
    }
  }
  if (API_KEY) query.set("key", API_KEY);
  return `${vintage}/${dataset}?${query.toString()}`;
}

export async function queryDataRaw(
  dataset: string,
  vintage: number,
  params: {
    get: string[];
    for: string;
    in?: string;
    predicates?: Record<string, string>;
  }
): Promise<Array<Record<string, string>>> {
  const path = buildQueryUrl(dataset, vintage, params);
  const url = `${BASE}/${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") {
      throw new Error(`Census API timeout after ${TIMEOUT_MS}ms: ${url}`);
    }
    throw e;
  }
  clearTimeout(timer);

  if (res.status === 204) return [];
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Census API ${res.status} for ${url}\n${body.slice(0, 500)}`
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `Census API returned non-JSON for ${url}:\n${body.slice(0, 500)}`
    );
  }

  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0])) {
    throw new Error(
      `Unexpected Census response shape: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  const [headers, ...rows] = data as string[][];
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}
