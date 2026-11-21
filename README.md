# mcp-census-data

An MCP server for U.S. Census Bureau data. It answers "who lives near here?"
in one call, and lets Claude find and query any of the 550+ datasets the
Bureau publishes: demographics, income, housing, business, trade, employment
and more.

It runs two ways from the same code: over stdio for local use, and over HTTP
as a hosted connector.

## Tools

All seven are read-only. Claude chains them on its own.

| Tool | What it does |
|---|---|
| `profile_place(location, radius_miles?, sections?)` | Who lives near an address, ZIP, place or coordinates. See below. |
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

## Who lives here: `profile_place`

> Who lives within a mile of 400 Broad St, Seattle?

`profile_place` takes a street address, a 5-digit ZIP, a place such as
"Austin, TX", or "latitude, longitude", and returns a profile of the people
living within `radius_miles` of that point (default 1, maximum 10; 0 means
the single census tract at the point).

- **Sections:** people, income, work, origins, households and children,
  older adults, school, benefits, housing. Pass `sections` to narrow it.
- **Gaps:** five measures of need set against what people receive, such as
  households below the poverty line that do not receive SNAP.
- **Every figure** has a count, a share, a margin of error and a reliability
  label, beside the same figure for the county, state and US. A difference
  from the county is only called "higher" or "lower" when it is beyond the
  margin of error.
- Figures are American Community Survey 5-year estimates (2020-2024),
  combined across the census tracts whose centres fall inside the radius. A
  ZIP or place name is treated as its centre point plus the radius, not its
  whole area. The Census Bureau does not collect religion.

The profile is read from data files built once on your machine, so it uses
none of your API key's quota:

```
npm run build
CENSUS_API_KEY=your-key npm run build:acs
```

This downloads about 2.3 GB of public table files from the Census Bureau,
keeps what the profile needs, and writes about 72 MB of Parquet files to
`data/acs/`. It takes a few minutes and needs the `unzip` command. The key is
used for one table that the Bureau's download server does not serve; the rest
need no key. Until the data is built, `profile_place` says so and the other
tools work as usual.

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

The image carries whatever is in `data/acs/` when it is built, so run
`npm run build:acs` first if you want `profile_place` in it. Without the
data the image still works; `profile_place` says the data has not been built.

## Deploying to Fly.io

`fly.toml` describes one small machine (512 MB) that sleeps when idle and
wakes on the next request.

```
fly apps create your-app-name            # then set app = "your-app-name" in fly.toml
fly secrets set CENSUS_API_KEY=your-key  # the key is never put in a file
npm run deploy
```

`npm run deploy` builds, checks that the profile data is complete, and runs
`fly deploy`. It refuses to deploy if the data has not been built.

Limits that protect a public address: the Fly proxy allows 40 requests at a
time; `profile_place` answers "at its request limit" beyond 120 calls a
minute; requests to the Census API are capped at 120 a minute.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `CENSUS_API_KEY` | none | Required for `query_data`. |
| `PORT` | `8787` | HTTP port. |
| `PROFILE_MAX_PER_MINUTE` | `120` | Ceiling on `profile_place` calls per minute. |
| `CENSUS_DATA_DIR` | `data/acs` | Where `profile_place` reads its data: a directory, or an `https://` address serving the same files. |
| `CENSUS_MAX_REQUESTS_PER_MINUTE` | `120` | Ceiling on requests to the Census API, to protect the key. Cached answers do not count. |

## Development

```
npm test                 # unit tests; the network is mocked
CENSUS_API_KEY=... npm test   # also runs the live smoke test
npm run build:catalog    # refresh data/catalog.json from the Census API
CENSUS_API_KEY=... npm run build:geo   # refresh data/counties.json
CENSUS_API_KEY=... npm run build:acs   # build the profile data into data/acs
npm run check:profile    # refresh data/acs-labels.json after editing the profile
```

What a profile contains is defined as data in `src/profile/definition.ts`.
`data/acs-labels.json` holds the Census Bureau's own label for every table
cell it uses, so each line can be checked against its source.

The catalog is generated. Hand-written titles and descriptions for the most
useful datasets live in `data/curated-descriptions.json`, in priority order,
and are merged over the Bureau's own.

## Privacy

Tool arguments are not logged or stored. A street address given to
`profile_place` is sent to the Census Bureau's geocoder and nowhere else. See
[PRIVACY.md](PRIVACY.md).

## Licence

MIT. See [LICENSE](LICENSE). Census data is in the public domain. This
product uses the Census Bureau Data API but is not endorsed or certified by
the Census Bureau.
