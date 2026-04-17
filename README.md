# mcp-census-data

Local MCP server that can query any of the 1,776+ datasets in the U.S. Census Bureau API. Demographics, income, housing, business, trade, employment, and more — all through natural language via Claude Code.

## Prerequisites

- Node.js 20+ (see `.nvmrc`)

## Setup

```
nvm use          # optional, if using nvm
npm install
npm run build
```

## Register with Claude Code

Basic (no API key, curated catalog):

```
claude mcp add census-data node /Users/georgemandis/Projects/recurse/2026/mcp-census-data/dist/index.js
```

With API key and/or full catalog:

```
claude mcp add -e CENSUS_API_KEY=your-key-here -e CENSUS_CATALOG_MODE=full census-data node /Users/georgemandis/Projects/recurse/2026/mcp-census-data/dist/index.js
```

Then start a **new** Claude Code session to pick up the server.

To switch modes later, remove and re-add: `claude mcp remove census-data` then re-add with different `-e` flags.

## Configuration

| Env var | Default | Effect |
|---|---|---|
| `CENSUS_API_KEY` | none | Appended to all Census API requests. Free at [census.gov/developers](https://api.census.gov/data/key_signup.html). Recommended to avoid rate limits. |
| `CENSUS_CATALOG_MODE` | `curated` | `curated` (~45 hand-picked datasets with rich descriptions) or `full` (~566 datasets with raw Census descriptions). |

Both are passed via `-e` flags on `claude mcp add`.

## Tools

### Discovery chain (call in this order)

1. **`discover_datasets(query)`** — Search for Census datasets by topic ("income", "population", "business"). Start here.
2. **`list_geographies(dataset, vintage)`** — See what geographic levels are available (state, county, tract, etc.).
3. **`search_variables(dataset, vintage, query)`** — Find variable codes by keyword ("median household income").
4. **`search_groups(dataset, vintage, query)`** — Find pre-built table groups ("Sex by Age").
5. **`resolve_geography(name)`** — Convert "California" or "Cook County" to FIPS codes.

### Data retrieval

6. **`query_data(dataset, vintage, get, for, in?, predicates?)`** — Fetch actual data from the Census API.

### Example conversation

> "What's the median household income in Cook County, Illinois?"

Claude chains the tools automatically:
- `discover_datasets("income")` → picks ACS 5-Year
- `search_variables("acs/acs5", 2024, "median household income")` → finds `B19013_001E`
- `resolve_geography("Cook County")` → FIPS codes for Cook County, IL
- `query_data(...)` → returns the answer

## Dataset coverage

The curated catalog covers the most commonly used datasets:
- **ACS** — demographics, income, education, housing, health insurance
- **Decennial Census** — full population count every 10 years
- **Population Estimates** — annual estimates between censuses
- **CPS** — employment, income, voting, food security, internet use
- **County/Zip Business Patterns** — establishments and payroll by industry
- **Economic Census** — detailed business statistics every 5 years
- **International Trade** — imports and exports by commodity
- **Time Series** — poverty, health insurance, business dynamics

Switch to `CENSUS_CATALOG_MODE=full` for access to all ~566 unique endpoints.

See `docs/census-api-inventory.md` for the full inventory.

## Census API docs

https://api.census.gov/data.html
