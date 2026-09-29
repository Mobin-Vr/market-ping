import { emptyExtraction, makeCandidate, toPositiveNumber, type SourceExtraction } from "./common";

/**
 * Zipodo - USDT price in Toman. The payload has no timestamp, so the fetch time is used
 * and the value is marked approximate (USDT is not exactly USD). It is the LAST live
 * fallback for usd_toman, rendered with a "~" prefix and the "~ via USDT rate" footnote.
 */
export function extractZipodo(payload: unknown, fetchedAtEpochSec: number): SourceExtraction {
  const out = emptyExtraction("zipodo");
  const price = toPositiveNumber((payload as { price?: unknown } | null)?.price);
  if (price === null) {
    out.shapeError = "missing price";
    return out;
  }
  out.candidates.push(makeCandidate("usd_toman", price, "zipodo", fetchedAtEpochSec, true));
  out.usdtToman = price;
  out.usdtUpdatedAtEpochSec = fetchedAtEpochSec;
  out.usdtApproximate = true;
  return out;
}
