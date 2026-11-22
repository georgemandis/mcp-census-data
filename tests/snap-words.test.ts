import { describe, expect, it } from "vitest";
import { SNAP_ATTRIBUTION, SNAP_MISSING, SNAP_NOTE, isSnapRequest, snapTerritoryNote } from "../src/snap/words.js";

describe("isSnapRequest", () => {
  it.each(["SNAP stores", "places that take SNAP", "EBT", "food stamps", "food stamp retailers", "snap-authorized", "Snap"])(
    "%j asks about SNAP",
    (words) => expect(isSnapRequest(words)).toBe(true),
  );

  it.each(["snapper", "snapshot", "grocery stores", "stamps", "food", "stamp collectors", "ebts", "food banks"])(
    "%j does not",
    (words) => expect(isSnapRequest(words)).toBe(false),
  );
});

describe("snapTerritoryNote", () => {
  it("names the territories outside SNAP", () => {
    expect(snapTerritoryNote("72")).toBe(
      "Puerto Rico does not take part in SNAP; it runs its own nutrition assistance program, and its stores are not in USDA's SNAP list.",
    );
    expect(snapTerritoryNote("60")).toMatch(/^American Samoa does not take part in SNAP;/);
    expect(snapTerritoryNote("69")).toMatch(/^Northern Mariana Islands does not take part in SNAP;/);
  });

  it("is silent where SNAP runs", () => {
    for (const state of ["66", "78", "53", "11"]) expect(snapTerritoryNote(state)).toBeNull();
  });
});

describe("wording", () => {
  it("is fixed", () => {
    expect(SNAP_MISSING).toBe(
      "The SNAP retailer data has not been built on this server. Run: npm run build && npm run build:snap",
    );
    expect(SNAP_NOTE("2026-11-05")).toBe(
      "SNAP retailers are USDA's list of currently authorised stores as of 2026-11-05. Counts are exact for that date; 'full-line' means supermarkets, super stores and grocery stores.",
    );
    expect(SNAP_ATTRIBUTION("2026-11-05")).toBe(
      "U.S. Department of Agriculture, Food and Nutrition Service, SNAP Retailer Locator data, as of 2026-11-05.",
    );
  });
});
