import { z } from "zod";
import {
  listVariables,
  queryData,
  searchIndustries,
  searchProducts,
} from "./census.js";

export const searchIndustriesSchema = {
  keyword: z.string().min(1).describe("Keyword to search NAICS 2022 industry labels (case-insensitive substring match)."),
};

export async function searchIndustriesTool(args: { keyword: string }) {
  const results = await searchIndustries(args.keyword);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(results, null, 2),
      },
    ],
  };
}

export const searchProductsSchema = {
  keyword: z.string().min(1).describe("Keyword to search NAPCS 2022 product/service labels (case-insensitive substring match)."),
};

export async function searchProductsTool(args: { keyword: string }) {
  const results = await searchProducts(args.keyword);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(results, null, 2),
      },
    ],
  };
}

export const queryDataSchema = {
  naics: z
    .string()
    .optional()
    .describe('NAICS 2022 industry code. Omit for all industries. Use search_industries to find codes.'),
  napcs: z
    .string()
    .optional()
    .describe('NAPCS 2022 product/service code. Omit for all products. Use search_products to find codes.'),
  taxstat: z
    .string()
    .optional()
    .describe('Tax status filter. Omit for all. "0" = taxable, "2" = tax-exempt.'),
  variables: z
    .array(z.string())
    .optional()
    .describe(
      "Census variables to retrieve. Defaults to: GEO_ID, NAPCS2022_LABEL, NAICS2022_LABEL, ESTAB, NAPCSDOL, NAICSALL_PCT."
    ),
};

export async function queryDataTool(args: {
  naics?: string;
  napcs?: string;
  taxstat?: string;
  variables?: string[];
}) {
  const rows = await queryData(args);
  const note =
    rows.length === 0
      ? "No results for these filters. Try broader NAICS/NAPCS codes or confirm codes with search_industries/search_products."
      : `Returned ${rows.length} row(s).`;
  return {
    content: [
      { type: "text" as const, text: note },
      { type: "text" as const, text: JSON.stringify(rows, null, 2) },
    ],
  };
}

export async function listVariablesTool() {
  const vars = await listVariables();
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(vars, null, 2),
      },
    ],
  };
}
