import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchDatasets } from "./core/catalog.js";
import type { CensusClient } from "./core/client.js";
import { BUSY_MESSAGE, CensusError } from "./core/errors.js";
import { listGeographies, resolveGeography } from "./core/geography.js";
import { queryData } from "./core/query.js";
import { searchGroups, searchVariables } from "./core/variables.js";
import { LocateError, locate } from "./profile/locate.js";
import {
  DEFAULT_RADIUS_MILES,
  MAX_RADIUS_MILES,
  ProfileInputError,
  SECTION_IDS,
  buildProfile,
} from "./profile/profile.js";
import { defaultProfileRuntime, type ProfileRuntime } from "./profile/runtime.js";
import { DataMissingError } from "./profile/store.js";

export interface ToolDeps {
  client: CensusClient;
  /** Called once per tool call. Carries no arguments, by design. */
  log?: (entry: { tool: string; ms: number; ok: boolean }) => void;
  /** Data store and geocoder for profile_place. Defaults to the process-wide one. */
  profile?: ProfileRuntime;
}

/** A failure whose message is safe and useful to show as it is. */
class ToolError extends Error {}

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const RECENT_VINTAGES = 10;

function ok(note: string, data: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: note },
      { type: "text", text: JSON.stringify(data) },
    ],
  };
}

const dataset = z
  .string()
  .min(1)
  .describe("Dataset ID from discover_datasets (e.g., 'acs/acs5').");
const vintage = z
  .number()
  .int()
  .optional()
  .describe(
    "Year/vintage from discover_datasets (e.g., 2024). Omit for datasets whose ID starts with 'timeseries/'."
  );

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { client } = deps;

  /** Times the call, logs it, and turns any failure into a readable result. */
  function guarded<A>(tool: string, handler: (args: A) => Promise<ToolResult> | ToolResult) {
    return async (args: A): Promise<ToolResult> => {
      const started = Date.now();
      let result: ToolResult;
      try {
        result = await handler(args);
      } catch (e) {
        const message =
          e instanceof CensusError || e instanceof ToolError
            ? e.message
            : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
        result = { isError: true, content: [{ type: "text", text: client.redact(message) }] };
      }
      deps.log?.({ tool, ms: Date.now() - started, ok: !result.isError });
      return result;
    };
  }

  const readOnly = { readOnlyHint: true, idempotentHint: true };
  const bundled = { ...readOnly, openWorldHint: false };
  const live = { ...readOnly, openWorldHint: true };

  server.registerTool(
    "discover_datasets",
    {
      title: "Find Census datasets",
      description:
        "Start here. Search the Census Bureau dataset catalog by topic (e.g., 'income', 'population', 'business'). Returns dataset IDs and available years. Use the dataset ID and a vintage year in subsequent tool calls. Datasets marked timeseries take no vintage; pick years with a 'time' predicate in query_data. Common datasets: acs/acs5 for demographics, cbp for business patterns, cps/basic for employment.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Topic to search for (e.g., 'income', 'population', 'business', 'housing')."),
      },
      annotations: bundled,
    },
    guarded("discover_datasets", (args: { query: string }) => {
      const results = searchDatasets(args.query).map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description,
        timeseries: d.timeseries,
        vintages: d.vintages.slice(-RECENT_VINTAGES),
        vintage_count: d.vintages.length,
      }));
      return ok(
        results.length === 0
          ? "No datasets found. Try broader terms like 'demographics', 'economy', 'housing'."
          : `Found ${results.length} dataset(s).`,
        results
      );
    })
  );

  server.registerTool(
    "list_geographies",
    {
      title: "List geography levels",
      description:
        "After choosing a dataset, call this to see what geographic levels are available (state, county, tract, etc.). The 'requires' field shows what parent geography must be specified. For example, county requires state. Use the output to decide what 'for' and 'in' parameters to pass to query_data.",
      inputSchema: { dataset, vintage },
      annotations: live,
    },
    guarded("list_geographies", async (args: { dataset: string; vintage?: number }) => {
      const levels = await listGeographies(client, args.dataset, args.vintage);
      return ok(
        levels.length === 0
          ? "No geography information found. Check that the dataset and vintage are correct."
          : `Found ${levels.length} geography level(s).`,
        levels
      );
    })
  );

  server.registerTool(
    "search_variables",
    {
      title: "Search variables",
      description:
        "Search for specific variables (data columns) within a dataset by keyword. For example, search 'median household income' in acs/acs5. Returns variable codes like B19013_001E that you pass to query_data's 'get' parameter. Tip: also try search_groups to find pre-built tables of related variables.",
      inputSchema: {
        dataset,
        vintage,
        query: z
          .string()
          .min(1)
          .describe(
            "Keywords to search variable codes, labels and concepts (e.g., 'median household income', 'population', 'rent')."
          ),
      },
      annotations: live,
    },
    guarded(
      "search_variables",
      async (args: { dataset: string; vintage?: number; query: string }) => {
        const results = await searchVariables(client, args.dataset, args.vintage, args.query);
        return ok(
          results.length === 0
            ? "No variables found. Try different keywords or check the dataset/vintage."
            : `Found ${results.length} variable(s).`,
          results
        );
      }
    )
  );

  server.registerTool(
    "search_groups",
    {
      title: "Search table groups",
      description:
        "Search for table groups — pre-built collections of related variables (e.g., 'B01001 = Sex by Age'). Often easier than searching individual variables. After finding a group, use search_variables to see its individual variables, or pass specific variable codes to query_data.",
      inputSchema: {
        dataset,
        vintage,
        query: z
          .string()
          .min(1)
          .describe(
            "Keywords to search group/table names and descriptions (e.g., 'sex by age', 'poverty')."
          ),
      },
      annotations: live,
    },
    guarded(
      "search_groups",
      async (args: { dataset: string; vintage?: number; query: string }) => {
        const results = await searchGroups(client, args.dataset, args.vintage, args.query);
        return ok(
          results.length === 0
            ? "No table groups found. Not all datasets have groups. Try search_variables instead."
            : `Found ${results.length} group(s).`,
          results
        );
      }
    )
  );

  server.registerTool(
    "resolve_geography",
    {
      title: "Resolve place name",
      description:
        "Convert a place name like 'California', 'Cook County' or 'Cook County, IL' to Census FIPS codes. Returns ready-to-use 'for' and 'in' clauses for query_data. Only covers states and counties. For tracts, block groups, or places, pass FIPS codes directly to query_data (use list_geographies to see what's available).",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("Place name to look up (e.g., 'California', 'Cook County, IL', 'TX')."),
        level: z
          .enum(["state", "county"])
          .optional()
          .describe("Limit search to a specific level. Omit to search both states and counties."),
      },
      annotations: bundled,
    },
    guarded("resolve_geography", (args: { name: string; level?: "state" | "county" }) => {
      const results = resolveGeography(args.name, args.level);
      return ok(
        results.length === 0
          ? "No matching state or county found. Try a different name, or pass FIPS codes directly to query_data."
          : `Found ${results.length} match(es).`,
        results
      );
    })
  );

  server.registerTool(
    "query_data",
    {
      title: "Query Census data",
      description:
        "Fetch data from the Census API. Requires a dataset ID (and vintage, unless the dataset is timeseries) from discover_datasets, variable codes from search_variables, and geography from resolve_geography or list_geographies. Example: query_data({ dataset: 'acs/acs5', vintage: 2024, get: ['NAME', 'B19013_001E'], for: 'county:*', in: 'state:17' }) returns median household income for all counties in Illinois. For timeseries datasets omit vintage and pass a time predicate, e.g. predicates: { time: '2022' }. Returns at most 'limit' rows (default 500).",
      inputSchema: {
        dataset,
        vintage,
        get: z
          .array(z.string())
          .min(1)
          .describe(
            "Variable codes to retrieve (from search_variables), at most 50. Always include 'NAME' for human-readable geography labels."
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
          .describe(
            "Additional filter predicates as key-value pairs (e.g., { time: '2022' } for timeseries datasets)."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe("Maximum rows to return. Default 500, max 5000."),
      },
      annotations: live,
    },
    guarded(
      "query_data",
      async (args: {
        dataset: string;
        vintage?: number;
        get: string[];
        for: string;
        in?: string;
        predicates?: Record<string, string>;
        limit?: number;
      }) => {
        const r = await queryData(client, args);
        let note: string;
        if (r.total === 0) {
          note = "No results. Check your variable codes, geography, and dataset/vintage.";
        } else if (r.truncated) {
          note = `Returned ${r.rows.length} of ${r.total} row(s). Pass a higher limit (max 5000) or narrow the geography.`;
        } else {
          note = `Returned ${r.rows.length} row(s).`;
        }
        if (r.nullsReplaced > 0) {
          note += ` ${r.nullsReplaced} value(s) were Census "not available" codes and are shown as null.`;
        }
        return ok(note, r.rows);
      }
    )
  );

  const profileRuntime = deps.profile ?? defaultProfileRuntime();

  server.registerTool(
    "profile_place",
    {
      title: "Profile a place",
      description:
        "Who lives near a place. Give a street address, a 5-digit ZIP, a place like 'Seattle, WA', or coordinates like '47.61, -122.33'. Returns a profile of the people living within radius_miles (default 1) of that point: age, income and poverty, work, race and origins, households and children, older adults, school, benefit programs (SNAP, Medicaid, SSI and others), housing, and a 'gaps' list comparing need with benefit receipt. Each figure has a count, a share, a margin of error and a reliability label, and is set beside the county, state and US, with a flag when the area differs from its county by more than chance. Use this first for any 'who lives here' or 'what is this neighbourhood like' question; do not assemble it from query_data. Figures are American Community Survey 5-year estimates. Each section lists its source table IDs, which query_data can use for more detail. A ZIP or place name is treated as its centre point plus the radius, not its whole area.",
      inputSchema: {
        location: z
          .preprocess(
            // A ZIP sometimes arrives as a number, which drops a leading zero.
            (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? String(v).padStart(5, "0") : v),
            z.string().trim().min(1).max(200)
          )
          .describe(
            "A street address ('400 Broad St, Seattle, WA'), a 5-digit ZIP, a place with its state ('Austin, TX'), or 'latitude, longitude'."
          ),
        radius_miles: z
          .number()
          .min(0)
          .max(MAX_RADIUS_MILES)
          .optional()
          .describe(
            `Distance around the point to include, in miles. Default ${DEFAULT_RADIUS_MILES}, max ${MAX_RADIUS_MILES}. Use 0 for the single census tract at the point.`
          ),
        sections: z
          .array(z.enum(SECTION_IDS as [string, ...string[]]))
          .optional()
          .describe(`Sections to return. Default is all: ${SECTION_IDS.join(", ")}.`),
      },
      annotations: live,
    },
    guarded(
      "profile_place",
      async (args: { location: string; radius_miles?: number; sections?: string[] }) => {
        if (!profileRuntime.admit()) throw new ToolError(BUSY_MESSAGE);
        try {
          const store = await profileRuntime.store();
          const located = await locate(args.location, { store, geocoder: profileRuntime.geocoder });
          const profile = await buildProfile(located, store, {
            radiusMiles: args.radius_miles,
            sections: args.sections,
          });
          const { area } = profile;
          const where =
            area.radius_miles > 0
              ? `the area within ${area.covered_miles} mile${area.covered_miles === 1 ? "" : "s"} of ${located.label}`
              : `the census tract at ${located.label}`;
          const people =
            area.population === null ? "no figures" : `${area.population.toLocaleString("en-US")} people`;
          return ok(
            `Profile of ${where}: ${area.tracts} census tract${area.tracts === 1 ? "" : "s"}, ${people}. Shares are fractions (0.25 = 25%). Read the notes before drawing conclusions.`,
            profile
          );
        } catch (e) {
          // Fixed or input-free messages only: the location may be a home address.
          if (e instanceof DataMissingError) {
            throw new ToolError(
              "The profile data has not been built on this server. Run: npm run build && npm run build:acs"
            );
          }
          if (e instanceof LocateError || e instanceof ProfileInputError) throw new ToolError(e.message);
          throw new ToolError("The profile could not be built because of an internal error.");
        }
      }
    )
  );
}
