# Census Economic Census (ecnnapcsprd) MCP Server — Design

**Date:** 2026-04-16
**Status:** Approved

## Purpose

Build a local MCP server that wraps the U.S. Census Bureau's 2022 Economic Census Products by Industry dataset (`ecnnapcsprd`), so a user can explore it conversationally through Claude Code.

## Scope

In scope:

- Searching NAICS industry codes and NAPCS product codes by keyword.
- Running parameterized data queries against the `ecnnapcsprd` endpoint.
- Returning variable metadata for discovery.

Out of scope:

- Other Census datasets (ACS, decennial, other economic census tables).
- API key support.
- Caching, persistence, or offline mode.
- Automated test suite beyond manual verification.
- Geographic breakdowns. This dataset is U.S.-total only; all queries hardcode `for=us:*`.

## Target environment

- **Client:** Claude Code (CLI).
- **Transport:** MCP over stdio.
- **Runtime:** Node.js with TypeScript.
- **Execution:** local subprocess launched by Claude Code via `claude mcp add`.

## Architecture

```
Claude Code ──stdio──▶ MCP Server ──HTTPS──▶ api.census.gov
```

A single TypeScript process. No key, no cache, no state. Each MCP tool call translates to at most one HTTPS call to `api.census.gov`.

### Project layout

```
mcp-census-data/
  package.json
  tsconfig.json
  src/
    index.ts        # MCP server entry, tool registration, stdio transport
    census.ts       # thin HTTPS client for the Census API
    tools.ts        # tool handlers, one function per tool
  README.md         # run/install instructions
```

### Module boundaries

- `census.ts` — knows about the Census API: base URLs, endpoints, JSON reshape. Knows nothing about MCP.
- `tools.ts` — knows about tool inputs/outputs. Calls into `census.ts`. Knows nothing about transport.
- `index.ts` — wires the MCP SDK to stdio, registers tools from `tools.ts`.

This separation keeps each file small and lets any one be understood in isolation.

## Tools

### `search_industries`

Search NAICS 2022 industry codes by keyword.

- **Input:** `{ keyword: string }`
- **Behavior:** fetch `https://api.census.gov/data/2022/ecnnapcsprd/variables/NAICS2022.json`, filter the `values.item` code→label map case-insensitively against `keyword`, return matches.
- **Output:** `Array<{ code: string, label: string }>`

### `search_products`

Search NAPCS 2022 product/service codes by keyword.

- **Input:** `{ keyword: string }`
- **Behavior:** fetch `https://api.census.gov/data/2022/ecnnapcsprd/variables/NAPCS2022.json`, filter the `values.item` code→label map case-insensitively.
- **Output:** `Array<{ code: string, label: string }>`

### `query_data`

Run a data query against `ecnnapcsprd`.

- **Input:**
  - `naics?: string` (default `"00"` — all industries)
  - `napcs?: string` (default `"00"` — all products)
  - `taxstat?: string` (default `"00"` — all)
  - `variables?: string[]` (default: `["NAME", "GEO_ID", "NAPCS2022_LABEL", "NAICS2022_LABEL", "ESTAB", "REVPL", "PCT_TOT_REV_PL_IND"]`)
- **Behavior:** build URL `https://api.census.gov/data/2022/ecnnapcsprd?get=<vars>&for=us:*&NAICS2022=<naics>&NAPCS2022=<napcs>&TAXSTAT=<taxstat>`. Fetch, reshape from `[headers, ...rows]` into `[{col: val, ...}, ...]`.
- **Output:** `Array<Record<string, string>>`

### `list_variables`

Introspect the dataset schema.

- **Input:** none
- **Behavior:** fetch `https://api.census.gov/data/2022/ecnnapcsprd/variables.json`, return the `variables` object trimmed to `{ name, label, concept, predicateType }` per variable.
- **Output:** `Array<{ name, label, concept?, predicateType? }>`

## Data flow example

User: "How much revenue did coffee shops generate from brewed coffee in 2022?"

1. Claude calls `search_products({ keyword: "coffee" })` → server fetches NAPCS metadata, returns matching `{ code, label }` pairs.
2. Claude calls `search_industries({ keyword: "food service" })` → returns NAICS codes.
3. Claude calls `query_data({ naics: "722", napcs: "<selected code>" })` → server hits the data endpoint, reshapes rows, returns.
4. Claude synthesizes a natural-language answer.

## Error handling

- **HTTP 204 (no results):** return `[]` with an informational note in the tool result text. Not an error.
- **Non-2xx:** throw an error containing status code, request URL, and Census's response body (usually a plain-text error message).
- **Network timeout:** 10s default. Throw with a clear timeout message.
- **Malformed JSON response:** throw with the raw body truncated to 500 chars for diagnosis.

Errors propagate as MCP tool-call errors so Claude can see them and adapt.

## Testing strategy

Manual end-to-end testing only, given scope:

1. Start the server and register it with Claude Code.
2. Run each of the Census documentation's example queries through `query_data` and verify row shape.
3. Run `search_industries("retail")` and `search_products("software")` and verify non-empty, relevant results.
4. Run `list_variables` and verify it returns the expected variable set.

No automated test suite. If `census.ts` starts accumulating logic (URL builders, reshape edge cases), revisit and add a small integration test against a stable known query.

## Install and run

```
npm install
npm run build
claude mcp add census-data node /absolute/path/to/dist/index.js
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server SDK.
- `typescript`, `@types/node` — dev-only.
- Node's built-in `fetch` for HTTP. No extra HTTP client dependency.

## Open questions

None at design time. Any ambiguity in Census API response shape will be resolved empirically during implementation.
