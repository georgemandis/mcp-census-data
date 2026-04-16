# Census ecnnapcsprd MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local TypeScript MCP server over stdio that wraps the 2022 Census Economic Census `ecnnapcsprd` dataset, exposing four tools to Claude Code: `search_industries`, `search_products`, `query_data`, `list_variables`.

**Architecture:** Single Node process. `src/census.ts` is a thin fetch-based client against `api.census.gov` (no key, no cache). `src/tools.ts` holds tool handlers that call into `census.ts`. `src/index.ts` registers tools on an MCP server and runs it over stdio.

**Tech Stack:** Node 20+, TypeScript, `@modelcontextprotocol/sdk`, `zod` (for tool input schemas — MCP SDK uses it), built-in `fetch`.

---

## Reference

- Spec: `docs/superpowers/specs/2026-04-16-census-ecnnapcsprd-mcp-design.md`
- Census API docs: https://api.census.gov/data/2022/ecnnapcsprd.html
- Example query: `https://api.census.gov/data/2022/ecnnapcsprd?get=NAME,GEO_ID,NAPCS2022_LABEL,NAPCS2022,NAICS2022_LABEL,ESTAB&for=us:*&TAXSTAT=00&NAICS2022=00`
- Variable metadata (shape to be confirmed empirically in Task 3): `https://api.census.gov/data/2022/ecnnapcsprd/variables/NAICS2022.json`

## File structure

```
mcp-census-data/
  package.json
  tsconfig.json
  .gitignore
  src/
    census.ts       # HTTPS client, URL builders, response reshape
    tools.ts        # tool handlers (one function per tool)
    index.ts        # MCP server entry, tool registration, stdio
  README.md         # install/run instructions for future-you
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mcp-census-data",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "mcp-census-data": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 4: Install dependencies**

Run: `cd /Users/georgemandis/Projects/recurse/2026/mcp-census-data && npm install`
Expected: `node_modules/` populated, no errors. If `@modelcontextprotocol/sdk` resolves to a version less than 1.0, bump to the actual latest published version shown in the npm output.

---

## Task 2: Census client — `list_variables` endpoint

**Files:**
- Create: `src/census.ts`

- [ ] **Step 1: Create `src/census.ts` with a base-fetch helper and one endpoint**

```ts
const BASE = "https://api.census.gov/data/2022/ecnnapcsprd";
const TIMEOUT_MS = 10_000;

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") {
      throw new Error(`Census API timeout after ${TIMEOUT_MS}ms: ${url}`);
    }
    throw e;
  }
  clearTimeout(timer);

  if (res.status === 204) return null;
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Census API ${res.status} for ${url}\n${body.slice(0, 500)}`
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      `Census API returned non-JSON for ${url}:\n${body.slice(0, 500)}`
    );
  }
}

export interface VariableInfo {
  name: string;
  label: string;
  concept?: string;
  predicateType?: string;
}

export async function listVariables(): Promise<VariableInfo[]> {
  const data = (await fetchJson(`${BASE}/variables.json`)) as {
    variables: Record<
      string,
      { label?: string; concept?: string; predicateType?: string }
    >;
  };
  return Object.entries(data.variables).map(([name, v]) => ({
    name,
    label: v.label ?? "",
    concept: v.concept,
    predicateType: v.predicateType,
  }));
}
```

- [ ] **Step 2: Manual sanity check**

Run: `cd /Users/georgemandis/Projects/recurse/2026/mcp-census-data && npx tsc && node -e "import('./dist/census.js').then(m => m.listVariables().then(v => console.log(v.length, v.slice(0,3))))"`
Expected: prints a count (likely 10-20) and the first 3 variable objects with names like `NAME`, `GEO_ID`, `ESTAB`. If this fails, fix before moving on — the base-fetch helper is reused everywhere.

---

## Task 3: Census client — variable value lookup (for search)

**Files:**
- Modify: `src/census.ts`

- [ ] **Step 1: Probe the variable-values endpoint shape**

Run: `curl -s https://api.census.gov/data/2022/ecnnapcsprd/variables/NAICS2022.json | head -c 2000`
Expected: a JSON object. Note the exact path to the code→label map. Most Census variables use `values.item` where `item` is `{ "<code>": "<label>", ... }`. If the structure differs (e.g., `values` is missing or the key is different), adapt the type and code below accordingly before proceeding.

- [ ] **Step 2: Add `fetchValueMap` and two wrappers**

Append to `src/census.ts`:

```ts
async function fetchValueMap(varName: string): Promise<Record<string, string>> {
  const data = (await fetchJson(`${BASE}/variables/${varName}.json`)) as {
    values?: { item?: Record<string, string> };
  };
  return data.values?.item ?? {};
}

export interface CodeLabel {
  code: string;
  label: string;
}

function searchValueMap(
  map: Record<string, string>,
  keyword: string
): CodeLabel[] {
  const kw = keyword.toLowerCase();
  return Object.entries(map)
    .filter(([, label]) => label.toLowerCase().includes(kw))
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function searchIndustries(keyword: string): Promise<CodeLabel[]> {
  const map = await fetchValueMap("NAICS2022");
  return searchValueMap(map, keyword);
}

export async function searchProducts(keyword: string): Promise<CodeLabel[]> {
  const map = await fetchValueMap("NAPCS2022");
  return searchValueMap(map, keyword);
}
```

- [ ] **Step 3: Manual sanity check**

Run: `cd /Users/georgemandis/Projects/recurse/2026/mcp-census-data && npx tsc && node -e "import('./dist/census.js').then(m => m.searchIndustries('retail').then(r => console.log(r.length, r.slice(0,5))))"`
Expected: non-empty array containing entries whose labels mention "retail" (case-insensitive), e.g., NAICS 44 "Retail Trade". If empty, check the endpoint shape from Step 1 again.

---

## Task 4: Census client — `query_data`

**Files:**
- Modify: `src/census.ts`

- [ ] **Step 1: Add `queryData`**

Append to `src/census.ts`:

```ts
export interface QueryDataInput {
  naics?: string;
  napcs?: string;
  taxstat?: string;
  variables?: string[];
}

const DEFAULT_VARIABLES = [
  "NAME",
  "GEO_ID",
  "NAPCS2022_LABEL",
  "NAICS2022_LABEL",
  "ESTAB",
  "REVPL",
  "PCT_TOT_REV_PL_IND",
];

export async function queryData(
  input: QueryDataInput
): Promise<Array<Record<string, string>>> {
  const vars = input.variables?.length ? input.variables : DEFAULT_VARIABLES;
  const params = new URLSearchParams({
    get: vars.join(","),
    for: "us:*",
    NAICS2022: input.naics ?? "00",
    NAPCS2022: input.napcs ?? "00",
    TAXSTAT: input.taxstat ?? "00",
  });
  const url = `${BASE}?${params.toString()}`;
  const data = await fetchJson(url);
  if (data === null) return []; // 204 No Content

  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0])) {
    throw new Error(
      `Unexpected Census response shape for ${url}: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  const [headers, ...rows] = data as string[][];
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}
```

- [ ] **Step 2: Manual sanity check against the documented example**

Run: `cd /Users/georgemandis/Projects/recurse/2026/mcp-census-data && npx tsc && node -e "import('./dist/census.js').then(m => m.queryData({}).then(r => console.log(r.length, r[0])))"`
Expected: a non-empty array; first row is an object with keys including `NAME`, `ESTAB`, `NAPCS2022_LABEL`. If the call 204s or returns `[]`, try `queryData({ naics: '00', napcs: '00' })` explicitly. If still empty, inspect the raw URL in a browser to confirm the API is returning data.

---

## Task 5: Tool handlers

**Files:**
- Create: `src/tools.ts`

- [ ] **Step 1: Create `src/tools.ts` with four handlers**

```ts
import { z } from "zod";
import {
  listVariables,
  queryData,
  searchIndustries,
  searchProducts,
} from "./census.js";

export const searchIndustriesSchema = {
  keyword: z.string().min(1).describe("Keyword to search NAICS 2022 industry labels (case-insensitive substring match)."),
};

export async function searchIndustriesTool(args: { keyword: string }) {
  const results = await searchIndustries(args.keyword);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(results, null, 2),
      },
    ],
  };
}

export const searchProductsSchema = {
  keyword: z.string().min(1).describe("Keyword to search NAPCS 2022 product/service labels (case-insensitive substring match)."),
};

export async function searchProductsTool(args: { keyword: string }) {
  const results = await searchProducts(args.keyword);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(results, null, 2),
      },
    ],
  };
}

export const queryDataSchema = {
  naics: z
    .string()
    .optional()
    .describe('NAICS 2022 industry code. Default "00" = all industries.'),
  napcs: z
    .string()
    .optional()
    .describe('NAPCS 2022 product/service code. Default "00" = all products.'),
  taxstat: z
    .string()
    .optional()
    .describe('Tax status. Default "00" = all (0 = taxable, 2 = tax-exempt).'),
  variables: z
    .array(z.string())
    .optional()
    .describe(
      "Census variables to retrieve. Defaults to: NAME, GEO_ID, NAPCS2022_LABEL, NAICS2022_LABEL, ESTAB, REVPL, PCT_TOT_REV_PL_IND."
    ),
};

export async function queryDataTool(args: {
  naics?: string;
  napcs?: string;
  taxstat?: string;
  variables?: string[];
}) {
  const rows = await queryData(args);
  const note =
    rows.length === 0
      ? "No results for these filters. Try broader NAICS/NAPCS codes or confirm codes with search_industries/search_products."
      : `Returned ${rows.length} row(s).`;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "text" as const, text: JSON.stringify(rows, null, 2) },
    ],
  };
}

export async function listVariablesTool() {
  const vars = await listVariables();
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(vars, null, 2),
      },
    ],
  };
}
```

- [ ] **Step 2: Build check**

Run: `cd /Users/georgemandis/Projects/recurse/2026/mcp-census-data && npx tsc`
Expected: clean build, no type errors.

---

## Task 6: MCP server entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create `src/index.ts`**

```ts
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
  "Query the 2022 Economic Census Products by Industry (ecnnapcsprd) dataset. Filter by NAICS industry code, NAPCS product code, and tax status. Defaults to all (code '00').",
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
```

- [ ] **Step 2: Build and smoke-test by starting the server**

Run: `cd /Users/georgemandis/Projects/recurse/2026/mcp-census-data && npx tsc && node dist/index.js`
Expected: process starts silently (stdio MCP servers don't print to stdout — that's reserved for protocol messages). Stop with Ctrl+C. If it crashes, fix before moving on.

**Note on the SDK API:** `McpServer.tool(name, description, schema, handler)` is the high-level shape in `@modelcontextprotocol/sdk` v1.x. If `npm install` pulled a different major version where the API differs (e.g., `registerTool` or a different argument order), adapt using the `README` that shipped in `node_modules/@modelcontextprotocol/sdk/` — do not guess. The behavior we need: one tool per handler, each with an input schema built from zod, returning `{ content: [...] }`.

---

## Task 7: README and install instructions

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write a minimal README**

```markdown
# mcp-census-data

Local MCP server wrapping the U.S. Census Bureau's 2022 Economic Census
Products by Industry dataset (`ecnnapcsprd`).

## Setup

    npm install
    npm run build

## Register with Claude Code

    claude mcp add census-data node /Users/georgemandis/Projects/recurse/2026/mcp-census-data/dist/index.js

## Tools

- `search_industries(keyword)` — find NAICS 2022 codes by keyword.
- `search_products(keyword)` — find NAPCS 2022 codes by keyword.
- `query_data({ naics?, napcs?, taxstat?, variables? })` — fetch establishment counts, revenue, and industry contribution.
- `list_variables()` — dataset schema.

All queries are U.S.-total only (this dataset has no geographic breakdown).
No API key required.

## Dataset docs

https://api.census.gov/data/2022/ecnnapcsprd.html
```

---

## Task 8: End-to-end manual test

**Files:** none — manual verification only.

- [ ] **Step 1: Register the server with Claude Code**

Run: `claude mcp add census-data node /Users/georgemandis/Projects/recurse/2026/mcp-census-data/dist/index.js`
Expected: success message. Then `claude mcp list` shows `census-data`.

- [ ] **Step 2: In a new Claude Code session, exercise each tool**

Try these prompts in order and confirm each returns sensible data:

1. "Using the census-data MCP, list the available variables on this dataset."
   Expected: 10-20 variables including `ESTAB`, `REVPL`, `NAICS2022`, `NAPCS2022`.

2. "Search for NAICS codes related to 'retail' using census-data."
   Expected: multiple results including code `44` Retail Trade.

3. "Search for NAPCS product codes mentioning 'coffee'."
   Expected: at least one match.

4. "Query the census data with default parameters and show me the first few rows."
   Expected: rows with establishment counts and revenue values.

- [ ] **Step 3: If anything fails, debug and re-build**

Common issues: SDK version drift (see Task 6 note), Census API changing a variable name, the variable-values endpoint shape differing from Task 3 assumption. Fix at the source in `census.ts` — the rest of the stack shouldn't need changes.

---

## Done criteria

- All four tools callable from Claude Code and return real Census data.
- `dist/index.js` runs cleanly under `node`.
- No hardcoded API key (there isn't one to hardcode), no cache files, no extra tools beyond the four listed.
