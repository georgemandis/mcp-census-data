import { describe, expect, it } from "vitest";
import { differs, interpolatedMedian, reliability, share, sumEst } from "../src/profile/moe.js";

const e = (est: number | null, moe: number | null) => ({ est, moe });

describe("sumEst", () => {
  it("adds estimates and combines margins as root sum of squares", () => {
    expect(sumEst([e(10, 3), e(20, 4)])).toEqual({ est: 30, moe: 5 });
  });

  it("counts only the largest margin among zero estimates", () => {
    expect(sumEst([e(0, 12), e(0, 12), e(10, 5)])).toEqual({ est: 10, moe: 13 });
  });

  it("skips parts with no estimate", () => {
    expect(sumEst([e(null, null), e(10, 3)])).toEqual({ est: 10, moe: 3 });
  });

  it("returns nulls when every part is missing", () => {
    expect(sumEst([e(null, null), e(null, 4)])).toEqual({ est: null, moe: null });
    expect(sumEst([])).toEqual({ est: null, moe: null });
  });

  it("has an unknown margin when any part's margin is unknown", () => {
    expect(sumEst([e(10, null), e(20, 4)])).toEqual({ est: 30, moe: null });
    expect(sumEst([e(250001, null)])).toEqual({ est: 250001, moe: null });
  });
});

describe("share", () => {
  it("computes a proportion and its margin", () => {
    const r = share(e(50, 10), e(200, 20));
    expect(r.est).toBe(0.25);
    expect(r.moe).toBeCloseTo(0.0433, 4);
  });

  it("uses the ratio form when the term under the root is negative", () => {
    const r = share(e(50, 5), e(100, 20));
    expect(r.est).toBe(0.5);
    expect(r.moe).toBeCloseTo(0.1118, 4);
  });

  it("returns nulls for a zero or missing denominator", () => {
    expect(share(e(0, 12), e(0, 12))).toEqual({ est: null, moe: null });
    expect(share(e(5, 2), e(null, null))).toEqual({ est: null, moe: null });
    expect(share(e(null, null), e(10, 2))).toEqual({ est: null, moe: null });
  });
});

describe("reliability", () => {
  it("labels by coefficient of variation", () => {
    expect(reliability(e(100, 20))).toBe("reliable");
    expect(reliability(e(100, 40))).toBe("use with caution");
    expect(reliability(e(100, 60))).toBe("unreliable");
  });

  it("handles missing and zero estimates", () => {
    expect(reliability(e(null, null))).toBe("no data");
    expect(reliability(e(0, 12))).toBe("unreliable");
    expect(reliability(e(0, 0))).toBe("reliable");
  });
});

describe("differs", () => {
  it("says higher or lower only when the difference is significant", () => {
    expect(differs(e(0.3, 0.05), e(0.2, 0.05))).toBe("higher");
    expect(differs(e(0.2, 0.05), e(0.3, 0.05))).toBe("lower");
    expect(differs(e(0.25, 0.05), e(0.2, 0.05))).toBe("not distinguishable");
  });

  it("cannot distinguish when a side is missing", () => {
    expect(differs(e(null, null), e(0.2, 0.05))).toBe("not distinguishable");
    expect(differs(e(0.2, 0.05), e(null, null))).toBe("not distinguishable");
  });
});

describe("interpolatedMedian", () => {
  it("interpolates inside the band holding the middle", () => {
    const m = interpolatedMedian([
      { lower: 0, upper: 10000, count: 10 },
      { lower: 10000, upper: 20000, count: 30 },
      { lower: 20000, upper: 30000, count: 60 },
    ]);
    expect(m).toBeCloseTo(21666.67, 2);
  });

  it("returns null when the middle is in the open top band", () => {
    expect(
      interpolatedMedian([
        { lower: 0, upper: 10000, count: 10 },
        { lower: 10000, upper: null, count: 90 },
      ]),
    ).toBeNull();
  });

  it("returns null when there is nothing to count", () => {
    expect(interpolatedMedian([{ lower: 0, upper: 10000, count: 0 }])).toBeNull();
    expect(interpolatedMedian([])).toBeNull();
  });
});

// Worked examples from "Understanding and Using American Community Survey
// Data" (Census Bureau, 2020), chapter 8, examples 1 and 3.
describe("ACS handbook worked examples", () => {
  const neverMarried = [e(135173, 3860), e(43104, 2642), e(24842, 1957)];
  const allFemales = [e(466037, 391), e(97360, 572), e(67101, 459)];

  it("example 1: aggregated count across three areas", () => {
    const r = sumEst(neverMarried);
    expect(r.est).toBe(203119);
    expect(Math.round(r.moe!)).toBe(5070);
  });

  it("example 3: proportion of the aggregated counts", () => {
    const den = sumEst(allFemales);
    expect(den.est).toBe(630498);
    expect(Math.round(den.moe!)).toBe(831);
    const r = share(sumEst(neverMarried), den);
    expect(r.est).toBeCloseTo(0.322, 3);
    expect(r.moe).toBeCloseTo(0.008, 3);
    expect(reliability(r)).toBe("reliable");
  });
});

describe("an unknown margin", () => {
  it("is not called reliable", () => {
    expect(reliability(e(250001, null))).toBe("margin unknown");
  });

  it("carries through a share", () => {
    expect(share(e(50, null), e(200, 20))).toEqual({ est: 0.25, moe: null });
    expect(share(e(50, 10), e(200, null))).toEqual({ est: 0.25, moe: null });
  });

  it("cannot support a claim of difference", () => {
    expect(differs(e(0.9, null), e(0.2, 0.05))).toBe("not distinguishable");
    expect(differs(e(0.9, 0.05), e(0.2, null))).toBe("not distinguishable");
  });
});
