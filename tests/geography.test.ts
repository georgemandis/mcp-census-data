import { listGeographies, resolveGeography } from "../src/core/geography.js";
import { recordingClient } from "./helpers.js";

test("'County, ST' resolves to exactly that county", () => {
  const r = resolveGeography("Cook County, IL");
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({
    name: "Cook County, Illinois", level: "county", fips: "031", state_fips: "17",
    for_clause: "county:031", in_clause: "state:17",
  });
});

test("a full state name works as the qualifier, in any case", () =>
  expect(resolveGeography("cook county, illinois")).toEqual(resolveGeography("Cook County, IL")));

test("a bare county name with a state qualifier finds the county", () =>
  expect(resolveGeography("Cook, IL")[0].for_clause).toBe("county:031"));

test("a two-letter input is a state abbreviation and nothing else", () => {
  const r = resolveGeography("TX");
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ fips: "48", level: "state", for_clause: "state:48" });
});

test("a state outranks counties of the same name", () => {
  const r = resolveGeography("Washington");
  expect(r[0]).toMatchObject({ level: "state", name: "Washington" });
  expect(r.length).toBeGreaterThan(1);
  expect(r.length).toBeLessThanOrEqual(20);
});

test("parishes resolve without the word 'Parish'", () =>
  expect(resolveGeography("Orleans, LA")[0].name).toBe("Orleans Parish, Louisiana"));

test("an exact county name outranks names that merely contain it", () =>
  expect(resolveGeography("Cook", "county")[0].name).toMatch(/^Cook County, /));

test("level restricts the search", () => {
  expect(resolveGeography("Washington", "county").every((m) => m.level === "county")).toBe(true);
  expect(resolveGeography("Washington", "state")).toHaveLength(1);
});

test("an unknown place is an empty list", () => {
  expect(resolveGeography("zzzz")).toEqual([]);
  expect(resolveGeography("  ")).toEqual([]);
});

test("a comma with an unknown qualifier does not hide the match", () =>
  expect(resolveGeography("Cook County, USA")[0].name).toMatch(/^Cook County, /));

test("listGeographies reads the dataset's geography file", async () => {
  const { client, paths } = recordingClient({
    fips: [{ name: "county", geoLevelDisplay: "050", requires: ["state"], wildcard: ["state"], referenceDate: "x" }],
  });
  expect(await listGeographies(client, "acs/acs5", 2024)).toEqual([
    { name: "county", geoLevelDisplay: "050", requires: ["state"], wildcard: ["state"] },
  ]);
  expect(paths).toEqual(["2024/acs/acs5/geography.json"]);
});

test("timeseries datasets list geographies without a vintage", async () => {
  const { client, paths } = recordingClient({ fips: [] });
  await listGeographies(client, "timeseries/poverty/saipe");
  expect(paths).toEqual(["timeseries/poverty/saipe/geography.json"]);
});

test("a 404 from the geography file says the dataset was not found", async () => {
  const { createCensusClient } = await import("../src/core/client.js");
  const { fake } = await import("./helpers.js");
  const c = createCensusClient({ fetch: fake([new Response("<html>404</html>", { status: 404 })]) });
  await expect(listGeographies(c, "acs/acs5", 2031)).rejects.toMatchObject({
    kind: "invalid_request",
    message: expect.stringContaining("Dataset acs/acs5 for 2031 was not found"),
  });
});

test("a Connecticut county carries a note that it ended in 2021", () => {
  const [m] = resolveGeography("Fairfield County, CT");
  expect(m.for_clause).toBe("county:001");
  expect(m.note).toBe(
    "Census data for 2022 and later does not use this county. For newer data, look up the area that replaced it (in Connecticut, a planning region)."
  );
});

test("Connecticut planning regions resolve, with a note that they start in 2022", () => {
  const [m] = resolveGeography("Capitol, CT");
  expect(m).toMatchObject({ name: "Capitol Planning Region, Connecticut", for_clause: "county:110", in_clause: "state:09" });
  expect(m.note).toBe("Census data for 2021 and earlier does not use this area.");
});

test("ordinary counties carry no note", () =>
  expect(resolveGeography("Cook County, IL")[0]).not.toHaveProperty("note"));

test("'Washington, DC' resolves to the District", () =>
  expect(resolveGeography("Washington, DC")[0]).toMatchObject({ level: "state", fips: "11" }));

test("'Saint' and 'St.' are interchangeable", () => {
  expect(resolveGeography("Saint Louis County, MO")[0].name).toBe("St. Louis County, Missouri");
  expect(resolveGeography("St Louis, MO").map((m) => m.name)).toContain("St. Louis city, Missouri");
});

test("accents are optional", () => {
  expect(resolveGeography("Dona Ana County, NM")[0].name).toBe("Doña Ana County, New Mexico");
  expect(resolveGeography("Doña Ana")[0].for_clause).toBe("county:013");
});

describe("name lookups for profiles", () => {
  it("turns a state name or code into its postal code", async () => {
    const { stateCode } = await import("../src/core/geography.js");
    expect(stateCode("wa")).toBe("WA");
    expect(stateCode(" Washington ")).toBe("WA");
    expect(stateCode("Narnia")).toBeUndefined();
  });

  it("names a state and a county from their codes", async () => {
    const { stateName, countyName } = await import("../src/core/geography.js");
    expect(stateName("53")).toBe("Washington");
    expect(countyName("53033")).toBe("King County, Washington");
    expect(stateName("99")).toBeUndefined();
    expect(countyName("99999")).toBeUndefined();
  });

  it("names Connecticut's current planning regions", async () => {
    const { countyName } = await import("../src/core/geography.js");
    expect(countyName("09110")).toMatch(/Planning Region, Connecticut$/);
  });
});
