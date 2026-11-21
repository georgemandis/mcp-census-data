import { createCensusClient } from "../src/core/client.js";
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

test("a dataset with no groups endpoint (404) yields an empty list", async () => {
  const c = createCensusClient({ fetch: fake([new Response("not found", { status: 404 })]) });
  expect(await searchGroups(c, "cbp", 2022, "anything")).toEqual([]);
});

test("other group failures propagate", async () => {
  const f = fake([1, 2, 3].map(() => new Response("down", { status: 500 })));
  const c = createCensusClient({ fetch: f, sleep: async () => {} });
  await expect(searchGroups(c, "acs/acs5", 2024, "age")).rejects.toMatchObject({ kind: "http" });
});
