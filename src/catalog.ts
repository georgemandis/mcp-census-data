import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, "..", "data");

export interface DatasetEntry {
  id: string;
  title: string;
  description: string;
  vintages: number[];
  endpoint: string;
}

const mode = process.env.CENSUS_CATALOG_MODE ?? "curated";
const catalogFile = mode === "full" ? "full-catalog.json" : "curated-catalog.json";

let catalog: DatasetEntry[];
try {
  catalog = JSON.parse(readFileSync(join(dataDir, catalogFile), "utf8"));
} catch (e) {
  console.error(`[census-mcp] Failed to load catalog ${catalogFile}:`, e);
  catalog = [];
}

const MAX_RESULTS = 20;

export function searchDatasets(query: string): DatasetEntry[] {
  const kw = query.toLowerCase();
  return catalog
    .filter(
      (d) =>
        d.title.toLowerCase().includes(kw) ||
        d.description.toLowerCase().includes(kw) ||
        d.id.toLowerCase().includes(kw)
    )
    .slice(0, MAX_RESULTS);
}
