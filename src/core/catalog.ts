import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rank } from "./search.js";
import { DATA_DIR } from "./version.js";

export interface DatasetEntry {
  id: string;
  title: string;
  description: string;
  /** Years available, ascending. Empty for timeseries datasets. */
  vintages: number[];
  /** Timeseries datasets take no vintage; years are chosen with a `time` predicate. */
  timeseries: boolean;
  /** True when the title and description were written by hand for this project. */
  curated: boolean;
}

// Large enough that a hand-picked dataset matched on its description beats an
// obscure one matched on its title, small enough that an exact id still wins.
const CURATED_BOOST = 25;
const DEFAULT_LIMIT = 20;

let catalog: DatasetEntry[] | undefined;

function entries(): DatasetEntry[] {
  if (!catalog) {
    const file = join(DATA_DIR, "catalog.json");
    catalog = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  }
  return catalog!;
}

/** Replaces the catalog. For tests. */
export function loadCatalog(next: DatasetEntry[]): void {
  catalog = next;
}

export function searchDatasets(query: string, limit = DEFAULT_LIMIT): DatasetEntry[] {
  // The catalog lists hand-picked datasets first, most useful first, so ties
  // keep that order instead of favouring whichever has the shortest blurb.
  return rank(
    entries(),
    query,
    (d) => ({
      id: d.id,
      primary: d.title,
      secondary: d.description,
      boost: d.curated ? CURATED_BOOST : 0,
    }),
    { preferShorter: false }
  ).slice(0, limit);
}

export function getDataset(id: string): DatasetEntry | undefined {
  const wanted = id.trim().toLowerCase();
  return entries().find((d) => d.id === wanted);
}
