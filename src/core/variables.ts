import { fetchCensusJson } from "./client.js";

export interface VariableMatch {
  name: string;
  label: string;
  concept?: string;
  group?: string;
}

const MAX_RESULTS = 50;

export async function searchVariables(
  dataset: string,
  vintage: number,
  query: string
): Promise<VariableMatch[]> {
  const data = (await fetchCensusJson(
    `${vintage}/${dataset}/variables.json`
  )) as {
    variables: Record<
      string,
      { label?: string; concept?: string; group?: string }
    >;
  } | null;

  if (!data?.variables) return [];

  const kw = query.toLowerCase();
  return Object.entries(data.variables)
    .filter(
      ([, v]) =>
        v.label?.toLowerCase().includes(kw) ||
        v.concept?.toLowerCase().includes(kw)
    )
    .map(([name, v]) => ({
      name,
      label: v.label ?? "",
      concept: v.concept,
      group: v.group,
    }))
    .slice(0, MAX_RESULTS);
}

export interface GroupMatch {
  name: string;
  description: string;
}

const MAX_GROUP_RESULTS = 20;

export async function searchGroups(
  dataset: string,
  vintage: number,
  query: string
): Promise<GroupMatch[]> {
  let data: { groups: Array<{ name: string; description: string }> } | null;
  try {
    data = (await fetchCensusJson(
      `${vintage}/${dataset}/groups.json`
    )) as typeof data;
  } catch {
    return [];
  }

  if (!data?.groups) return [];

  const kw = query.toLowerCase();
  return data.groups
    .filter(
      (g) =>
        g.name.toLowerCase().includes(kw) ||
        g.description.toLowerCase().includes(kw)
    )
    .map((g) => ({ name: g.name, description: g.description }))
    .slice(0, MAX_GROUP_RESULTS);
}
