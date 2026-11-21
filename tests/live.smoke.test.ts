/**
 * Talks to the real Census API. Runs only when CENSUS_API_KEY is set:
 *   CENSUS_API_KEY=... npm test
 */
import { createCensusClient } from "../src/core/client.js";
import { queryData } from "../src/core/query.js";
import { listGeographies } from "../src/core/geography.js";
import { searchVariables } from "../src/core/variables.js";

describe.skipIf(!process.env.CENSUS_API_KEY)("live Census API", () => {
  const client = createCensusClient();
  const TIMEOUT = 30_000;

  test("ACS 5-year median household income for a state", async () => {
    const r = await queryData(client, {
      dataset: "acs/acs5", vintage: 2024, get: ["NAME", "B19013_001E"], for: "state:53",
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].NAME).toBe("Washington");
    expect(Number(r.rows[0].B19013_001E)).toBeGreaterThan(0);
  }, TIMEOUT);

  test("a timeseries dataset with a time predicate and no vintage", async () => {
    const r = await queryData(client, {
      dataset: "timeseries/poverty/saipe", get: ["NAME", "SAEPOVRTALL_PT"],
      for: "state:53", predicates: { time: "2022" },
    });
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].SAEPOVRTALL_PT)).toBeGreaterThan(0);
  }, TIMEOUT);

  test("a multi-part 'in' clause reaches tract level", async () => {
    const r = await queryData(client, {
      dataset: "acs/acs5", vintage: 2024, get: ["NAME", "B01003_001E"],
      for: "tract:*", in: "state:53 county:033", limit: 5,
    });
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
  }, TIMEOUT);

  test("an unknown variable is an http error that names it", async () => {
    await expect(
      queryData(client, { dataset: "acs/acs5", vintage: 2024, get: ["B19013_001X"], for: "us:1" })
    ).rejects.toMatchObject({ kind: "http", message: expect.stringContaining("B19013_001X") });
  }, TIMEOUT);

  test("exactly 50 variables is accepted by Census", async () => {
    const vars = await searchVariables(client, "acs/acs5", 2024, "B01001");
    const get = vars.map((v) => v.name).filter((n) => /^B01001_\d+E$/.test(n)).slice(0, 49);
    const r = await queryData(client, { dataset: "acs/acs5", vintage: 2024, get: ["NAME", ...get], for: "us:1" });
    expect(r.rows).toHaveLength(1);
  }, TIMEOUT);

  test("a dataset whose variable names are lower-case", async () => {
    const r = await queryData(client, {
      dataset: "timeseries/eits/advm3", get: ["cell_value", "data_type_code", "time_slot_id", "category_code", "seasonally_adj"],
      for: "us:*", predicates: { time: "2024-01" }, limit: 3,
    });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].cell_value).toBeTruthy();
  }, TIMEOUT);

  test("timeseries geography listing", async () => {
    const levels = await listGeographies(client, "timeseries/poverty/saipe");
    expect(levels.map((l) => l.name)).toContain("county");
  }, TIMEOUT);
});
