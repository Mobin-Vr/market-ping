import { describe, expect, it } from "vitest";
import { FRESH_MAX_AGE_MIN } from "../src/config";
import type { LastGoodMap, LastGoodValue } from "../src/db/lastGood";
import { resolveMetrics } from "../src/resolve/resolver";
import { checkCandidate, percentDifference, type SanityContext } from "../src/resolve/sanity";
import type { Candidate, MetricName, SourceName } from "../src/types";
import { allCandidates, expectFixtureAgreement, findCandidate, FIXTURE_NOW } from "./fixtures";

const MINUTE = 60;

function candidate(
  metric: MetricName,
  value: number,
  source: SourceName,
  ageSec: number,
  approximate = false,
): Candidate {
  return { metric, value, source, updatedAtEpochSec: FIXTURE_NOW - ageSec, approximate };
}

function lastGoodEntry(metric: MetricName, value: number, source: SourceName, ageSec: number): LastGoodValue {
  return { metric, value, source, updatedAtEpochSec: FIXTURE_NOW - ageSec, approximate: false };
}

function map(...entries: LastGoodValue[]): LastGoodMap {
  const result: LastGoodMap = {};
  for (const entry of entries) result[entry.metric] = entry;
  return result;
}

function context(partial: Partial<SanityContext>): SanityContext {
  return { lastGood: {}, gold18Reference: null, usdtReference: null, ...partial };
}

describe("cross-source agreement on the committed fixtures", () => {
  it("agrees within 3% for usd_toman and within 1% for every other metric", () => {
    const candidates = allCandidates();
    expect(findCandidate(candidates, "usd_toman", "nerkh")).toBe(244800);
    expectFixtureAgreement(candidates);
  });
});

describe("resolution: priority, freshness, stale fallback, N/A", () => {
  it("prefers nerkh while it is fresh", () => {
    const resolved = resolveMetrics(allCandidates(), {}, 249601, FIXTURE_NOW);
    expect(resolved.metrics.usd_toman.source).toBe("nerkh");
    expect(resolved.metrics.usd_toman.value).toBe(244800);
    expect(resolved.metrics.usd_toman.stale).toBe(false);
    expect(resolved.metrics.coin_emami_toman.value).toBe(250100000);
  });

  it("resolves all eight metrics and records a last_good update for each fresh one", () => {
    const resolved = resolveMetrics(allCandidates(), {}, 249601, FIXTURE_NOW);
    expect(Object.keys(resolved.metrics)).toHaveLength(8);
    expect(resolved.lastGoodUpdates).toHaveLength(8);
    expect(resolved.warnings).toHaveLength(0);
  });

  it("ignores the stale navasan usd_sell (13.6h old) while nerkh is fresh", () => {
    const candidates = [
      candidate("usd_toman", 244800, "nerkh", 2 * MINUTE),
      candidate("usd_toman", 244000, "navasan", 48951),
    ];
    const resolved = resolveMetrics(candidates, {}, null, FIXTURE_NOW);
    expect(resolved.metrics.usd_toman.source).toBe("nerkh");
    expect(resolved.metrics.usd_toman.stale).toBe(false);
  });

  it("marks a value STALE with its own timestamp when nothing is fresh", () => {
    const resolved = resolveMetrics([candidate("usd_toman", 244000, "navasan", 14 * 3600)], {}, null, FIXTURE_NOW);
    expect(resolved.metrics.usd_toman.stale).toBe(true);
    expect(resolved.metrics.usd_toman.source).toBe("navasan");
    expect(resolved.metrics.usd_toman.updatedAtEpochSec).toBe(FIXTURE_NOW - 14 * 3600);
    expect(resolved.lastGoodUpdates).toHaveLength(0);
  });

  it("treats the freshness boundary as inclusive", () => {
    const atLimit = resolveMetrics(
      [candidate("usd_toman", 244800, "nerkh", FRESH_MAX_AGE_MIN * MINUTE)],
      {},
      null,
      FIXTURE_NOW,
    );
    expect(atLimit.metrics.usd_toman.stale).toBe(false);
    const overLimit = resolveMetrics(
      [candidate("usd_toman", 244800, "nerkh", FRESH_MAX_AGE_MIN * MINUTE + 1)],
      {},
      null,
      FIXTURE_NOW,
    );
    expect(overLimit.metrics.usd_toman.stale).toBe(true);
  });

  it("cannot claim freshness without a timestamp", () => {
    const noTimestamp: Candidate = { metric: "usd_toman", value: 244800, source: "nerkh", updatedAtEpochSec: null, approximate: false };
    const resolved = resolveMetrics([noTimestamp], {}, null, FIXTURE_NOW);
    expect(resolved.metrics.usd_toman.stale).toBe(true);
    expect(resolved.warnings.some((warning) => warning.includes("without a timestamp"))).toBe(true);
  });

  it("competes last_good against live stale candidates by newest timestamp", () => {
    const live = [candidate("usd_toman", 244000, "navasan", 10 * 3600)];
    const olderLastGood = map(lastGoodEntry("usd_toman", 243000, "nerkh", 20 * 3600));
    const newerLastGood = map(lastGoodEntry("usd_toman", 243500, "nerkh", 5 * 3600));
    expect(resolveMetrics(live, olderLastGood, null, FIXTURE_NOW).metrics.usd_toman.source).toBe("navasan");
    const withNewer = resolveMetrics(live, newerLastGood, null, FIXTURE_NOW).metrics.usd_toman;
    expect(withNewer.source).toBe("nerkh");
    expect(withNewer.value).toBe(243500);
    expect(withNewer.stale).toBe(true);
  });

  it("returns N/A for everything when there is no candidate and no last_good", () => {
    const resolved = resolveMetrics([], {}, null, FIXTURE_NOW);
    for (const metric of Object.keys(resolved.metrics) as MetricName[]) {
      expect(resolved.metrics[metric].value).toBeNull();
      expect(resolved.metrics[metric].source).toBeNull();
      expect(resolved.metrics[metric].stale).toBe(false);
    }
    expect(resolved.usedSources).toHaveLength(0);
  });

  it("lists the sources actually used in a stable order", () => {
    expect(resolveMetrics(allCandidates(), {}, 249601, FIXTURE_NOW).usedSources).toEqual(["nerkh", "megaweb"]);
  });

  it("follows BTC_SOURCE_ORDER and falls back to the derived value", () => {
    expect(resolveMetrics(allCandidates(), {}, 249601, FIXTURE_NOW).metrics.btc_usd.source).toBe("megaweb");
    const withoutMegaweb = allCandidates().filter((item) => item.source !== "megaweb");
    expect(resolveMetrics(withoutMegaweb, {}, 249601, FIXTURE_NOW).metrics.btc_usd.source).toBe("nerkh");
  });
});

describe("sanity guards", () => {
  it("rejects a candidate that deviates more than 30% from last_good", () => {
    const lastGood = map(lastGoodEntry("coin_bahar_toman", 243500000, "nerkh", 3600));
    const verdict = checkCandidate(candidate("coin_bahar_toman", 2430000, "nerkh", 60), context({ lastGood }));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("deviation");
  });

  it("accepts 29.9% deviation and rejects 30.1%", () => {
    const lastGood = map(lastGoodEntry("ounce_usd", 100000, "nerkh", 3600));
    expect(checkCandidate(candidate("ounce_usd", 129900, "nerkh", 60), context({ lastGood })).ok).toBe(true);
    expect(checkCandidate(candidate("ounce_usd", 130100, "nerkh", 60), context({ lastGood })).ok).toBe(false);
  });

  it("requires coin_emami_toman / gold18_toman to stay between 5 and 15", () => {
    const ctx = context({ gold18Reference: 24835000 });
    expect(checkCandidate(candidate("coin_emami_toman", 250100000, "nerkh", 60), ctx).ok).toBe(true);
    expect(checkCandidate(candidate("coin_emami_toman", 250100, "nerkh", 60), ctx).ok).toBe(false);
    expect(checkCandidate(candidate("coin_emami_toman", 2501000000, "nerkh", 60), ctx).ok).toBe(false);
  });

  it("requires usdt_toman / usd_toman to stay between 0.9 and 1.15", () => {
    expect(checkCandidate(candidate("usd_toman", 244800, "nerkh", 60), context({ usdtReference: 249601 })).ok).toBe(true);
    expect(checkCandidate(candidate("usd_toman", 244800, "nerkh", 60), context({ usdtReference: 24480000 })).ok).toBe(false);
    expect(
      checkCandidate(candidate("usd_toman", 249950, "zipodo", 60, true), context({ usdtReference: 100 })).ok,
    ).toBe(true);
  });

  it("keeps the only candidate when sanity rejects it, and logs a warning", () => {
    const lastGood = map(lastGoodEntry("usd_toman", 100000, "nerkh", 3600));
    const resolved = resolveMetrics([candidate("usd_toman", 244800, "nerkh", 60)], lastGood, null, FIXTURE_NOW);
    expect(resolved.metrics.usd_toman.value).toBe(244800);
    expect(resolved.warnings.some((warning) => warning.includes("usd_toman"))).toBe(true);
  });

  it("computes the informational percentage difference", () => {
    expect(percentDifference(244800, 249601)).toBeCloseTo(1.96, 2);
    expect(percentDifference(0, 100)).toBeNull();
  });
});
