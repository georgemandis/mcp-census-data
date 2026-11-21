/**
 * Writes data/acs-labels.json: the Census Bureau's own label for every cell
 * the profile definition uses, so each line can be read against its source.
 * Uses table metadata only, which needs no API key.
 *
 *   npm run build && npm run check:profile
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACS_YEAR, cellsUsed, tablesUsed } from "../profile/definition.js";
import { DATA_DIR } from "../core/version.js";

interface GroupResponse {
  variables: Record<string, { label: string }>;
}

async function main(): Promise<void> {
  const labels: Record<string, string> = {};
  const missing: string[] = [];
  for (const table of tablesUsed()) {
    const url = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5/groups/${table}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} from the Census API`);
    const { variables } = (await res.json()) as GroupResponse;
    for (const cell of cellsUsed(table)) {
      const label = variables[`${cell}E`]?.label;
      if (label) labels[cell] = label.replace(/^Estimate!!/, "");
      else missing.push(cell);
    }
    process.stderr.write(`${table}: ${cellsUsed(table).length} cells\n`);
  }
  if (missing.length) {
    process.stderr.write(`Cells not in the ${ACS_YEAR} tables: ${missing.join(", ")}\n`);
    process.exit(1);
  }
  const sorted = Object.fromEntries(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
  const out = join(DATA_DIR, "acs-labels.json");
  writeFileSync(out, JSON.stringify(sorted, null, 1) + "\n");
  process.stderr.write(`Wrote ${Object.keys(sorted).length} labels to ${out}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
