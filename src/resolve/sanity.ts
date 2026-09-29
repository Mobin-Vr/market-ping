import {
  COIN_TO_GOLD18_MAX_RATIO,
  COIN_TO_GOLD18_MIN_RATIO,
  MAX_DEVIATION_PCT,
  USDT_TO_USD_MAX_RATIO,
  USDT_TO_USD_MIN_RATIO,
} from "../config";
import type { LastGoodMap } from "../db/lastGood";
import type { Candidate } from "../types";

export interface SanityContext {
  lastGood: LastGoodMap;
  /** gold18_toman (Toman per gram) resolved this cycle or taken from last_good. */
  gold18Reference: number | null;
  /** USDT-in-Toman helper value for this cycle, if any source supplied one. */
  usdtReference: number | null;
}

export interface SanityResult {
  ok: boolean;
  reason: string | null;
}

const PASS: SanityResult = { ok: true, reason: null };

function fail(reason: string): SanityResult {
  return { ok: false, reason };
}

/**
 * Sanity guards for a single candidate. Rejections are logged as warnings by the caller
 * (never with secrets); if a metric has no candidate left, the resolver keeps the only /
 * highest-priority one and logs that too.
 */
export function checkCandidate(candidate: Candidate, context: SanityContext): SanityResult {
  // 1. deviation from the last known good value for the same metric
  const previous = context.lastGood[candidate.metric];
  if (previous && previous.value > 0) {
    const deviationPct = (Math.abs(candidate.value - previous.value) / previous.value) * 100;
    if (deviationPct > MAX_DEVIATION_PCT) {
      return fail(`deviation ${deviationPct.toFixed(1)}% from last_good`);
    }
  }

  // 2. unit guard: coin_emami_toman / gold18_toman must be 5..15 (thousand-Toman mistakes)
  if (candidate.metric === "coin_emami_toman" && context.gold18Reference !== null && context.gold18Reference > 0) {
    const ratio = candidate.value / context.gold18Reference;
    if (ratio < COIN_TO_GOLD18_MIN_RATIO || ratio > COIN_TO_GOLD18_MAX_RATIO) {
      return fail(
        `coin/gold18 ratio ${ratio.toFixed(2)} outside ${COIN_TO_GOLD18_MIN_RATIO}-${COIN_TO_GOLD18_MAX_RATIO}`,
      );
    }
  }

  // 3. unit guard: usdt_toman / usd_toman must be 0.9..1.15. Skipped for the approximate
  //    USDT-derived zipodo candidate (comparing USDT with USDT would be meaningless).
  if (
    candidate.metric === "usd_toman" &&
    candidate.source !== "zipodo" &&
    context.usdtReference !== null &&
    context.usdtReference > 0
  ) {
    const ratio = context.usdtReference / candidate.value;
    if (ratio < USDT_TO_USD_MIN_RATIO || ratio > USDT_TO_USD_MAX_RATIO) {
      return fail(
        `usdt/usd ratio ${ratio.toFixed(3)} outside ${USDT_TO_USD_MIN_RATIO}-${USDT_TO_USD_MAX_RATIO}`,
      );
    }
  }

  return PASS;
}

/**
 * Informational only: percentage difference between two values (used by the admin health
 * panel). Positive means `b` is higher than `a`.
 */
export function percentDifference(a: number, b: number): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return ((b - a) / a) * 100;
}
