import { jalaliToEpochSec } from "../time";
import type { MetricName } from "../types";
import { emptyExtraction, makeCandidate, toPositiveNumber, type SourceExtraction } from "./common";

interface NerkhEntry {
  current?: string | number;
  /** Jalali string in Tehran local time, e.g. "1405-07-07 11:12:52". */
  update?: string;
}

interface NerkhData {
  timestamp?: number;
  gold?: Record<string, NerkhEntry>;
  currency?: Record<string, NerkhEntry>;
  crypto?: Record<string, NerkhEntry>;
}

/** Every Iranian value from this source is already Toman; OUNCE is USD. */
const GOLD_METRICS: ReadonlyArray<readonly [string, MetricName]> = [
  ["OUNCE", "ounce_usd"],
  ["GOLD18K", "gold18_toman"],
  ["SEKE_BAHAR", "coin_bahar_toman"],
  ["SEKE_EMAMI", "coin_emami_toman"],
  ["SEKE_NIM", "coin_half_toman"],
  ["SEKE_ROB", "coin_quarter_toman"],
];

function readEntry(
  entry: NerkhEntry | undefined,
  fallbackUpdatedAt: number,
): { value: number; updatedAt: number } | null {
  const value = toPositiveNumber(entry?.current);
  if (value === null) return null;
  const updatedAt =
    typeof entry?.update === "string" ? (jalaliToEpochSec(entry.update) ?? fallbackUpdatedAt) : fallbackUpdatedAt;
  return { value, updatedAt };
}

/**
 * Nerkh (primary source). data.gold.<KEY>, data.currency.<KEY>, data.crypto.<KEY>.
 * Deliberately ignores GOLD18K_STOCK, MILLI_GOLD18K, TALASEA_GOLD_18K, TECHNOGOLD_GOLD_18K,
 * GOLD_FUTURES, GOLD24K, MAZANEH, MESGHAL, SEKE_1G, SEKE_PRS*, OUNCE_PLATINUM, OUNCE_SILVER.
 */
export function extractNerkh(payload: unknown, fetchedAtEpochSec: number): SourceExtraction {
  const root = (payload ?? {}) as { data?: NerkhData };
  const data = root.data;
  if (!data || typeof data !== "object") return emptyExtraction("nerkh", "missing data object");

  const out = emptyExtraction("nerkh");
  const fallbackUpdatedAt =
    typeof data.timestamp === "number" && Number.isFinite(data.timestamp)
      ? Math.floor(data.timestamp)
      : fetchedAtEpochSec;

  const usd = readEntry(data.currency?.USD, fallbackUpdatedAt);
  if (usd) out.candidates.push(makeCandidate("usd_toman", usd.value, "nerkh", usd.updatedAt));

  for (const [key, metric] of GOLD_METRICS) {
    const entry = readEntry(data.gold?.[key], fallbackUpdatedAt);
    if (entry) out.candidates.push(makeCandidate(metric, entry.value, "nerkh", entry.updatedAt));
  }

  const btc = readEntry(data.crypto?.BTC, fallbackUpdatedAt);
  const usdt = readEntry(data.crypto?.USDT, fallbackUpdatedAt);
  if (btc && usdt) {
    // Derived: both values are Toman, so the ratio is USD.
    out.candidates.push(
      makeCandidate("btc_usd", btc.value / usdt.value, "nerkh", Math.min(btc.updatedAt, usdt.updatedAt)),
    );
  }
  if (usdt) {
    out.usdtToman = usdt.value;
    out.usdtUpdatedAtEpochSec = usdt.updatedAt;
  }

  if (out.candidates.length === 0) out.shapeError = "no usable keys";
  return out;
}
