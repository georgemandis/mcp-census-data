/**
 * Margin-of-error arithmetic for combining ACS estimates.
 *
 * Formulas are from the Census Bureau's "Understanding and Using American
 * Community Survey Data", chapter 8 (calculating measures of error for
 * derived estimates). Published margins are at the 90% level, so the
 * standard error is the margin divided by 1.645.
 */

export interface Est {
  est: number | null;
  moe: number | null;
}

export type Reliability = "reliable" | "use with caution" | "unreliable" | "no data";

const Z90 = 1.645;
const NONE: Est = { est: null, moe: null };

/**
 * Sum of estimates. The margin is the root of the summed squared margins;
 * among zero estimates only the largest margin is counted, once.
 */
export function sumEst(parts: Est[]): Est {
  let est = 0;
  let squares = 0;
  let zeroMoe = 0;
  let seen = false;
  for (const p of parts) {
    if (p.est === null) continue;
    seen = true;
    const moe = p.moe ?? 0;
    if (p.est === 0) {
      zeroMoe = Math.max(zeroMoe, moe);
    } else {
      est += p.est;
      squares += moe * moe;
    }
  }
  if (!seen) return { ...NONE };
  return { est, moe: Math.sqrt(squares + zeroMoe * zeroMoe) };
}

/** Numerator as a part of the denominator. The estimate is a fraction 0..1. */
export function share(num: Est, den: Est): Est {
  if (num.est === null || den.est === null || den.est <= 0) return { ...NONE };
  const p = num.est / den.est;
  const mn = num.moe ?? 0;
  const md = den.moe ?? 0;
  const under = mn * mn - p * p * md * md;
  const root = under >= 0 ? Math.sqrt(under) : Math.sqrt(mn * mn + p * p * md * md);
  return { est: p, moe: root / den.est };
}

export function reliability(e: Est): Reliability {
  if (e.est === null) return "no data";
  const moe = e.moe ?? 0;
  if (moe === 0) return "reliable";
  if (e.est === 0) return "unreliable";
  const cv = moe / Z90 / Math.abs(e.est);
  if (cv <= 0.15) return "reliable";
  if (cv <= 0.3) return "use with caution";
  return "unreliable";
}

/** Is `a` different from `b` by more than chance, at the 90% level? */
export function differs(a: Est, b: Est): "higher" | "lower" | "not distinguishable" {
  if (a.est === null || b.est === null) return "not distinguishable";
  const sa = (a.moe ?? 0) / Z90;
  const sb = (b.moe ?? 0) / Z90;
  const se = Math.sqrt(sa * sa + sb * sb);
  const diff = a.est - b.est;
  if (diff === 0) return "not distinguishable";
  if (se === 0 || Math.abs(diff) / se > Z90) return diff > 0 ? "higher" : "lower";
  return "not distinguishable";
}

/**
 * Median estimated from counts in bands, by linear interpolation inside the
 * band that holds the middle. Null when it falls in an open-ended band.
 */
export function interpolatedMedian(
  bands: { lower: number; upper: number | null; count: number }[],
): number | null {
  const total = bands.reduce((s, b) => s + b.count, 0);
  if (total <= 0) return null;
  const half = total / 2;
  let before = 0;
  for (const b of bands) {
    if (b.count > 0 && before + b.count >= half) {
      if (b.upper === null) return null;
      return b.lower + ((half - before) / b.count) * (b.upper - b.lower);
    }
    before += b.count;
  }
  return null;
}
