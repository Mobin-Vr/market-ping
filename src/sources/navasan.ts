import type { MetricName } from "../types";
import { emptyExtraction, makeCandidate, toPositiveNumber, type SourceExtraction } from "./common";

interface NavasanEntry {
  value?: string | number;
  /** unix seconds, per key (some keys are hours, months or years stale). */
  timestamp?: number;
  date?: string;
}

/** Coins are quoted in THOUSAND Toman on this source. */
const THOUSAND = 1000;

const COIN_KEYS: ReadonlyArray<readonly [string, MetricName]> = [
  ["sekkeh", "coin_emami_toman"],
  ["bahar", "coin_bahar_toman"],
  ["nim", "coin_half_toman"],
  ["rob", "coin_quarter_toman"],
];

/**
 * Navasan (second source). Freshness must be evaluated per key from its own timestamp.
 * Deliberately ignores bub_* (bubble values), xau (Toman, not USD), mob_*, mex_*, harat_*,
 * usd_btc / usd_eth / usd_xrp (Toman despite the name), usd_shakhs, usd_sherkat, usd_pp,
 * gerami, abshodeh and cad_cash.
 */
export function extractNavasan(payload: unknown, fetchedAtEpochSec: number): SourceExtraction {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return emptyExtraction("navasan", "payload is not an object");
  }
  const rows = payload as Record<string, NavasanEntry>;
  const out = emptyExtraction("navasan");

  const read = (key: string): { value: number; updatedAt: number } | null => {
    const entry = rows[key];
    const value = toPositiveNumber(entry?.value);
    if (value === null) return null;
    const updatedAt =
      typeof entry?.timestamp === "number" && Number.isFinite(entry.timestamp)
        ? Math.floor(entry.timestamp)
        : fetchedAtEpochSec;
    return { value, updatedAt };
  };

  const add = (metric: MetricName, key: string, multiplier = 1): void => {
    const entry = read(key);
    if (entry) out.candidates.push(makeCandidate(metric, entry.value * multiplier, "navasan", entry.updatedAt));
  };

  add("usd_toman", "usd_sell");
  add("ounce_usd", "usd_xau");
  add("gold18_toman", "18ayar");
  for (const [key, metric] of COIN_KEYS) add(metric, key, THOUSAND);

  const btc = read("btc");
  const usdt = read("usdt");
  if (btc && usdt) {
    out.candidates.push(
      makeCandidate("btc_usd", btc.value / usdt.value, "navasan", Math.min(btc.updatedAt, usdt.updatedAt)),
    );
  }
  if (usdt) {
    out.usdtToman = usdt.value;
    out.usdtUpdatedAtEpochSec = usdt.updatedAt;
  }

  if (out.candidates.length === 0) out.shapeError = "no usable keys";
  return out;
}
