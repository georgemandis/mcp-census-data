/**
 * What a place profile contains: sections, lines and gaps, as data.
 *
 * A cell is an ACS detailed-table cell, written "B22003_002" (table,
 * underscore, three-digit line). The Census label for every cell used here
 * is kept in data/acs-labels.json (npm run check:profile) so the meaning of
 * each line can be read against its source.
 */

export const ACS_YEAR = 2024;
export const ACS_PERIOD = "2020-2024";

export type Cell = string;

export interface Line {
  id: string;
  label: string;
  /** Cells summed for the numerator (or the single cell for a median or index). */
  num: Cell[];
  /** Cells summed for the denominator. Null for counts, medians and indexes. */
  den: Cell[] | null;
  kind?: "share" | "count" | "median" | "index";
  /** Lines sharing a group are ranked and cut to the section's `top` for it. */
  group?: string;
}

export interface Section {
  id: string;
  title: string;
  lines: Line[];
  top?: Record<string, number>;
}

const pad = (n: number) => String(n).padStart(3, "0");
/** Cells `from`..`to` inclusive of one table. */
const range = (table: string, from: number, to: number): Cell[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${table}_${pad(from + i)}`);
const cells = (table: string, ...lines: number[]): Cell[] => lines.map((n) => `${table}_${pad(n)}`);
const total = (table: string): Cell[] => [`${table}_001`];

const shareOf = (id: string, label: string, table: string, lines: number[], den = total(table)): Line => ({
  id,
  label,
  num: cells(table, ...lines),
  den,
});

// B01001 lists each age band twice: male (from line 3) then female (from 27).
const age = (id: string, label: string, from: number, to: number): Line => ({
  id,
  label,
  num: [...range("B01001", from, to), ...range("B01001", from + 24, to + 24)],
  den: total("B01001"),
});

// C24030 industries: [male line, female line, label].
const INDUSTRIES: [number, number, string][] = [
  [3, 30, "Agriculture, forestry, fishing, hunting and mining"],
  [6, 33, "Construction"],
  [7, 34, "Manufacturing"],
  [8, 35, "Wholesale trade"],
  [9, 36, "Retail trade"],
  [10, 37, "Transportation, warehousing and utilities"],
  [13, 40, "Information"],
  [14, 41, "Finance, insurance and real estate"],
  [17, 44, "Professional, scientific, management and administrative services"],
  [21, 48, "Education, health care and social assistance"],
  [24, 51, "Arts, entertainment, recreation, accommodation and food services"],
  [27, 54, "Other services"],
  [28, 55, "Public administration"],
];

// C16001 languages other than English: [line, label].
const LANGUAGES: [number, string][] = [
  [3, "Spanish"],
  [6, "French, Haitian or Cajun"],
  [9, "German or other West Germanic languages"],
  [12, "Russian, Polish or other Slavic languages"],
  [15, "Other Indo-European languages"],
  [18, "Korean"],
  [21, "Chinese (including Mandarin and Cantonese)"],
  [24, "Vietnamese"],
  [27, "Tagalog (including Filipino)"],
  [30, "Other Asian and Pacific Island languages"],
  [33, "Arabic"],
  [36, "Other and unspecified languages"],
];

// B04006 ancestries: [line, label]. "Other groups" and "Unclassified or not
// reported" are left out; the table does not break them down.
const ANCESTRIES: [number, string][] = [
  [2, "Afghan"], [3, "Albanian"], [4, "Alsatian"], [5, "American"], [6, "Arab"], [16, "Armenian"],
  [17, "Assyrian, Chaldean or Syriac"], [18, "Australian"], [19, "Austrian"], [20, "Basque"],
  [21, "Belgian"], [22, "Brazilian"], [23, "British"], [24, "Bulgarian"], [25, "Cajun"],
  [26, "Canadian"], [27, "Carpatho Rusyn"], [28, "Celtic"], [29, "Croatian"], [30, "Cypriot"],
  [31, "Czech"], [32, "Czechoslovakian"], [33, "Danish"], [34, "Dutch"], [35, "Eastern European"],
  [36, "English"], [37, "Estonian"], [38, "European"], [39, "Finnish"], [40, "French"],
  [41, "French Canadian"], [42, "German"], [43, "German Russian"], [44, "Greek"], [45, "Guyanese"],
  [46, "Hungarian"], [47, "Icelander"], [48, "Iranian"], [49, "Irish"], [50, "Israeli"],
  [51, "Italian"], [52, "Latvian"], [53, "Lithuanian"], [54, "Luxembourger"], [55, "Macedonian"],
  [56, "Maltese"], [57, "New Zealander"], [58, "Northern European"], [59, "Norwegian"],
  [60, "Pennsylvania German"], [61, "Polish"], [62, "Portuguese"], [63, "Romanian"], [64, "Russian"],
  [65, "Scandinavian"], [66, "Scotch-Irish"], [67, "Scottish"], [68, "Serbian"], [69, "Slavic"],
  [70, "Slovak"], [71, "Slovene"], [72, "Soviet Union"], [73, "Subsaharan African"], [89, "Swedish"],
  [90, "Swiss"], [91, "Turkish"], [92, "Ukrainian"], [93, "Welsh"], [94, "West Indian"],
  [107, "Yugoslavian"],
];

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Medicaid (C27007) and Medicare (C27006) share one layout: "with coverage"
// for three age bands, male then female.
const COVERED = [4, 7, 10, 14, 17, 20];

export const SECTIONS: Section[] = [
  {
    id: "people",
    title: "People",
    lines: [
      { id: "population", label: "Total population", num: total("B01003"), den: null, kind: "count" },
      age("age_under_5", "Under 5 years", 3, 3),
      age("age_5_17", "5 to 17 years", 4, 6),
      age("age_18_34", "18 to 34 years", 7, 12),
      age("age_35_64", "35 to 64 years", 13, 19),
      age("age_65_74", "65 to 74 years", 20, 22),
      age("age_75_plus", "75 years and over", 23, 25),
    ],
  },
  {
    id: "income",
    title: "Income",
    lines: [
      { id: "median_household_income", label: "Median household income (dollars)", num: total("B19013"), den: null, kind: "median" },
      shareOf("income_under_25k", "Households with income under $25,000", "B19001", [2, 3, 4, 5]),
      shareOf("income_25k_50k", "Households with income $25,000 to $49,999", "B19001", [6, 7, 8, 9, 10]),
      shareOf("income_50k_75k", "Households with income $50,000 to $74,999", "B19001", [11, 12]),
      shareOf("income_75k_100k", "Households with income $75,000 to $99,999", "B19001", [13]),
      shareOf("income_100k_150k", "Households with income $100,000 to $149,999", "B19001", [14, 15]),
      shareOf("income_150k_plus", "Households with income $150,000 or more", "B19001", [16, 17]),
      { id: "income_inequality", label: "Income inequality (Gini index, 0 = equal, 1 = most unequal)", num: total("B19083"), den: null, kind: "index" },
      shareOf("below_poverty", "People below the poverty line", "C17002", [2, 3]),
      shareOf("below_twice_poverty", "People below twice the poverty line", "C17002", [2, 3, 4, 5, 6, 7]),
    ],
  },
  {
    id: "work",
    title: "Work",
    top: { industry: 5 },
    lines: [
      shareOf("in_labor_force", "People 16 and over in the labour force", "B23025", [2]),
      shareOf("unemployed", "Unemployed, as a share of the civilian labour force", "B23025", [5], cells("B23025", 3)),
      shareOf("occ_management", "Workers in management, business, science and arts", "C24010", [3, 39]),
      shareOf("occ_service", "Workers in service occupations", "C24010", [19, 55]),
      shareOf("occ_sales_office", "Workers in sales and office occupations", "C24010", [27, 63]),
      shareOf("occ_construction", "Workers in natural resources, construction and maintenance", "C24010", [30, 66]),
      shareOf("occ_production", "Workers in production, transportation and material moving", "C24010", [34, 70]),
      ...INDUSTRIES.map(([m, f, label]): Line => ({
        id: `ind_${slug(label)}`,
        label: `Workers in: ${label}`,
        num: cells("C24030", m, f),
        den: total("C24030"),
        group: "industry",
      })),
    ],
  },
  {
    id: "origins",
    title: "Origins",
    top: { language: 5, ancestry: 5 },
    lines: [
      shareOf("race_white", "White, not Hispanic or Latino", "B03002", [3]),
      shareOf("race_black", "Black or African American, not Hispanic or Latino", "B03002", [4]),
      shareOf("race_native", "American Indian and Alaska Native, not Hispanic or Latino", "B03002", [5]),
      shareOf("race_asian", "Asian, not Hispanic or Latino", "B03002", [6]),
      shareOf("race_pacific", "Native Hawaiian and Other Pacific Islander, not Hispanic or Latino", "B03002", [7]),
      shareOf("race_other", "Some other race, not Hispanic or Latino", "B03002", [8]),
      shareOf("race_two_or_more", "Two or more races, not Hispanic or Latino", "B03002", [9]),
      shareOf("hispanic", "Hispanic or Latino, of any race", "B03002", [12]),
      shareOf("foreign_born", "Born outside the United States", "B05002", [13]),
      shareOf("english_only", "People 5 and over who speak only English at home", "C16001", [2]),
      ...LANGUAGES.map(([n, label]): Line => ({
        id: `lang_${slug(label)}`,
        label: `Speak at home: ${label}`,
        num: cells("C16001", n),
        den: total("C16001"),
        group: "language",
      })),
      ...ANCESTRIES.map(([n, label]): Line => ({
        id: `anc_${slug(label)}`,
        label: `Ancestry reported: ${label}`,
        num: cells("B04006", n),
        den: total("B04006"),
        group: "ancestry",
      })),
    ],
  },
  {
    id: "households",
    title: "Households and children",
    lines: [
      shareOf("hh_married", "Married-couple family households", "B11001", [3]),
      shareOf("hh_other_family", "Other family households", "B11001", [4]),
      shareOf("hh_living_alone", "One-person households", "B11001", [8]),
      shareOf("hh_other_nonfamily", "Other non-family households", "B11001", [9]),
      shareOf("hh_with_children", "Households with children under 18", "B11005", [2]),
      { id: "children", label: "Children under 18", num: total("B09001"), den: null, kind: "count" },
      shareOf("children_under_5", "Children under 5, of children in households", "B09001", [3, 4], cells("B09001", 2)),
      shareOf("children_5_11", "Children 5 to 11, of children in households", "B09001", [5, 6, 7], cells("B09001", 2)),
      shareOf("children_12_17", "Children 12 to 17, of children in households", "B09001", [8, 9], cells("B09001", 2)),
      shareOf("hh_with_65_plus", "Households with someone 65 or older", "B11007", [2]),
      shareOf("hh_65_plus_alone", "Households that are one person 65 or older living alone", "B11007", [3]),
    ],
  },
  {
    id: "older_adults",
    title: "Older adults",
    lines: [
      age("people_65_plus", "People 65 and over", 20, 25),
      age("people_75_plus", "People 75 and over", 23, 25),
      shareOf("hh_retirement_income", "Households with retirement income", "B19059", [2]),
      shareOf("hh_social_security", "Households with Social Security income", "B19055", [2]),
    ],
  },
  {
    id: "school",
    title: "School",
    lines: [
      shareOf("enrolled", "People 3 and over enrolled in school", "B14001", [2]),
      shareOf("enrolled_preschool", "Enrolled in nursery school or preschool", "B14001", [3]),
      shareOf("enrolled_k_8", "Enrolled in kindergarten to grade 8", "B14001", [4, 5, 6]),
      shareOf("enrolled_high_school", "Enrolled in grades 9 to 12", "B14001", [7]),
      shareOf("enrolled_college", "Enrolled in college, undergraduate", "B14001", [8]),
      shareOf("enrolled_graduate", "Enrolled in graduate or professional school", "B14001", [9]),
      { id: "edu_less_than_high_school", label: "Adults 25 and over without a high school diploma", num: range("B15003", 2, 16), den: total("B15003") },
      shareOf("edu_high_school", "Adults 25 and over: high school diploma or equivalent", "B15003", [17, 18]),
      shareOf("edu_some_college", "Adults 25 and over: some college or an associate's degree", "B15003", [19, 20, 21]),
      shareOf("edu_bachelors", "Adults 25 and over: bachelor's degree", "B15003", [22]),
      shareOf("edu_graduate", "Adults 25 and over: graduate or professional degree", "B15003", [23, 24, 25]),
    ],
  },
  {
    id: "benefits",
    title: "Benefits",
    lines: [
      shareOf("snap", "Households receiving SNAP (food stamps)", "B22003", [2]),
      shareOf("cash_assistance", "Households with cash public assistance income", "B19057", [2]),
      shareOf("ssi", "Households with Supplemental Security Income (SSI)", "B19056", [2]),
      shareOf("social_security", "Households with Social Security income", "B19055", [2]),
      shareOf("medicaid", "People covered by Medicaid or other means-tested public coverage", "C27007", COVERED),
      shareOf("medicare", "People covered by Medicare", "C27006", COVERED),
      shareOf("uninsured", "People with no health insurance", "B27010", [17, 33, 50, 66]),
      shareOf("uninsured_under_19", "Children under 19 with no health insurance", "B27010", [17], cells("B27010", 2)),
    ],
  },
  {
    id: "housing",
    title: "Housing",
    lines: [
      shareOf("owner_occupied", "Homes occupied by their owner", "B25003", [2]),
      shareOf("renter_occupied", "Homes occupied by renters", "B25003", [3]),
      shareOf("renters_30_plus", "Renters paying 30% or more of income on rent", "B25070", [7, 8, 9, 10], range("B25070", 2, 10)),
    ],
  },
];

export const GAPS: Line[] = [
  {
    id: "poor_no_snap",
    label: "Households below the poverty line that do not receive SNAP",
    num: cells("B22003", 6),
    den: cells("B22003", 3, 6),
  },
  {
    id: "low_income_uninsured",
    label: "People below 138% of the poverty line with no health insurance",
    num: cells("C27016", 5, 8, 11, 15, 18, 21),
    den: cells("C27016", 2, 12),
  },
  {
    id: "children_uninsured",
    label: "Children under 19 with no health insurance",
    num: cells("B27010", 17),
    den: cells("B27010", 2),
  },
  {
    id: "rent_burdened",
    label: "Renters paying 30% or more of income on rent",
    num: cells("B25070", 7, 8, 9, 10),
    den: range("B25070", 2, 10),
  },
  {
    id: "older_alone",
    label: "Households with someone 65 or older that are one person living alone",
    num: cells("B11007", 3),
    den: cells("B11007", 2),
  },
];

const BAND_EDGES = [
  0, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 60000, 75000, 100000, 125000,
  150000, 200000,
];

/** All sixteen household income bands of B19001, for estimating a median. */
export const INCOME_BANDS: { lower: number; upper: number | null; cell: Cell }[] = BAND_EDGES.map(
  (lower, i) => ({ lower, upper: BAND_EDGES[i + 1] ?? null, cell: `B19001_${pad(i + 2)}` }),
);

function everyCell(): Cell[] {
  const lines = [...SECTIONS.flatMap((s) => s.lines), ...GAPS];
  return [...lines.flatMap((l) => [...l.num, ...(l.den ?? [])]), ...INCOME_BANDS.map((b) => b.cell)];
}

export const tableOf = (cell: Cell): string => cell.slice(0, cell.indexOf("_"));

/** Tables the profile reads, upper-case, sorted. */
export function tablesUsed(): string[] {
  return [...new Set(everyCell().map(tableOf))].sort();
}

/** Cells of one table the profile reads, sorted. */
export function cellsUsed(table: string): Cell[] {
  return [...new Set(everyCell().filter((c) => tableOf(c) === table))].sort();
}

/** Estimate column for a cell, as named in the Census bulk files. */
export const estColumn = (cell: Cell): string => cell.replace("_", "_E");
/** Margin-of-error column for a cell. */
export const moeColumn = (cell: Cell): string => cell.replace("_", "_M");

/** Bulk-file columns to keep for one table: estimate and margin per cell. */
export function columnsFor(table: string): string[] {
  return cellsUsed(table).flatMap((c) => [estColumn(c), moeColumn(c)]);
}
