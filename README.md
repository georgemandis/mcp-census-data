# mcp-census-data

An MCP server for the U.S. Census Bureau API. It lets Claude find and query
any of the 550+ datasets the Bureau publishes: demographics, income, housing,
business, trade, employment and more.

It runs two ways from the same code: over stdio for local use, and over HTTP
as a hosted connector.

## Tools

All six are read-only. Claude chains them on its own.

| Tool | What it does |
|---|---|
| `discover_datasets(query)` | Search the dataset catalog by topic. Start here. |
| `list_geographies(dataset, vintage?)` | Geographic levels a dataset offers (state, county, tract and so on). |
| `search_variables(dataset, vintage?, query)` | Find variable codes by keyword, such as `B19013_001E`. |
| `search_groups(dataset, vintage?, query)` | Find whole tables, such as `B01001` (Sex by Age). |
| `resolve_geography(name, level?)` | Turn "California" or "Cook County, IL" into FIPS codes. States and counties only. |
| `query_data(dataset, vintage?, get, for, in?, predicates?, limit?)` | Fetch the data. |

**Vintage.** Most datasets need a year (`vintage`). Datasets whose id starts
with `timeseries/` do not; for those, leave `vintage` out and choose years
with a `time` predicate, for example `predicates: { time: "2022" }`.

**Limits.** `query_data` returns at most 500 rows unless you pass `limit`
(maximum 5000), and at most 50 variables per call. Census codes meaning "not
available", such as `-666666666`, are returned as `null`.

### Example

> What's the median household income in Cook County, Illinois?

1. `discover_datasets("income")` finds `acs/acs5`
2. `search_variables("acs/acs5", 2024, "median household income")` finds `B19013_001E`
3. `resolve_geography("Cook County, IL")` gives `county:031` in `state:17`
4. `query_data(...)` returns the figure

## API key

Data queries need a Census API key. It is free:
<https://api.census.gov/data/key_signup.html>. Without one, the search and
lookup tools still work and `query_data` explains what is missing.

## Run locally (stdio)

Requires Node.js 22 or later.

```
git clone https://github.com/georgemandis/mcp-census-data.git
cd mcp-census-data
npm install
npm run build
```

Register it with Claude Code, replacing the path with where you cloned it:

```
claude mcp add -e CENSUS_API_KEY=your-key census-data node /path/to/mcp-census-data/dist/stdio.js
```

Start a new Claude Code session to pick it up.

## Run over HTTP

```
CENSUS_API_KEY=your-key npm run start:http
```

The MCP endpoint is `POST /mcp` (Streamable HTTP, stateless, no sign-in).
`GET /health` reports status and version.

With Docker:

```
docker build -t mcp-census-data .
docker run -p 8787:8787 -e CENSUS_API_KEY=your-key mcp-census-data
```

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `CENSUS_API_KEY` | none | Required for `query_data`. |
| `PORT` | `8787` | HTTP port. |
| `CENSUS_MAX_REQUESTS_PER_MINUTE` | `120` | Ceiling on requests to the Census API, to protect the key. Cached answers do not count. |

## Development

```
npm test                 # unit tests; the network is mocked
CENSUS_API_KEY=... npm test   # also runs the live smoke test
npm run build:catalog    # refresh data/catalog.json from the Census API
```

The catalog is generated. Hand-written titles and descriptions for the most
useful datasets live in `data/curated-descriptions.json`, in priority order,
and are merged over the Bureau's own.

## Privacy

Tool arguments are not logged or stored. See [PRIVACY.md](PRIVACY.md).

## Licence

MIT. See [LICENSE](LICENSE). Census data is in the public domain. This
product uses the Census Bureau Data API but is not endorsed or certified by
the Census Bureau.
