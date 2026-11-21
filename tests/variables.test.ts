import { createCensusClient } from "../src/core/client.js";
import { loadCatalog } from "../src/core/catalog.js";
import { searchGroups, searchVariables } from "../src/core/variables.js";
import { fake, recordingClient } from "./helpers.js";

const VARS = {
  variables: {
    for: { label: "Census API FIPS 'for' clause", concept: "Census API Geography Specification" },
    B19013_001E: { label: "Estimate!!Median household income in the past 12 months", concept: "Median Household Income", group: "B19013" },
    B19113_001E: { label: "Estimate!!Median family income in the past 12 months", concept: "Median Family Income", group: "B19113" },
  },
};

test("finds variables by words in any order and returns code, label, concept, group", async () => {
  const { client, paths } = recordingClient(VARS);
  const r = await searchVariables(client, "acs/acs5", 2024, "income household median");
  expect(paths).toEqual(["2024/acs/acs5/variables.json"]);
  expect(r).toEqual([
    { name: "B19013_001E", label: "Estimate!!Median household income in the past 12 months", concept: "Median Household Income", group: "B19013" },
  ]);
});

test("searching a variable code finds it", async () => {
  const { client } = recordingClient(VARS);
  expect((await searchVariables(client, "acs/acs5", 2024, "b19113_001e"))[0].name).toBe("B19113_001E");
});

test("timeseries datasets need no vintage", async () => {
  const { client, paths } = recordingClient({ variables: {} });
  await searchVariables(client, "timeseries/poverty/saipe", undefined, "poverty");
  expect(paths).toEqual(["timeseries/poverty/saipe/variables.json"]);
});

test("at most 50 variables come back", async () => {
  const variables = Object.fromEntries(
    Array.from({ length: 80 }, (_, i) => [`V${i}`, { label: `income ${i}` }])
  );
  const { client } = recordingClient({ variables });
  expect((await searchVariables(client, "acs/acs5", 2024, "income")).length).toBe(50);
});

test("groups are searched by name and description", async () => {
  const { client, paths } = recordingClient({
    groups: [
      { name: "B01001", description: "Sex by Age" },
      { name: "B19013", description: "Median Household Income" },
    ],
  });
  expect(await searchGroups(client, "acs/acs5", 2024, "age sex")).toEqual([
    { name: "B01001", description: "Sex by Age" },
  ]);
  expect(paths).toEqual(["2024/acs/acs5/groups.json"]);
});

test("a dataset with no groups yields an empty list", async () => {
  const { client } = recordingClient({ groups: [] });
  expect(await searchGroups(client, "timeseries/eits/resconst", undefined, "anything")).toEqual([]);
});

test("a 404 means the dataset or year does not exist, and says so", async () => {
  loadCatalog([{ id: "acs/acs5", title: "ACS", description: "", vintages: [2022, 2023, 2024], timeseries: false, curated: true }]);
  for (const search of [searchGroups, searchVariables]) {
    const c = createCensusClient({ fetch: fake([new Response("<!doctype html>Tomcat", { status: 404 })]) });
    const err = await search(c, "acs/acs5", 2031, "age").catch((e) => e);
    expect(err).toMatchObject({ kind: "invalid_request" });
    expect(err.message).toBe(
      "Dataset acs/acs5 for 2031 was not found. Available years: 2022, 2023, 2024."
    );
  }
});

test("a 404 for a dataset the catalog does not know points to discover_datasets", async () => {
  loadCatalog([]);
  const c = createCensusClient({ fetch: fake([new Response("nope", { status: 404 })]) });
  await expect(searchVariables(c, "acs/nope", 2024, "age")).rejects.toMatchObject({
    message: "Dataset acs/nope for 2024 was not found. Use discover_datasets to find valid dataset IDs and years.",
  });
});

test("other group failures propagate", async () => {
  const f = fake([1, 2, 3].map(() => new Response("down", { status: 500 })));
  const c = createCensusClient({ fetch: f, sleep: async () => {} });
  await expect(searchGroups(c, "acs/acs5", 2024, "age")).rejects.toMatchObject({ kind: "http" });
});
