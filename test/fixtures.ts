import { expect } from "vitest";
import { CROSS_SOURCE_TOLERANCE_PCT, USD_CROSS_SOURCE_TOLERANCE_PCT } from "../src/config";
import { extractMegaweb } from "../src/sources/megaweb";
import { extractNavasan } from "../src/sources/navasan";
import { extractNerkh } from "../src/sources/nerkh";
import { extractZipodo } from "../src/sources/zipodo";
import type { SourceExtraction } from "../src/sources/common";
import type { Candidate, MetricName, SourceName } from "../src/types";
import megawebFixture from "../fixtures/megaweb.json";
import navasanFixture from "../fixtures/navasan.json";
import nerkhFixture from "../fixtures/nerkh.json";
import zipodoFixture from "../fixtures/zipodo.json";

/**
 * Real captured API responses with the keys removed (see M0). These committed fixtures are
 * the single source of truth for unit tests; the sample numbers in the original spec were
 * illustrative from an earlier capture.
 */
export const rawFixtures = {
  nerkh: nerkhFixture as unknown,
  navasan: navasanFixture as unknown,
  megaweb: megawebFixture as unknown,
  zipodo: zipodoFixture as unknown,
};

/** Capture instant of the fixtures (nerkh data.timestamp). */
export const FIXTURE_NOW = 1790665481;
/** 2026-09-28T17:28:50Z - the stale navasan usd_sell timestamp. */
export const FIXTURE_STALE_USD_SELL_AT = 1790616530;

export function allExtractions(nowEpochSec: number = FIXTURE_NOW): SourceExtraction[] {
  return [
    extractNerkh(rawFixtures.nerkh, nowEpochSec),
    extractNavasan(rawFixtures.navasan, nowEpochSec),
    extractMegaweb(rawFixtures.megaweb, nowEpochSec),
    extractZipodo(rawFixtures.zipodo, nowEpochSec),
  ];
}

export function allCandidates(nowEpochSec: number = FIXTURE_NOW): Candidate[] {
  return allExtractions(nowEpochSec).flatMap((extraction) => extraction.candidates);
}

export function findCandidate(
  candidates: readonly Candidate[],
  metric: MetricName,
  source: SourceName,
): number | null {
  const found = candidates.find((candidate) => candidate.metric === metric && candidate.source === source);
  return found ? found.value : null;
}

/** Percentage difference between two values relative to the larger one. */
export function diffPct(a: number, b: number): number {
  return (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b))) * 100;
}

function agree(label: string, a: number, b: number, tolerancePct: number): void {
  expect(diffPct(a, b), `${label}: ${a} vs ${b}`).toBeLessThanOrEqual(tolerancePct);
}

/**
 * The two Toman sources must agree after normalisation; if they do not, there is a unit bug
 * (a missing x1000 on Navasan coins, a stray x1000 elsewhere, ...).
 *
 * usd_toman uses the wider 3% tolerance because free-market USD providers legitimately
 * differ by 1-2% (different collection methods and update times) while 3% still catches
 * x10 / x1000 mistakes. Every other metric must agree within 1%.
 */
export function expectFixtureAgreement(candidates: readonly Candidate[]): void {
  for (const metric of [
    "ounce_usd",
    "gold18_toman",
    "coin_bahar_toman",
    "coin_emami_toman",
    "coin_half_toman",
    "coin_quarter_toman",
  ] as const) {
    const nerkh = findCandidate(candidates, metric, "nerkh");
    const navasan = findCandidate(candidates, metric, "navasan");
    expect(nerkh, `${metric} missing from nerkh`).not.toBeNull();
    expect(navasan, `${metric} missing from navasan`).not.toBeNull();
    agree(metric, nerkh as number, navasan as number, CROSS_SOURCE_TOLERANCE_PCT);
  }

  const nerkhUsd = findCandidate(candidates, "usd_toman", "nerkh") as number;
  const navasanUsd = findCandidate(candidates, "usd_toman", "navasan") as number;
  expect(nerkhUsd).toBeGreaterThan(0);
  expect(navasanUsd).toBeGreaterThan(0);
  agree("usd_toman", nerkhUsd, navasanUsd, USD_CROSS_SOURCE_TOLERANCE_PCT);

  const megawebBtc = findCandidate(candidates, "btc_usd", "megaweb") as number;
  agree("btc_usd nerkh vs megaweb", findCandidate(candidates, "btc_usd", "nerkh") as number, megawebBtc, CROSS_SOURCE_TOLERANCE_PCT);
  agree("btc_usd navasan vs megaweb", findCandidate(candidates, "btc_usd", "navasan") as number, megawebBtc, CROSS_SOURCE_TOLERANCE_PCT);
}
