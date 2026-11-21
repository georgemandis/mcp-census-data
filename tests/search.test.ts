import { rank, tokenize } from "../src/core/search.js";

interface Item { id: string; label: string; concept?: string; curated?: boolean }
const f = (i: Item) => ({
  id: i.id, primary: i.label, secondary: i.concept, boost: i.curated ? 10 : 0,
});

test("tokenize lower-cases and splits on anything that is not a letter or digit", () =>
  expect(tokenize("  Median  Household-Income (2024)! ")).toEqual([
    "median", "household", "income", "2024",
  ]));

test("word order does not matter", () => {
  const items = [{ id: "B19013_001E", label: "Median Household Income" }];
  expect(rank(items, "income household median", f)).toEqual(items);
});

test("an item missing one query word is excluded", () => {
  const items = [{ id: "B19013_001E", label: "Median Household Income" }];
  expect(rank(items, "median family income", f)).toEqual([]);
});

test("a word may match in the secondary field", () => {
  const items = [{ id: "B01001_002E", label: "Total: Male", concept: "Sex by Age" }];
  expect(rank(items, "male age", f)).toEqual(items);
});

test("an exact id match ranks first", () => {
  const items = [
    { id: "acs/acs5/profile", label: "ACS 5-Year Data Profiles acs/acs5" },
    { id: "acs/acs5", label: "American Community Survey 5-Year" },
  ];
  expect(rank(items, " ACS/acs5 ", f)[0].id).toBe("acs/acs5");
});

test("a primary field starting with the query outranks a later mention", () => {
  const items = [
    { id: "a", label: "Aggregate income of households" },
    { id: "b", label: "Income in the past 12 months" },
  ];
  expect(rank(items, "income", f).map((i) => i.id)).toEqual(["b", "a"]);
});

test("all words in the primary field outrank a split across fields", () => {
  const items = [
    { id: "a", label: "Total", concept: "Poverty status by age" },
    { id: "b", label: "Poverty status by age" },
  ];
  expect(rank(items, "poverty age", f).map((i) => i.id)).toEqual(["b", "a"]);
});

test("boost breaks ties and equal scores keep input order", () => {
  const items = [
    { id: "a", label: "Housing units" },
    { id: "b", label: "Housing costs" },
    { id: "c", label: "Housing tenure", curated: true },
  ];
  expect(rank(items, "housing", f).map((i) => i.id)).toEqual(["c", "a", "b"]);
});

test("punctuation and repeated spaces are ignored", () => {
  const items = [{ id: "B19013", label: "Median Household Income in the Past 12 Months" }];
  expect(rank(items, "median  household-income", f)).toEqual(
    rank(items, "median household income", f)
  );
  expect(rank(items, "median  household-income", f)).toEqual(items);
  expect(rank(items, "Sex by Age!", f)).toEqual([]);
});

test("a query with no letters or digits matches nothing", () =>
  expect(rank([{ id: "a", label: "x" }], " !! ", f)).toEqual([]));
