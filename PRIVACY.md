# Privacy

This describes what the Census data MCP server does with what you send it,
whether you run it yourself or use a hosted copy.

## What it collects

Nothing about you. There are no accounts, no sign-in and no cookies.

## What it logs

One line per tool call: the tool's name, how long it took, and whether it
succeeded. Tool arguments (the dataset, variables, places, addresses and
search words you ask about) are not logged and not stored.

## Where your requests go

Search and data requests are forwarded to the U.S. Census Bureau's public API
at `api.census.gov`, using the API key of whoever operates the server. The
Census Bureau sees the query and the operator's key, not who you are. Its own
policies apply to that request: <https://www.census.gov/about/policies/privacy.html>.

`discover_datasets` and `resolve_geography` are answered from files bundled
with the server and are not sent anywhere.

## Addresses

If you give `profile_place` a street address or coordinates, it is sent to
the U.S. Census Bureau's geocoding service at `geocoding.geo.census.gov` to
find where it is. That is the only place it goes. The server does not log
it, does not keep it after answering, and does not include it in error
messages. No API key is sent with it.

A ZIP code or a place name is looked up in files on the server, with no
outside request. The profile itself is computed from published statistics
held on the server; nothing about the request is sent to the Census API.

## What it keeps

Responses from the Census Bureau are held in memory for up to 24 hours so
repeat questions are fast. This is published statistical data, not
information about the person asking. Address lookups are never held.
Nothing is written to disk, and the cache is lost when the server restarts.

## Contact

Questions and reports: <https://github.com/georgemandis/mcp-census-data/issues>
