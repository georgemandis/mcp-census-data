import type { CensusClient } from "./client.js";
import { CensusError } from "./errors.js";
import { datasetPath } from "./query.js";
import { rank } from "./search.js";

export interface VariableMatch {
  name: string;
  label: string;
  concept?: string;
  group?: string;
}

export interface GroupMatch {
  name: string;
  description: string;
}

const MAX_VARIABLES = 50;
const MAX_GROUPS = 20;

export async function searchVariables(
  client: CensusClient,
  dataset: string,
  vintage: number | undefined,
  query: string
): Promise<VariableMatch[]> {
  const data = (await client.getJson(
    `${datasetPath(dataset, vintage)}/variables.json`
  )) as {
    variables?: Record<string, { label?: string; concept?: string; group?: string }>;
  } | null;
  if (!data?.variables) return [];

  const all: VariableMatch[] = Object.entries(data.variables).map(([name, v]) => ({
    name,
    label: v.label ?? "",
    concept: v.concept,
    group: v.group,
  }));
  return rank(all, query, (v) => ({
    id: v.name,
    primary: v.label,
    secondary: v.concept,
  })).slice(0, MAX_VARIABLES);
}

export async function searchGroups(
  client: CensusClient,
  dataset: string,
  vintage: number | undefined,
  query: string
): Promise<GroupMatch[]> {
  let data: { groups?: GroupMatch[] } | null;
  try {
    data = (await client.getJson(
      `${datasetPath(dataset, vintage)}/groups.json`
    )) as typeof data;
  } catch (e) {
    // Many datasets simply have no groups; that is an empty answer, not a failure.
    if (e instanceof CensusError && e.status === 404) return [];
    throw e;
  }
  if (!data?.groups) return [];

  return rank(data.groups, query, (g) => ({ id: g.name, primary: g.description }))
    .map((g) => ({ name: g.name, description: g.description }))
    .slice(0, MAX_GROUPS);
}
