import { z } from "zod";
import { searchDatasets } from "./core/catalog.js";
import { resolveGeography, listGeographies } from "./core/geography.js";
import { searchVariables, searchGroups } from "./core/variables.js";
import { createCensusClient, queryDataRaw } from "./core/client.js";

// Interim: replaced by injected deps when tool registration is rewritten.
const client = createCensusClient();

// --- discover_datasets ---

export const discoverDatasetsSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Topic to search for (e.g., 'income', 'population', 'business', 'housing')."
    ),
};

export async function discoverDatasetsTool(args: { query: string }) {
  const results = searchDatasets(args.query);
  const note =
    results.length === 0
      ? "No datasets found. Try broader terms like 'demographics', 'economy', 'housing'."
      : `Found ${results.length} dataset(s).`;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "text" as const, text: JSON.stringify(results, null, 2) },
    ],
  };
}

// --- list_geographies ---

export const listGeographiesSchema = {
  dataset: z.string().min(1).describe("Dataset ID (e.g., 'acs/acs5')."),
  vintage: z.number().describe("Year/vintage (e.g., 2024)."),
};

export async function listGeographiesTool(args: {
  dataset: string;
  vintage: number;
}) {
  const levels = await listGeographies(args.dataset, args.vintage);
  const note =
    levels.length === 0
      ? "No geography information found. Check that the dataset and vintage are correct."
      : `Found ${levels.length} geography level(s).`;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "text" as const, text: JSON.stringify(levels, null, 2) },
    ],
  };
}

// --- search_variables ---

export const searchVariablesSchema = {
  dataset: z.string().min(1).describe("Dataset ID (e.g., 'acs/acs5')."),
  vintage: z.number().describe("Year/vintage (e.g., 2024)."),
  query: z
    .string()
    .min(1)
    .describe(
      "Keyword to search variable labels (e.g., 'median household income', 'population', 'rent')."
    ),
};

export async function searchVariablesTool(args: {
  dataset: string;
  vintage: number;
  query: string;
}) {
  const results = await searchVariables(client, args.dataset, args.vintage, args.query);
  const note =
    results.length === 0
      ? "No variables found. Try different keywords or check the dataset/vintage."
      : `Found ${results.length} variable(s).`;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "text" as const, text: JSON.stringify(results, null, 2) },
    ],
  };
}

// --- search_groups ---

export const searchGroupsSchema = {
  dataset: z.string().min(1).describe("Dataset ID (e.g., 'acs/acs5')."),
  vintage: z.number().describe("Year/vintage (e.g., 2024)."),
  query: z
    .string()
    .min(1)
    .describe(
      "Keyword to search group/table names and descriptions (e.g., 'sex by age', 'poverty')."
    ),
};

export async function searchGroupsTool(args: {
  dataset: string;
  vintage: number;
  query: string;
}) {
  const results = await searchGroups(client, args.dataset, args.vintage, args.query);
  const note =
    results.length === 0
      ? "No table groups found. Not all datasets have groups. Try search_variables instead."
      : `Found ${results.length} group(s).`;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "text" as const, text: JSON.stringify(results, null, 2) },
    ],
  };
}

// --- resolve_geography ---

export const resolveGeographySchema = {
  name: z
    .string()
    .min(1)
    .describe(
      "Place name to look up (e.g., 'California', 'Cook County', 'TX')."
    ),
  level: z
    .enum(["state", "county"])
    .optional()
    .describe(
      "Limit search to a specific level. Omit to search both states and counties."
    ),
};

export async function resolveGeographyTool(args: {
  name: string;
  level?: "state" | "county";
}) {
  const results = resolveGeography(args.name, args.level);
  const note =
    results.length === 0
      ? "No matching state or county found. Try a different name, or pass FIPS codes directly to query_data."
      : `Found ${results.length} match(es).`;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "text" as const, text: JSON.stringify(results, null, 2) },
    ],
  };
}

// --- query_data ---

export const queryDataSchema = {
  dataset: z
    .string()
    .min(1)
    .describe("Dataset ID from discover_datasets (e.g., 'acs/acs5')."),
  vintage: z
    .number()
    .describe("Year/vintage from discover_datasets (e.g., 2024)."),
  get: z
    .array(z.string())
    .min(1)
    .describe(
      "Variable codes to retrieve (from search_variables). Always include 'NAME' for human-readable geography labels."
    ),
  for: z
    .string()
    .min(1)
    .describe(
      "Geography clause (from resolve_geography's for_clause, or 'state:*' for all states, 'county:*' for all counties)."
    ),
  in: z
    .string()
    .optional()
    .describe(
      "Parent geography clause (from resolve_geography's in_clause, e.g., 'state:17' when querying counties)."
    ),
  predicates: z
    .record(z.string())
    .optional()
    .describe("Additional filter predicates as key-value pairs."),
};

export async function queryDataTool(args: {
  dataset: string;
  vintage: number;
  get: string[];
  for: string;
  in?: string;
  predicates?: Record<string, string>;
}) {
  const rows = await queryDataRaw(args.dataset, args.vintage, {
    get: args.get,
    for: args.for,
    in: args.in,
    predicates: args.predicates,
  });
  const note =
    rows.length === 0
      ? "No results. Check your variable codes, geography, and dataset/vintage."
      : `Returned ${rows.length} row(s).`;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "text" as const, text: JSON.stringify(rows, null, 2) },
    ],
  };
}
