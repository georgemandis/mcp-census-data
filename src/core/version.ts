import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// src/core and dist/core sit at the same depth, so this resolves from both.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DATA_DIR = join(ROOT, "data");

export const VERSION: string = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8")
).version;
