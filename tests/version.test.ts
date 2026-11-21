import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, VERSION } from "../src/core/version.js";

test("version comes from package.json", () => expect(VERSION).toBe("0.3.0"));
test("data dir resolves", () =>
  expect(existsSync(join(DATA_DIR, "states.json"))).toBe(true));
