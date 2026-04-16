#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  listVariablesTool,
  queryDataSchema,
  queryDataTool,
  searchIndustriesSchema,
  searchIndustriesTool,
  searchProductsSchema,
  searchProductsTool,
} from "./tools.js";

const server = new McpServer({
  name: "census-ecnnapcsprd",
  version: "0.1.0",
});

server.tool(
  "search_industries",
  "Search NAICS 2022 industry codes by keyword (case-insensitive substring match against industry labels).",
  searchIndustriesSchema,
  searchIndustriesTool
);

server.tool(
  "search_products",
  "Search NAPCS 2022 product/service codes by keyword (case-insensitive substring match).",
  searchProductsSchema,
  searchProductsTool
);

server.tool(
  "query_data",
  "Query the 2022 Economic Census Products by Industry (ecnnapcsprd) dataset. Filter by NAICS industry code, NAPCS product code, and tax status. Returns establishment counts, revenue, and industry contribution percentages at the U.S. level.",
  queryDataSchema,
  queryDataTool
);

server.tool(
  "list_variables",
  "List all variables available in the ecnnapcsprd dataset with their labels and concepts.",
  {},
  listVariablesTool
);

const transport = new StdioServerTransport();
await server.connect(transport);
