# mcp-census-data

An MCP server for U.S. Census Bureau data. It answers "who lives near here?"
in one call, sets it against what is around there, and lets Claude find and
query any of the 550+ datasets the Bureau publishes: demographics, income, housing, business, trade, employment
and more.

It runs two ways from the same code: over stdio for local use, and over HTTP
as a hosted connector.

## Tools

All eight are read-only. Claude chains them on its own.

| Tool | What it does |
|---|---|
| `profile_place(location, radius_miles?, sections?)` | Who lives near an address, ZIP, place or coordinates. See below. |
| `nearby_places(location, types?, radius_miles?, per?)` | What is around a place, as rates beside the county, state and US. See below. |
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

It covers the states, DC and Puerto Rico. The American Community Survey does
not cover Guam, the U.S. Virgin Islands, American Samoa or the Northern
Mariana Islands, so there `profile_place` says so, and `nearby_places` gives
counts for the tract at the point without rates.

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

## What's around here: `nearby_places`

> There are a lot of children near ZIP 98118. How many libraries and tutors
> are there for them, compared with the rest of the county?

`nearby_places` counts places of any type in the same area `profile_place`
describes and gives each count as a rate, so it means something:

```
libraries, within 1 mile of ZIP 98101 (22 tracts, 83,843 people)
  here:    8     0.95 per 10,000 residents
  county:  127   0.56 per 10,000
  US:            0.71 per 10,000
  about 1.7 times the county rate
  nearest: Seattle Public Library (0.34 mi), ...
```

- **`types`:** up to five, in ordinary words ("grocery stores", "tutors",
  "food banks", "churches"). Each resolves to one type in the source's type
  tree and everything beneath it. If the words are unclear, nothing is
  counted and candidate types come back to choose from.
- **No `types`:** an overview of the broad types that are most over- and
  under-represented here compared with the county.
- **`per`:** rate against residents (the default), `households`,
  `children`, `older_adults`, `snap_households` or `people_below_poverty`.
- **Types are only counted when it is clear which is meant.** "Auto repair"
  could be several types, so it returns candidates to choose from and counts
  nothing.
- **Small numbers are not compared.** Below five places, found or expected,
  the answer is "too few to compare"; a wider radius usually helps. A ratio
  is given only when the county's own figure is large enough and the
  difference is more than chance would often produce.
- **The county is the one the point is in.** When much of the area lies
  outside it, or the area is most of it, the answer says so.

Counts are approximate. The places come from
[Overture Maps](https://overturemaps.org), a merged open dataset: types are
sometimes wrong and coverage varies, so a lower rate than the county can mean
fewer places or less complete mapping. Only places Overture marks open with
high confidence are counted. In Puerto Rico and the other territories Overture
records no open or closed status, so places there are counted on confidence
alone and coverage is thinner; the answer says so.

The data is built once on your machine and needs no key:

```
npm run build
npm run build:places
```

This reads the pinned Overture release from its public bucket, assigns each
of about 12 million US places to its census tract, and writes about 330 MB
to `data/places/`. It takes about five minutes and needs the `unzip` command.

### SNAP retailers

> Where can people near 98118 spend SNAP benefits?

Ask for "SNAP stores" (or "EBT", "food stamps") and the answer comes from
USDA's list of stores currently authorised to take SNAP, not from Overture:
full-line food stores (supermarkets, super stores and grocery stores) first,
then all SNAP retailers, then the count for each USDA store type, with the
nearest full-line stores by name. These counts are exact for the date of
USDA's list. They are rated per 1,000 households on SNAP unless `per` asks
for another group. Answers about grocery stores or supermarkets also carry
USDA's full-line count beside Overture's, under `official`.

Puerto Rico, American Samoa and the Northern Mariana Islands run their own
nutrition assistance programs in place of SNAP, so there the answer says so
in place of a count. Guam and the Virgin Islands are in SNAP.

The list is built separately, so it can be refreshed as often as USDA
updates it (roughly monthly), and needs no key:

```
npm run build
npm run build:snap
```

It downloads USDA's list (about 35 MB), assigns each retailer to its census
tract, and writes to `data/snap/`. It needs the `unzip` command.

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

The image carries whatever is in `data/acs/` and `data/places/` when it is
built, so run `npm run build:acs` and `npm run build:places` first if you
want `profile_place` and `nearby_places` in it. Without the data the image
still works; those tools say the data has not been built.

## Deploying to Fly.io

`fly.toml` describes one small machine (512 MB) that sleeps when idle and
wakes on the next request.

```
fly apps create your-app-name            # then set app = "your-app-name" in fly.toml
fly secrets set CENSUS_API_KEY=your-key  # the key is never put in a file
npm run deploy
```

`npm run deploy` builds, checks that the profile and places data are
complete, and runs `fly deploy`. It refuses to deploy if either is missing.

The machine is suspended after a few idle minutes. Waking it adds about 0.7
seconds to the next request (measured 2026-11-21), and because it is
suspended, not stopped, the cache and the open data survive the sleep.

Limits that protect a public address: the Fly proxy allows 40 requests at a
time; `profile_place` and `nearby_places` together answer "at its request limit"
beyond 120 calls a minute; requests to the Census API are capped at 120 a minute.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `CENSUS_API_KEY` | none | Required for `query_data`. |
| `PORT` | `8787` | HTTP port. |
| `PROFILE_MAX_PER_MINUTE` | `120` | Ceiling on `profile_place` and `nearby_places` calls per minute, together. |
| `CENSUS_PLACES_DIR` | `data/places` | Where `nearby_places` reads its data. |
| `CENSUS_SNAP_DIR` | `data/snap` | Where `nearby_places` reads USDA's SNAP retailers. |
| `CENSUS_DATA_DIR` | `data/acs` | Where `profile_place` reads its data: a directory, or an `https://` address serving the same files. |
| `CENSUS_MAX_REQUESTS_PER_MINUTE` | `120` | Ceiling on requests to the Census API, to protect the key. Cached answers do not count. |

## Development

```
npm test                 # unit tests; the network is mocked
CENSUS_API_KEY=... npm test   # also runs the live smoke test
npm run build:catalog    # refresh data/catalog.json from the Census API
CENSUS_API_KEY=... npm run build:geo   # refresh data/counties.json
CENSUS_API_KEY=... npm run build:acs   # build the profile data into data/acs
npm run build:places     # build the places data into data/places
npm run build:snap       # build USDA's SNAP retailers into data/snap
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

MIT. See [LICENSE](LICENSE). Census data is in the public domain.

Places data: Overture Maps Foundation, [overturemaps.org](https://overturemaps.org),
release 2026-11-18.0, Places theme. It combines data from Meta, Microsoft,
BrightQuery, Uberall, DAC, PinMeTo, Birdeye, OpenTravel Alliance and RenderSEO
(each available under [CDLA Permissive 2.0](https://cdla.dev/permissive-2-0/));
from Foursquare (Copyright 2024 Foursquare Labs, Inc. All rights reserved.
Available under Apache 2.0. Foursquare data was transformed to the Overture
schema. [NOTICE](https://opensource.foursquare.com/places-notice-txt/)); and
from AllThePlaces (available under CC0 1.0). This project filters that data
and assigns each place to a census tract.

SNAP retailer data: U.S. Department of Agriculture, Food and Nutrition
Service, SNAP Retailer Locator data. It states no licence; as a work of the
U.S. government it is treated as public domain, and credited with its date in
every answer that uses it. This
product uses the Census Bureau Data API but is not endorsed or certified by
the Census Bureau.
