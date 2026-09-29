import { emptyExtraction, makeCandidate, toPositiveNumber, type SourceExtraction } from "./common";

interface MegawebItem {
  symbol?: string;
  /** USD, decimal string. */
  price_usd?: string | number;
}

interface MegawebPayload {
  data?: MegawebItem[];
  info?: { time?: number };
}

/**
 * Megaweb - used ONLY for btc_usd, because it is the only source that returns USD
 * directly (about 100 coins are returned; only the BTC entry is read).
 */
export function extractMegaweb(payload: unknown, fetchedAtEpochSec: number): SourceExtraction {
  const root = (payload ?? {}) as MegawebPayload;
  if (!Array.isArray(root.data)) return emptyExtraction("megaweb", "missing data array");

  const out = emptyExtraction("megaweb");
  const btc = root.data.find((item) => item?.symbol === "BTC");
  const value = toPositiveNumber(btc?.price_usd);
  if (value === null) {
    out.shapeError = "BTC entry not found";
    return out;
  }
  const updatedAt =
    typeof root.info?.time === "number" && Number.isFinite(root.info.time)
      ? Math.floor(root.info.time)
      : fetchedAtEpochSec;
  out.candidates.push(makeCandidate("btc_usd", value, "megaweb", updatedAt));
  return out;
}
