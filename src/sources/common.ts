import type { Candidate, MetricName, SourceName } from "../types";

/**
 * Result of running one source extractor over one API response.
 * `usdtToman` is an internal helper metric (USDT price in Toman) used only by the
 * usdt/usd sanity guard - it is never displayed to users.
 */
export interface SourceExtraction {
  source: SourceName;
  candidates: Candidate[];
  usdtToman: number | null;
  usdtUpdatedAtEpochSec: number | null;
  usdtApproximate: boolean;
  /** Set when the payload could not be read at all (useful for the health panel). */
  shapeError: string | null;
}

/** Number(str) with NaN/Infinity/<=0 rejected. */
export function toPositiveNumber(raw: unknown): number | null {
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function emptyExtraction(source: SourceName, shapeError: string | null = null): SourceExtraction {
  return {
    source,
    candidates: [],
    usdtToman: null,
    usdtUpdatedAtEpochSec: null,
    usdtApproximate: false,
    shapeError,
  };
}

export function makeCandidate(
  metric: MetricName,
  value: number,
  source: SourceName,
  updatedAtEpochSec: number | null,
  approximate = false,
): Candidate {
  return { metric, value, source, updatedAtEpochSec, approximate };
}
