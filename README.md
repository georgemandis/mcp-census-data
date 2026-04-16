# mcp-census-data

Local MCP server wrapping the U.S. Census Bureau's 2022 Economic Census
Products by Industry dataset (`ecnnapcsprd`).

## Prerequisites

- Node.js 20+ (see `.nvmrc`; uses top-level `await` and built-in `fetch`)

## Setup

```
nvm use          # optional, if using nvm
npm install
npm run build
```

## Register with Claude Code

```
claude mcp add census-data node /Users/georgemandis/Projects/recurse/2026/mcp-census-data/dist/index.js
```

Then start a **new** Claude Code session to pick up the server.

## Tools

### `search_industries(keyword)`

Search NAICS 2022 industry codes by keyword (case-insensitive substring match).

```
"Search for industries related to retail"
```

### `search_products(keyword)`

Search NAPCS 2022 product/service codes by keyword.

```
"Find product codes mentioning software"
```

### `query_data({ naics?, napcs?, taxstat?, variables? })`

Query the dataset. Filter by NAICS industry code, NAPCS product code, and/or
tax status. Returns establishment counts, revenue (`NAPCSDOL`), and industry
contribution percentages (`NAICSALL_PCT`) at the U.S. level.

- `naics` — NAICS 2022 code (omit for all industries; use `search_industries` to find codes)
- `napcs` — NAPCS 2022 code (omit for all products; use `search_products` to find codes)
- `taxstat` — `"0"` taxable, `"2"` tax-exempt (omit for all)
- `variables` — array of variable names to return (defaults to `GEO_ID`, `NAPCS2022_LABEL`, `NAICS2022_LABEL`, `ESTAB`, `NAPCSDOL`, `NAICSALL_PCT`)

```
"Query census data for the food services industry (NAICS 722)"
```

### `list_variables()`

List all variables available in the dataset with labels and concepts. Useful for
discovering what fields you can request in `query_data`.

## Notes

- All queries are U.S.-total only (this dataset has no geographic breakdown).
- No API key required (the Census API allows unauthenticated access with light rate limits).
- The server runs over stdio and is launched as a subprocess by Claude Code.

## Dataset docs

https://api.census.gov/data/2022/ecnnapcsprd.html
