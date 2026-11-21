#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  discoverDatasetsSchema,
  discoverDatasetsTool,
  listGeographiesSchema,
  listGeographiesTool,
  searchVariablesSchema,
  searchVariablesTool,
  searchGroupsSchema,
  searchGroupsTool,
  resolveGeographySchema,
  resolveGeographyTool,
  queryDataSchema,
  queryDataTool,
} from "./tools.js";
import { VERSION } from "./core/version.js";

const server = new McpServer({
  name: "census-data",
  version: VERSION,
});

server.tool(
  "discover_datasets",
  "Start here. Search the Census Bureau dataset catalog by topic (e.g., 'income', 'population', 'business'). Returns dataset IDs and available years. Use the dataset ID and a vintage year in subsequent tool calls. Common datasets: acs/acs5 for demographics, cbp for business patterns, cps/basic for employment.",
  discoverDatasetsSchema,
  discoverDatasetsTool
);

server.tool(
  "list_geographies",
  "After choosing a dataset, call this to see what geographic levels are available (state, county, tract, etc.). The 'requires' field shows what parent geography must be specified. For example, county requires state. Use the output to decide what 'for' and 'in' parameters to pass to query_data.",
  listGeographiesSchema,
  listGeographiesTool
);

server.tool(
  "search_variables",
  "Search for specific variables (data columns) within a dataset by keyword. For example, search 'median household income' in acs/acs5. Returns variable codes like B19013_001E that you pass to query_data's 'get' parameter. Tip: also try search_groups to find pre-built tables of related variables.",
  searchVariablesSchema,
  searchVariablesTool
);

server.tool(
  "search_groups",
  "Search for table groups — pre-built collections of related variables (e.g., 'B01001 = Sex by Age'). Often easier than searching individual variables. After finding a group, use search_variables to see its individual variables, or pass specific variable codes to query_data.",
  searchGroupsSchema,
  searchGroupsTool
);

server.tool(
  "resolve_geography",
  "Convert a place name like 'California' or 'Cook County' to Census FIPS codes. Returns ready-to-use 'for' and 'in' clauses for query_data. Only covers states and counties. For tracts, block groups, or places, pass FIPS codes directly to query_data (use list_geographies to see what's available).",
  resolveGeographySchema,
  resolveGeographyTool
);

server.tool(
  "query_data",
  "Fetch data from the Census API. Requires a dataset ID and vintage from discover_datasets, variable codes from search_variables, and geography from resolve_geography or list_geographies. Example: query_data({ dataset: 'acs/acs5', vintage: 2024, get: ['NAME', 'B19013_001E'], for: 'county:*', in: 'state:17' }) returns median household income for all counties in Illinois.",
  queryDataSchema,
  queryDataTool
);

const transport = new StdioServerTransport();
await server.connect(transport);
