/**
 * Builds a small places data directory in the layout `npm run build:places`
 * produces, over the same tracts as the profile fixture.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { CENTRE, TRACT } from "./profile-fixture.js";

const MILE_LAT = 1 / 69.05;

export const PATHS = {
  library: "education > library",
  grocery: "shopping > food_and_beverage_store > grocery_store",
  asian: "shopping > food_and_beverage_store > grocery_store > asian_grocery_store",
  restaurant: "eat_and_drink > restaurant",
  elementary: "education > school > elementary_school",
  school: "education > school",
  supply: "shopping > school_supply_store",
  park: "arts_and_entertainment > park",
  mystery: "attractions > mystery_spot",
  foodBank: "community_and_government > social_or_community_service > food_bank",
  fireStation: "community_and_government > fire_station",
} as const;

interface FixturePlace {
  name: string | null;
  path: string;
  basic: string | null;
  tract: string;
  miles: number; // north of the centre
  address?: string | null;
}

const p = (name: string | null, path: string, basic: string | null, tract: string, miles: number, address: string | null = `${Math.round(miles * 1000)} Main St`): FixturePlace =>
  ({ name, path, basic, tract, miles, address });

/** 17 places: 9 in tract A, 5 in B, 2 in C, 1 in D. */
export const PLACES: FixturePlace[] = [
  p("Central Library", PATHS.library, "library", TRACT.A, 0.1),
  p("Corner Grocery", PATHS.grocery, "food_and_beverage_store", TRACT.A, 0.2),
  p("Asia Market", PATHS.asian, "food_and_beverage_store", TRACT.A, 0.25),
  p("Diner One", PATHS.restaurant, "restaurant", TRACT.A, 0.05),
  p("Diner Two", PATHS.restaurant, "restaurant", TRACT.A, 0.15),
  p("Diner Three", PATHS.restaurant, "restaurant", TRACT.A, 0.3),
  p("Pencil Depot", PATHS.supply, "specialty_store", TRACT.A, 0.35),
  p(null, PATHS.park, "park", TRACT.A, 0.4, null),
  p("The Vortex", PATHS.mystery, null, TRACT.A, 0.45),
  p("North Library", PATHS.library, "library", TRACT.B, 0.7),
  p("North Grocery", PATHS.grocery, "food_and_beverage_store", TRACT.B, 0.75),
  p("Diner Four", PATHS.restaurant, "restaurant", TRACT.B, 0.8),
  p("Diner Five", PATHS.restaurant, "restaurant", TRACT.B, 0.85),
  p("Lincoln Elementary", PATHS.elementary, "school", TRACT.B, 0.9),
  p("Far Library", PATHS.library, "library", TRACT.C, 2),
  p("Diner Six", PATHS.restaurant, "restaurant", TRACT.C, 2.1),
  p("Edge Grocery", PATHS.grocery, "food_and_beverage_store", TRACT.D, 6),
];

/** Counts by leaf type for the county, the state and the nation. */
export const COUNTS: [path: string, basic: string | null, county: number, state: number, us: number][] = [
  [PATHS.library, "library", 20, 200, 2000],
  [PATHS.grocery, "food_and_beverage_store", 45, 450, 4500],
  [PATHS.asian, "food_and_beverage_store", 5, 50, 500],
  [PATHS.restaurant, "restaurant", 400, 4000, 40000],
  [PATHS.elementary, "school", 30, 300, 3000],
  [PATHS.supply, "specialty_store", 4, 40, 400],
  [PATHS.park, "park", 60, 600, 6000],
  [PATHS.mystery, null, 1, 10, 100],
  [PATHS.foodBank, "social_or_community_service", 40, 100, 1000],
  [PATHS.fireStation, "fire_station", 3, 30, 300],
];

const q = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

export async function buildPlacesFixture(): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "places-fixture-"));
  const db = await (await DuckDBInstance.create(":memory:")).connect();

  const rows = PLACES.map((x) => {
    const category = x.path.split(" > ").at(-1)!;
    return `(${q(x.name)}, ${q(category)}, ${q(x.path)}, ${q(x.basic)}, ${q(x.address ?? null)}, ${q(x.address ? "Seattle" : null)}, ${q(x.address ? "WA" : null)}, ${q(x.address ? "98101" : null)}, ${CENTRE.lon}, ${CENTRE.lat + x.miles * MILE_LAT}, ${q(x.tract)}, 'meta')`;
  });
  await db.run(
    `COPY (SELECT * FROM (VALUES ${rows.join(", ")})
       AS t(name, category, path, basic_category, address, city, state, postcode, lon, lat, tract, source)
       ORDER BY tract)
     TO '${join(dir, "places.parquet")}' (FORMAT parquet)`,
  );

  const counts = COUNTS.flatMap(([path, basic, county, state, us]) => [
    `('county', '53033', ${q(path)}, ${q(basic)}, ${county})`,
    `('state', '53', ${q(path)}, ${q(basic)}, ${state})`,
    `('us', '', ${q(path)}, ${q(basic)}, ${us})`,
  ]);
  await db.run(
    `COPY (SELECT * FROM (VALUES ${counts.join(", ")}) AS t(level, geoid, path, basic_category, n)
       ORDER BY level, geoid, path)
     TO '${join(dir, "place-counts.parquet")}' (FORMAT parquet)`,
  );
  db.closeSync();

  // Every node of the tree (each prefix of each path) with its national count.
  const nodes = new Map<string, number>();
  for (const [path, , , , us] of COUNTS) {
    const levels = path.split(" > ");
    for (let i = 1; i <= levels.length; i++) {
      const node = levels.slice(0, i).join(" > ");
      nodes.set(node, (nodes.get(node) ?? 0) + us);
    }
  }
  const types = [...nodes].map(([path, n]) => ({ path, name: path.split(" > ").at(-1)!, n }));
  await writeFile(join(dir, "place-types.json"), JSON.stringify(types));
  await writeFile(
    join(dir, "manifest.json"),
    JSON.stringify({ release: "2026-11-18.0", built: "2026-11-21", places: PLACES.length, dropped: 0 }),
  );
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
