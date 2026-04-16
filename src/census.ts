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

export interface QueryDataInput {
  naics?: string;
  napcs?: string;
  taxstat?: string;
  variables?: string[];
}

const DEFAULT_VARIABLES = [
  "GEO_ID",
  "NAPCS2022_LABEL",
  "NAICS2022_LABEL",
  "ESTAB",
  "NAPCSDOL",
  "NAICSALL_PCT",
];

export async function queryData(
  input: QueryDataInput
): Promise<Array<Record<string, string>>> {
  const vars = input.variables?.length ? input.variables : DEFAULT_VARIABLES;
  const params = new URLSearchParams({
    get: vars.join(","),
    for: "us:*",
  });
  // Only add filter params when explicitly provided; omitting them returns all rows
  if (input.naics !== undefined) params.set("NAICS2022", input.naics);
  if (input.napcs !== undefined) params.set("NAPCS2022", input.napcs);
  if (input.taxstat !== undefined) params.set("TAXSTAT", input.taxstat);
  const url = `${BASE}?${params.toString()}`;
  const data = await fetchJson(url);
  if (data === null) return [];

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
