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

test("on an equal score the more specific (shorter) text wins", () => {
  const items = [
    { id: "B19202G_001E", label: "Estimate!!Median nonfamily household income in the past 12 months", concept: "Median Nonfamily Household Income (Householder of Two or More Races)" },
    { id: "B19013_001E", label: "Estimate!!Median household income in the past 12 months", concept: "Median Household Income" },
  ];
  expect(rank(items, "median household income", f)[0].id).toBe("B19013_001E");
});

test("text that opens with the query phrase outranks text that mentions it later", () => {
  const items = [
    { id: "B25099_001E", label: "Estimate!!Median household income:!!Total:", concept: "Mortgage Status by Median Household Income" },
    { id: "B19013_001E", label: "Estimate!!Median household income in the past 12 months", concept: "Median Household Income in the Past 12 Months" },
    { id: "B01003_001E", label: "Estimate!!Total", concept: "Total Population" },
    { id: "C02003_002E", label: "Estimate!!Total:!!Population of one race:", concept: "Detailed Race" },
  ];
  expect(rank(items, "median household income", f)[0].id).toBe("B19013_001E");
  expect(rank(items, "total population", f)[0].id).toBe("B01003_001E");
});

// --- Any-word matching, used for dataset search ---
const loose = { requireAll: false, wholeWords: true, preferShorter: false };

test("with requireAll off, items matching more of the words rank higher", () => {
  const items = [
    { id: "saipe", label: "Small Area Income and Poverty Estimates" },
    { id: "acs5", label: "American Community Survey", concept: "Median household income, rent, poverty" },
    { id: "cbp", label: "County Business Patterns" },
  ];
  expect(rank(items, "median household income", f, loose).map((i) => i.id)).toEqual(["acs5", "saipe"]);
});

test("wholeWords matches word beginnings, not fragments inside words", () => {
  const items = [
    { id: "a", label: "Current Population Survey" },
    { id: "b", label: "Housing costs", concept: "Renters and rental costs" },
  ];
  expect(rank(items, "rent", f, loose).map((i) => i.id)).toEqual(["b"]);
});

test("filler words alone do not match everything", () => {
  const items = [{ id: "a", label: "Survey of the population" }];
  expect(rank(items, "of the", f, loose)).toEqual([]);
  expect(rank(items, "income of the people", f, loose)).toEqual([]);
});

test("an exact id still ranks first with requireAll off", () => {
  const items = [
    { id: "acs/acs5/profile", label: "ACS 5-Year Data Profiles acs acs5" },
    { id: "acs/acs5", label: "American Community Survey 5-Year" },
  ];
  expect(rank(items, "acs/acs5", f, loose)[0].id).toBe("acs/acs5");
});
