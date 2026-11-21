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
