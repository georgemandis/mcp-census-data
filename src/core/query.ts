import type { CensusClient } from "./client.js";
import { getDataset } from "./catalog.js";
import { CensusError } from "./errors.js";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const MAX_VARIABLES = 50;
const HOUR_MS = 60 * 60 * 1000;

/** Codes the Census Bureau puts in a numeric column to mean "no value". */
const NOT_AVAILABLE = new Set([
  -666666666, -999999999, -888888888, -222222222, -333333333, -555555555,
]);

/** Compared as numbers: the API writes these as "-666666666" and "-666666666.0". */
function isNotAvailable(value: string): boolean {
  return value.startsWith("-") && NOT_AVAILABLE.has(Number(value));
}

/** Arguments query_data carries itself; a predicate must not override them. */
const RESERVED_PREDICATES = new Set(["get", "for", "in", "key"]);

/** Every id in the Census catalog fits this; anything else is a typo or an attack. */
const DATASET_ID = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/;

export function normalizeDataset(dataset: string): string {
  return dataset.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
}

export function isTimeseries(dataset: string): boolean {
  return normalizeDataset(dataset).startsWith("timeseries/");
}

/**
 * "2024/acs/acs5" or "timeseries/poverty/saipe". A vintage passed with a
 * timeseries dataset is ignored; those select years with a `time` predicate.
 */
export function datasetPath(dataset: string, vintage?: number): string {
  const id = normalizeDataset(dataset);
  if (!DATASET_ID.test(id)) {
    throw new CensusError(
      "invalid_request",
      `'${dataset}' is not a valid dataset ID. Use discover_datasets to find one (e.g. 'acs/acs5').`
    );
  }
  if (isTimeseries(id)) return id;
  if (vintage === undefined) {
    throw new CensusError(
      "invalid_request",
      `Dataset ${id} needs a vintage (year). Use discover_datasets to see available years.`
    );
  }
  return `${vintage}/${id}`;
}

/**
 * "state: 06" -> "state:06". Spaces inside a level name ("block group:1") and
 * between clauses ("state:53 county:033") are meaningful and kept.
 */
function normalizeGeoClause(clause: string): string {
  return clause.trim().replace(/\s*:\s*/g, ":").replace(/\s+/g, " ");
}

/**
 * Fetches a file or query under a dataset. Census answers a wrong dataset ID
 * or year with a 404 HTML page; this turns that into a sentence that says
 * what to do next.
 */
export async function getFromDataset(
  client: CensusClient,
  dataset: string,
  vintage: number | undefined,
  suffix: string,
  opts?: { ttlMs?: number; requiresKey?: boolean }
): Promise<unknown> {
  const path = datasetPath(dataset, vintage);
  try {
    return await client.getJson(path + suffix, opts);
  } catch (e) {
    if (!(e instanceof CensusError) || e.status !== 404) throw e;
    const id = normalizeDataset(dataset);
    const year = isTimeseries(id) || vintage === undefined ? "" : ` for ${vintage}`;
    const known = getDataset(id)?.vintages ?? [];
    const hint =
      known.length > 0
        ? `Available years: ${known.slice(-10).join(", ")}.`
        : "Use discover_datasets to find valid dataset IDs and years.";
    throw new CensusError("invalid_request", `Dataset ${id}${year} was not found. ${hint}`);
  }
}

/**
 * Table codes are upper-case (B19013_001E) and people type them in lower
 * case. Some datasets use genuinely lower-case names (cell_value,
 * time_slot_id); those have no digits and are left alone.
 */
function normalizeVariable(name: string): string {
  const v = name.trim();
  const lower = v.toLowerCase();
  return /\d/.test(v) || lower === "name" || lower === "geo_id" ? v.toUpperCase() : v;
}

export interface QueryParams {
  dataset: string;
  vintage?: number;
  get: string[];
  for: string;
  in?: string;
  predicates?: Record<string, string>;
  /** Default 500, max 5000. */
  limit?: number;
}

export interface QueryResult {
  rows: Array<Record<string, string | null>>;
  /** Rows the Census API returned, before the limit. */
  total: number;
  truncated: boolean;
  /** How many "not available" codes were turned into null. */
  nullsReplaced: number;
}

export async function queryData(
  client: CensusClient,
  params: QueryParams
): Promise<QueryResult> {
  const get = params.get.map(normalizeVariable).filter(Boolean);
  if (get.length > MAX_VARIABLES) {
    throw new CensusError(
      "invalid_request",
      `The Census API accepts at most ${MAX_VARIABLES} variables per query; got ${get.length}. Split the request.`
    );
  }
  const query = new URLSearchParams({
    get: get.join(","),
    for: normalizeGeoClause(params.for),
  });
  if (params.in?.trim()) query.set("in", normalizeGeoClause(params.in));
  for (const [k, v] of Object.entries(params.predicates ?? {})) {
    if (RESERVED_PREDICATES.has(k.trim().toLowerCase())) {
      throw new CensusError(
        "invalid_request",
        `'${k}' cannot be used as a predicate; it has its own argument.`
      );
    }
    query.set(k, v);
  }

  const data = await getFromDataset(client, params.dataset, params.vintage, `?${query}`, {
    requiresKey: true,
    ttlMs: HOUR_MS,
  });

  if (data === null) return { rows: [], total: 0, truncated: false, nullsReplaced: 0 };
  if (!Array.isArray(data) || data.length === 0 || !data.every(Array.isArray)) {
    throw new CensusError(
      "bad_response",
      client.redact(
        `Unexpected Census response shape: ${JSON.stringify(data).slice(0, 300)}`
      )
    );
  }

  const [headers, ...table] = data as string[][];
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  let nullsReplaced = 0;
  const rows = table.slice(0, limit).map((row) => {
    const out: Record<string, string | null> = {};
    headers.forEach((h, i) => {
      const value = row[i] ?? null;
      if (value !== null && isNotAvailable(value)) {
        out[h] = null;
        nullsReplaced++;
      } else {
        out[h] = value;
      }
    });
    return out;
  });
  return { rows, total: table.length, truncated: table.length > limit, nullsReplaced };
}
