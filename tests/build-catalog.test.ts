import { buildCatalog } from "../src/scripts/build-catalog.js";

const raw = [
  { c_dataset: ["acs", "acs5"], c_vintage: 2024, c_isAvailable: true, title: "ACS 5-Year 2024 raw", description: "raw 2024" },
  { c_dataset: ["acs", "acs5"], c_vintage: 2023, c_isAvailable: true, title: "ACS 5-Year 2023 raw", description: "raw 2023" },
  { c_dataset: ["cbp"], c_vintage: 2022, c_isAvailable: true, title: "County Business Patterns 2022", description: "cbp raw" },
  { c_dataset: ["old", "gone"], c_vintage: 1990, c_isAvailable: false, title: "Gone", description: "gone" },
  { c_dataset: ["timeseries", "poverty", "saipe"], c_isAvailable: true, title: "SAIPE raw", description: "saipe raw" },
];
const curated = { "acs/acs5": { title: "American Community Survey 5-Year", description: "The workhorse." } };

test("vintages of one dataset merge into one entry, ascending", () => {
  const acs = buildCatalog(raw, curated).find((d) => d.id === "acs/acs5");
  expect(acs?.vintages).toEqual([2023, 2024]);
});

test("unavailable datasets are dropped", () =>
  expect(buildCatalog(raw, curated).map((d) => d.id)).toEqual([
    "acs/acs5", "cbp", "timeseries/poverty/saipe",
  ]));

test("a curated id gets the hand-written text", () =>
  expect(buildCatalog(raw, curated)[0]).toEqual({
    id: "acs/acs5",
    title: "American Community Survey 5-Year",
    description: "The workhorse.",
    vintages: [2023, 2024],
    timeseries: false,
    curated: true,
  }));

test("other datasets take the most recent vintage's raw text", () => {
  const out = buildCatalog(raw, {});
  expect(out[0]).toMatchObject({ title: "ACS 5-Year 2024 raw", description: "raw 2024", curated: false });
});

test("timeseries datasets have no vintages and are flagged", () =>
  expect(buildCatalog(raw, curated)[2]).toMatchObject({
    id: "timeseries/poverty/saipe", vintages: [], timeseries: true,
  }));

test("duplicate vintages are listed once", () => {
  const out = buildCatalog([raw[0], raw[0]], {});
  expect(out[0].vintages).toEqual([2024]);
});

test("the shipped catalog has every hand-written description merged in", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { DATA_DIR } = await import("../src/core/version.js");
  const shipped = JSON.parse(readFileSync(join(DATA_DIR, "catalog.json"), "utf8"));
  const curated = JSON.parse(readFileSync(join(DATA_DIR, "curated-descriptions.json"), "utf8"));
  expect(shipped.length).toBeGreaterThan(500);
  expect(shipped.filter((d: { curated: boolean }) => d.curated).length).toBe(
    Object.keys(curated).length
  );
});
