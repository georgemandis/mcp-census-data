#!/usr/bin/env node
/**
 * Regenerates data/catalog.json from the live Census catalog, laying the
 * hand-written titles and descriptions in data/curated-descriptions.json
 * over the Bureau's own. Needs no API key.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DatasetEntry } from "../core/catalog.js";
import { DATA_DIR } from "../core/version.js";

export interface RawDataset {
  c_dataset: string[];
  c_vintage?: number;
  c_isAvailable?: boolean;
  title?: string;
  description?: string;
}

export type CuratedText = Record<string, { title: string; description: string }>;

export function buildCatalog(raw: RawDataset[], curated: CuratedText): DatasetEntry[] {
  const byId = new Map<string, { entry: DatasetEntry; newest: number }>();

  for (const r of raw) {
    if (r.c_isAvailable === false) continue;
    const id = r.c_dataset.join("/");
    const vintage = r.c_vintage;
    let slot = byId.get(id);
    if (!slot) {
      slot = {
        entry: {
          id,
          title: "",
          description: "",
          vintages: [],
          timeseries: id.startsWith("timeseries/"),
          curated: false,
        },
        newest: -Infinity,
      };
      byId.set(id, slot);
    }
    if (vintage !== undefined && !slot.entry.vintages.includes(vintage)) {
      slot.entry.vintages.push(vintage);
    }
    // The newest vintage's wording describes the dataset as it is today.
    const age = vintage ?? 0;
    if (age > slot.newest) {
      slot.newest = age;
      slot.entry.title = r.title ?? id;
      slot.entry.description = r.description ?? "";
    }
  }

  return [...byId.values()]
    .map(({ entry }) => {
      entry.vintages.sort((a, b) => a - b);
      const text = curated[entry.id];
      return text
        ? { ...entry, title: text.title, description: text.description, curated: true }
        : entry;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function main(): Promise<void> {
  const curated: CuratedText = JSON.parse(
    readFileSync(join(DATA_DIR, "curated-descriptions.json"), "utf8")
  );
  const res = await fetch("https://api.census.gov/data.json");
  if (!res.ok) throw new Error(`Census catalog request failed: ${res.status}`);
  const { dataset } = (await res.json()) as { dataset: RawDataset[] };

  const catalog = buildCatalog(dataset, curated);
  writeFileSync(join(DATA_DIR, "catalog.json"), JSON.stringify(catalog, null, 1) + "\n");

  const found = new Set(catalog.filter((d) => d.curated).map((d) => d.id));
  const missing = Object.keys(curated).filter((id) => !found.has(id));
  console.log(`Wrote ${catalog.length} datasets, ${found.size} with hand-written descriptions.`);
  if (missing.length > 0) {
    console.error(`No longer in the Census catalog: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
