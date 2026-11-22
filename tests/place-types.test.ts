import { describe, expect, it } from "vitest";
import { fold, isUnder, matchType, type TypeNode } from "../src/places/types.js";

const paths: [string, number][] = [
  ["shopping", 5000],
  ["shopping > food_and_beverage_store", 900],
  ["shopping > food_and_beverage_store > grocery_store", 700],
  ["shopping > food_and_beverage_store > grocery_store > asian_grocery_store", 30],
  ["shopping > food_and_beverage_store > grocery_store > organic_grocery_store", 20],
  ["shopping > school_supply_store", 40],
  ["education", 3000],
  ["education > library", 240],
  ["education > school", 1500],
  ["education > school > elementary_school", 800],
  ["education > school > high_school", 400],
  ["education > educational_service", 300],
  ["education > educational_service > tutoring_service", 110],
  ["education > educational_service > tutoring_service > private_tutor", 20],
  ["community_and_government", 2000],
  ["community_and_government > social_or_community_service", 600],
  ["community_and_government > social_or_community_service > food_bank", 44],
  ["community_and_government > fire_station", 300],
];
const nodes: TypeNode[] = paths.map(([path, n]) => ({ path, name: path.split(" > ").at(-1)!, n }));
const matched = (asked: string) => {
  const m = matchType(asked, nodes);
  return "path" in m ? m.path : m.candidates.map((c) => c.name);
};

describe("fold", () => {
  it.each([
    ["libraries", "library"],
    ["churches", "church"],
    ["bakeries", "bakery"],
    ["tutors", "tutor"],
    ["movies", "movie"],
    ["cookies", "cookie"],
    ["Stores", "store"],
    ["glass", "glass"],
    ["gyms", "gym"],
  ])("%s and %s are one word", (a, b) => {
    expect(fold(a)).toBe(fold(b));
  });
});

describe("fold keeps different things different", () => {
  it.each([
    ["training", "train"],
    ["marketing", "market"],
    ["parking", "park"],
    ["fishing", "fish"],
    ["gardening", "garden"],
  ])("%s is not %s", (a, b) => {
    expect(fold(a)).not.toBe(fold(b));
  });
});

describe("isUnder", () => {
  it("is true for the node itself and its real descendants only", () => {
    expect(isUnder("education > school", "education > school")).toBe(true);
    expect(isUnder("education > school > high_school", "education > school")).toBe(true);
    expect(isUnder("shopping > school_supply_store", "education > school")).toBe(false);
    expect(isUnder("education > schoolhouse", "education > school")).toBe(false);
    expect(isUnder("education", "education > school")).toBe(false);
  });
});

describe("matchType", () => {
  const GROCERY = "shopping > food_and_beverage_store > grocery_store";

  it.each(["grocery stores", "Grocery Store", "grocery_store", "groceries", GROCERY])(
    "%j is the grocery store node",
    (asked) => expect(matched(asked)).toBe(GROCERY),
  );

  it.each([
    ["tutors", "education > educational_service > tutoring_service"],
    ["tutoring", "education > educational_service > tutoring_service"],
    ["libraries", "education > library"],
    ["food banks", "community_and_government > social_or_community_service > food_bank"],
    ["fire stations", "community_and_government > fire_station"],
    ["high schools", "education > school > high_school"],
    ["private tutors", "education > educational_service > tutoring_service > private_tutor"],
  ])("%j is %s", (asked, path) => expect(matched(asked)).toBe(path));

  it("takes the node, not a sub-type or a look-alike, for a plain word", () => {
    expect(matched("schools")).toBe("education > school");
  });

  it("returns the count with a match", () => {
    expect(matchType("libraries", nodes)).toEqual({ path: "education > library", name: "library", n: 240 });
  });

  it("offers candidates when a word fits several unrelated types", () => {
    const m = matchType("store", nodes);
    expect("candidates" in m).toBe(true);
    const names = (m as { candidates: TypeNode[] }).candidates.map((c) => c.name);
    expect(names).toContain("grocery_store");
    expect(names).toContain("school_supply_store");
    expect(names.length).toBeLessThanOrEqual(8);
  });

  it("offers candidates from ancestor names when no type has the word itself", () => {
    expect(matched("shopping")).toBe("shopping");
    const m = matchType("government", nodes) as { candidates: TypeNode[] };
    expect(m.candidates.map((c) => c.name)).toContain("community_and_government");
  });

  it("counts nothing for words that fit no type", () => {
    expect(matchType("stuff", nodes)).toEqual({ candidates: [] });
    expect(matchType("", nodes)).toEqual({ candidates: [] });
    expect(matchType("   ", nodes)).toEqual({ candidates: [] });
  });

  it("puts larger types first among equal candidates", () => {
    const m = matchType("service", nodes) as { candidates: TypeNode[] };
    const ns = m.candidates.map((c) => c.n);
    expect(m.candidates.length).toBeGreaterThan(1);
    expect(ns[0]).toBeGreaterThanOrEqual(ns[1]);
  });
});

describe("matchType on awkward everyday words", () => {
  const more: [string, number][] = [
    ["sports_and_recreation", 9000],
    ["sports_and_recreation > park", 1100],
    ["sports_and_recreation > park > playground", 48],
    ["travel_and_transportation > parking", 110],
    ["travel_and_transportation > rv_park", 100],
    ["food_and_drink", 9000],
    ["food_and_drink > restaurant", 6950],
    ["food_and_drink > restaurant > european_restaurant", 1300],
    ["restaurant", 1],
    ["health_care", 5000],
    ["health_care > doctors_office", 1050],
    ["health_care > dental_clinic", 1500],
    ["cultural_and_historic > place_of_worship", 3700],
    ["cultural_and_historic > place_of_worship > christian_place_of_worship", 3600],
    ["cultural_and_historic > place_of_worship > muslim_place_of_worship", 24],
    ["cultural_and_historic > place_of_worship > jewish_place_of_worship", 35],
    ["shopping > church_supply_store", 2],
    ["shopping > second_hand_store", 660],
    ["services_and_business > family_service > child_care_and_day_care", 250],
    ["education > college_university", 270],
    ["arts_and_entertainment > arcade", 43],
  ];
  const all: TypeNode[] = [...nodes, ...more.map(([path, n]) => ({ path, name: path.split(" > ").at(-1)!, n }))];
  const to = (asked: string) => {
    const m = matchType(asked, all);
    return "path" in m ? m.path : m.candidates.map((c) => c.name);
  };

  it("takes a type's own name in the plural, even when another word folds the same way", () => {
    expect(to("parks")).toBe("sports_and_recreation > park");
    expect(to("park")).toBe("sports_and_recreation > park");
    expect(to("parking")).toBe("travel_and_transportation > parking");
  });

  it("takes the far larger of two types sharing a name", () => {
    expect(to("restaurants")).toBe("food_and_drink > restaurant");
    expect(to("restaurant")).toBe("food_and_drink > restaurant");
  });

  it("treats 'office' as saying little", () => {
    expect(to("doctors")).toBe("health_care > doctors_office");
  });

  it.each([
    ["churches", "cultural_and_historic > place_of_worship > christian_place_of_worship"],
    ["mosques", "cultural_and_historic > place_of_worship > muslim_place_of_worship"],
    ["synagogues", "cultural_and_historic > place_of_worship > jewish_place_of_worship"],
    ["places of worship", "cultural_and_historic > place_of_worship"],
    ["dentists", "health_care > dental_clinic"],
    ["daycare", "services_and_business > family_service > child_care_and_day_care"],
    ["day cares", "services_and_business > family_service > child_care_and_day_care"],
    ["childcare", "services_and_business > family_service > child_care_and_day_care"],
    ["supermarkets", GROCERY_PATH()],
    ["thrift stores", "shopping > second_hand_store"],
    ["food pantries", "community_and_government > social_or_community_service > food_bank"],
    ["colleges", "education > college_university"],
    ["universities", "education > college_university"],
    ["pinball", "arts_and_entertainment > arcade"],
  ])("knows %j by its everyday name", (asked, path) => expect(to(asked)).toBe(path));

  it("ignores an everyday name whose type is not in the data", () => {
    const m = matchType("mosques", nodes);
    expect(m).toEqual({ candidates: [] });
  });
});

function GROCERY_PATH() {
  return "shopping > food_and_beverage_store > grocery_store";
}

describe("matchType never counts a narrower or different type than was asked for", () => {
  const more: [string, number][] = [
    ["travel > automotive_service", 3700],
    ["travel > automotive_service > automotive_repair", 1880],
    ["travel > automotive_service > auto_electrical_repair", 5],
    ["lifestyle > food_service", 69],
    ["food_and_drink", 9000],
    ["food_and_drink > cafe", 700],
    ["travel > rail > train", 2],
    ["shopping > market", 160],
    ["services > marketing_agency", 280],
    ["sports_and_recreation > fishing", 53],
    ["sports_and_recreation > park", 1100],
    ["travel > parking", 110],
    ["travel > rv_park", 100],
    ["health_care > chiropractic", 629],
    ["health_care > optometry", 317],
    ["health_care > physical_therapy", 422],
    ["health_care > psychotherapy", 99],
    ["health_care > emergency_or_urgent_care_facility", 159],
    ["health_care > emergency_or_urgent_care_facility > urgent_care_clinic", 35],
    ["arts > movie_theater", 80],
    ["legal > attorney_or_law_firm", 1451],
    ["beauty > mens_grooming_salon", 1],
    ["shopping > water_store", 1],
    ["sports_and_recreation > water_park", 5],
    ["sports_and_recreation > sport_or_recreation_club > community_garden", 9],
  ];
  const all: TypeNode[] = [...nodes, ...more.map(([path, n]) => ({ path, name: path.split(" > ").at(-1)!, n }))];
  const to = (asked: string) => {
    const m = matchType(asked, all);
    return "path" in m ? m.path : m.candidates.map((c) => c.name);
  };
  const candidates = (asked: string) => {
    const m = matchType(asked, all);
    expect("candidates" in m, `${asked} was counted as ${"path" in m ? m.path : ""}`).toBe(true);
    return (m as { candidates: TypeNode[] }).candidates.map((c) => c.name);
  };

  it("offers both when two words fit part of a longer type name", () => {
    const c = candidates("auto repair");
    expect(c).toContain("automotive_repair");
    expect(c).toContain("auto_electrical_repair");
    expect(candidates("grooming salon")).toContain("mens_grooming_salon");
  });

  it("does not take one word plus a filler-like word as a whole type when other types share the word", () => {
    const food = candidates("food");
    expect(food).toContain("food_service");
    expect(food).toContain("food_bank");
    expect(candidates("water")).toEqual(expect.arrayContaining(["water_store", "water_park"]));
    expect(candidates("community")).toEqual(expect.arrayContaining(["community_garden"]));
  });

  it("does not confuse a word with its -ing cousin", () => {
    candidates("training"); // offered as a possibility, never counted
    expect(to("trains")).toBe("travel > rail > train");
    expect(candidates("marketing")).toContain("marketing_agency");
    expect(to("markets")).toBe("shopping > market");
    expect(to("fishing")).toBe("sports_and_recreation > fishing");
    expect(to("parking")).toBe("travel > parking");
  });

  it.each(["parks", "the park", "local parks", "parks nearby", "Parks"])("%j is the park type", (asked) => {
    expect(to(asked)).toBe("sports_and_recreation > park");
  });

  it("still takes one word when only one family of types has it", () => {
    expect(to("grocery")).toBe("shopping > food_and_beverage_store > grocery_store");
    expect(to("urgent care")).toBe("health_care > emergency_or_urgent_care_facility > urgent_care_clinic");
    expect(to("tutors")).toBe("education > educational_service > tutoring_service");
    expect(to("tutoring")).toBe("education > educational_service > tutoring_service");
  });

  it.each([
    ["chiropractors", "health_care > chiropractic"],
    ["optometrists", "health_care > optometry"],
    ["lawyers", "legal > attorney_or_law_firm"],
    ["attorneys", "legal > attorney_or_law_firm"],
    ["movies", "arts > movie_theater"],
    ["cinemas", "arts > movie_theater"],
    ["movie theaters", "arts > movie_theater"],
    ["café", "food_and_drink > cafe"],
    ["cafés", "food_and_drink > cafe"],
  ])("knows %j", (asked, path) => expect(to(asked)).toBe(path));

  it("offers near-miss types as candidates when no word matches exactly", () => {
    expect(candidates("therapists")).toEqual(expect.arrayContaining(["physical_therapy", "psychotherapy"]));
    expect(candidates("rehab")).toEqual([]);
  });
});
