import { getDataset, loadCatalog, searchDatasets } from "../src/core/catalog.js";

beforeEach(() =>
  loadCatalog([
    { id: "acs/acs1", title: "ACS 1-Year income estimates", description: "raw", vintages: [2023, 2024], timeseries: false, curated: false },
    { id: "acs/acs5", title: "American Community Survey 5-Year Estimates", description: "Covers income, poverty, housing.", vintages: [2023, 2024], timeseries: false, curated: true },
    { id: "acs/acs5/profile", title: "ACS 5-Year Data Profiles", description: "acs/acs5 profile tables", vintages: [2024], timeseries: false, curated: false },
    { id: "timeseries/poverty/saipe", title: "Small Area Income and Poverty Estimates", description: "Annual poverty", vintages: [], timeseries: true, curated: true },
  ])
);

test("a curated dataset outranks a non-curated one with an equal match", () => {
  loadCatalog([
    { id: "x/raw", title: "Housing survey", description: "", vintages: [2024], timeseries: false, curated: false },
    { id: "x/cur", title: "Housing survey", description: "", vintages: [2024], timeseries: false, curated: true },
  ]);
  expect(searchDatasets("housing")[0].id).toBe("x/cur");
});

test("searching an exact dataset id returns it first", () =>
  expect(searchDatasets("acs/acs5")[0].id).toBe("acs/acs5"));

test("description words are searched, and the fullest match comes first", () =>
  expect(searchDatasets("poverty housing")[0].id).toBe("acs/acs5"));

test("the timeseries flag surfaces", () =>
  expect(searchDatasets("saipe poverty")[0]).toMatchObject({ timeseries: true, vintages: [] }));

test("limit caps the result count", () =>
  expect(searchDatasets("acs", 2).length).toBe(2));

test("getDataset is case-insensitive on id", () => {
  expect(getDataset(" ACS/ACS5 ")?.id).toBe("acs/acs5");
  expect(getDataset("nope")).toBeUndefined();
});

test("a curated dataset matched on its description outranks an uncurated title match", () => {
  loadCatalog([
    { id: "ecnccard", title: "Economic Census: Credit Card Income", description: "", vintages: [2022], timeseries: false, curated: false },
    { id: "acs/acs5", title: "American Community Survey 5-Year Estimates", description: "Covers income, poverty, housing.", vintages: [2024], timeseries: false, curated: true },
  ]);
  expect(searchDatasets("income")[0].id).toBe("acs/acs5");
});

test("equal matches keep catalog order, however long the description", () => {
  loadCatalog([
    { id: "acs/acs5", title: "American Community Survey 5-Year Estimates", description: "The workhorse. Covers demographics, income, poverty, education, housing and much more besides.", vintages: [2024], timeseries: false, curated: true },
    { id: "cre", title: "Community Resilience Estimates", description: "Risk, income.", vintages: [2023], timeseries: false, curated: true },
  ]);
  expect(searchDatasets("income").map((d) => d.id)).toEqual(["acs/acs5", "cre"]);
});

test("a specific phrase still finds the broad dataset that covers it", () => {
  loadCatalog([
    { id: "acs/acs5", title: "American Community Survey 5-Year Estimates", description: "Covers demographics, income, poverty, housing.", vintages: [2024], timeseries: false, curated: true },
    { id: "cbp", title: "County Business Patterns", description: "Establishments and payroll.", vintages: [2022], timeseries: false, curated: true },
  ]);
  expect(searchDatasets("median household income").map((d) => d.id)).toEqual(["acs/acs5"]);
});
