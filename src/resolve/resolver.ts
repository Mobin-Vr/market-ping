import { BTC_SOURCE_ORDER, FRESH_MAX_AGE_MIN } from "../config";
import type { LastGoodMap, LastGoodValue } from "../db/lastGood";
import { METRIC_NAMES, SOURCE_NAMES } from "../types";
import type { Candidate, MetricName, ResolvedMetric, ResolvedMetrics, SourceName } from "../types";
import { checkCandidate, type SanityContext } from "./sanity";

/** Priority per metric. btc_usd follows BTC_SOURCE_ORDER (megaweb is the only USD source). */
export const METRIC_PRIORITY: Record<MetricName, readonly SourceName[]> = {
  usd_toman: ["nerkh", "navasan", "zipodo"],
  ounce_usd: ["nerkh", "navasan"],
  gold18_toman: ["nerkh", "navasan"],
  coin_bahar_toman: ["nerkh", "navasan"],
  coin_emami_toman: ["nerkh", "navasan"],
  coin_half_toman: ["nerkh", "navasan"],
  coin_quarter_toman: ["nerkh", "navasan"],
  btc_usd: BTC_SOURCE_ORDER,
};

export interface ResolveResult {
  metrics: ResolvedMetrics;
  /** Fresh selections that must be written to last_good. */
  lastGoodUpdates: LastGoodValue[];
  warnings: string[];
  usedSources: SourceName[];
}

/** Unknown age (null timestamp) can never be claimed fresh. */
function isFresh(candidate: Candidate, nowEpochSec: number): boolean {
  if (candidate.updatedAtEpochSec === null) return false;
  return nowEpochSec - candidate.updatedAtEpochSec <= FRESH_MAX_AGE_MIN * 60;
}

/** Newest timestamp wins; last_good competes with the live candidates. Ties keep priority order. */
function pickStale(live: readonly Candidate[], previous: LastGoodValue | null): ResolvedMetric | null {
  const options: ResolvedMetric[] = live.map((candidate) => ({
    metric: candidate.metric,
    value: candidate.value,
    source: candidate.source,
    updatedAtEpochSec: candidate.updatedAtEpochSec,
    stale: true,
    approximate: candidate.approximate,
  }));
  if (previous) {
    options.push({
      metric: previous.metric,
      value: previous.value,
      source: previous.source,
      updatedAtEpochSec: previous.updatedAtEpochSec,
      stale: true,
      approximate: previous.approximate,
    });
  }
  let best: ResolvedMetric | null = null;
  for (const option of options) {
    if (best === null) {
      best = option;
      continue;
    }
    const optionTs = option.updatedAtEpochSec ?? -1;
    const bestTs = best.updatedAtEpochSec ?? -1;
    if (optionTs > bestTs) best = option;
  }
  return best;
}

function emptyMetric(metric: MetricName): ResolvedMetric {
  return { metric, value: null, source: null, updatedAtEpochSec: null, stale: false, approximate: false };
}

/**
 * Resolution algorithm (spec section 6): valid + sanity-passing candidates are walked in
 * priority order; the first one within FRESH_MAX_AGE_MIN wins. Otherwise the newest
 * timestamp among live candidates and last_good wins, marked STALE. Otherwise N/A.
 */
export function resolveMetrics(
  candidates: readonly Candidate[],
  lastGood: LastGoodMap,
  usdtReference: number | null,
  nowEpochSec: number,
): ResolveResult {
  const metrics = {} as ResolvedMetrics;
  const lastGoodUpdates: LastGoodValue[] = [];
  const warnings: string[] = [];
  const used = new Set<SourceName>();
  let gold18Reference = lastGood.gold18_toman?.value ?? null;

  for (const metric of METRIC_NAMES) {
    const all = candidates.filter((candidate) => candidate.metric === metric);
    const ordered: Candidate[] = [];
    for (const source of METRIC_PRIORITY[metric]) {
      for (const candidate of all) {
        if (candidate.source === source) ordered.push(candidate);
      }
    }

    const context: SanityContext = { lastGood, gold18Reference, usdtReference };
    const passing: Candidate[] = [];
    for (const candidate of ordered) {
      const verdict = checkCandidate(candidate, context);
      if (verdict.ok) passing.push(candidate);
      else warnings.push(`${metric}:${candidate.source} rejected (${verdict.reason})`);
    }

    let considered = passing;
    if (considered.length === 0 && ordered.length > 0) {
      considered = [ordered[0]];
      warnings.push(`${metric}: all candidates failed sanity checks, keeping the highest-priority one`);
    }

    const fresh = considered.find((candidate) => isFresh(candidate, nowEpochSec));
    if (fresh) {
      metrics[metric] = {
        metric,
        value: fresh.value,
        source: fresh.source,
        updatedAtEpochSec: fresh.updatedAtEpochSec,
        stale: false,
        approximate: fresh.approximate,
      };
      lastGoodUpdates.push({
        metric,
        value: fresh.value,
        source: fresh.source,
        updatedAtEpochSec: fresh.updatedAtEpochSec ?? nowEpochSec,
        approximate: fresh.approximate,
      });
      used.add(fresh.source);
    } else {
      const stale = pickStale(considered, lastGood[metric] ?? null);
      metrics[metric] = stale ?? emptyMetric(metric);
      if (stale && stale.source) used.add(stale.source);
      if (stale && stale.updatedAtEpochSec === null) {
        warnings.push(`${metric}: stale value without a timestamp`);
      }
    }

    if (metric === "gold18_toman" && metrics[metric].value !== null) {
      gold18Reference = metrics[metric].value;
    }
  }

  return {
    metrics,
    lastGoodUpdates,
    warnings,
    usedSources: SOURCE_NAMES.filter((source) => used.has(source)),
  };
}
