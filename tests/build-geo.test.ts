import { buildCounties } from "../src/scripts/build-geo.js";

const row = (name: string, state: string, county: string) => [name, state, county];
const abbr = { "09": "CT", "17": "IL", "66": "GU" };

const current = [row("Cook County, Illinois", "17", "031"), row("Capitol Planning Region, Connecticut", "09", "110")];
const legacy = [row("Cook County, Illinois", "17", "031"), row("Fairfield County, Connecticut", "09", "001")];
const carried = [
  { name: "Guam", state_fips: "66", fips: "010", state_abbreviation: "GU" },
  { name: "Cook County", state_fips: "17", fips: "031", state_abbreviation: "IL" },
];

test("a county in both lists is plain", () =>
  expect(buildCounties(current, legacy, carried, abbr)).toContainEqual({
    name: "Cook County", state_fips: "17", fips: "031", state_abbreviation: "IL",
  }));

test("a county only in the older list is marked as ending in 2021", () =>
  expect(buildCounties(current, legacy, carried, abbr)).toContainEqual({
    name: "Fairfield County", state_fips: "09", fips: "001", state_abbreviation: "CT", valid_through: 2021,
  }));

test("a county only in the current list is marked as starting in 2022", () =>
  expect(buildCounties(current, legacy, carried, abbr)).toContainEqual({
    name: "Capitol Planning Region", state_fips: "09", fips: "110", state_abbreviation: "CT", valid_from: 2022,
  }));

test("entries neither list covers are carried over once, and output is sorted by code", () => {
  const out = buildCounties(current, legacy, carried, abbr);
  expect(out.map((c) => c.state_fips + c.fips)).toEqual(["09001", "09110", "17031", "66010"]);
});
