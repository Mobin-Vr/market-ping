import type { MetricName } from "./types";

export interface MetricLabel {
  /** Display label, exactly as it must appear to users. */
  label: string;
  metric: MetricName;
  /** true = USD value ($ prefix), false = Toman value (T suffix). */
  usd: boolean;
}

/**
 * Single source of truth for metric labels, their order and their units.
 * Reused by the hourly broadcast message (src/render/message.ts) and by the admin
 * API-health "Resolved" block (src/admin/health.ts), so both always agree.
 */
export const METRIC_LABELS: readonly MetricLabel[] = [
  { label: "USD", metric: "usd_toman", usd: false },
  { label: "Bitcoin", metric: "btc_usd", usd: true },
  { label: "Gold Ounce", metric: "ounce_usd", usd: true },
  { label: "Tala Garam", metric: "gold18_toman", usd: false },
  { label: "Rob Seke", metric: "coin_quarter_toman", usd: false },
  { label: "Nim Seke", metric: "coin_half_toman", usd: false },
  { label: "Tamam Seke", metric: "coin_bahar_toman", usd: false },
  { label: "Emami", metric: "coin_emami_toman", usd: false },
];

/**
 * Section membership of the hourly message. Labels and ordering always come from
 * METRIC_LABELS, so a section keeps the shared order.
 *
 * NOTE: the user message groups metrics as Currency -> Gold & Coins -> Crypto
 * (CURRENCY_METRICS / GOLD_COINS_METRICS / CRYPTO_METRICS, driven by
 * CATEGORY_ORDER in src/config.ts). The admin API-health "Resolved" block
 * intentionally keeps the flat METRIC_LABELS order - it is diagnostics, not the
 * user layout - so the two orders diverge on purpose.
 */
export const RATE_METRICS: readonly MetricName[] = ["usd_toman", "btc_usd", "ounce_usd"];
export const GOLD_METRICS: readonly MetricName[] = ["gold18_toman"];
export const COIN_METRICS: readonly MetricName[] = [
  "coin_quarter_toman",
  "coin_half_toman",
  "coin_bahar_toman",
  "coin_emami_toman",
];

/** Currency category: USD only. */
export const CURRENCY_METRICS: readonly MetricName[] = ["usd_toman"];
/** Gold & Coins category: ounce, gram + four coins, in this row order. */
export const GOLD_COINS_METRICS: readonly MetricName[] = [
  "ounce_usd",
  "gold18_toman",
  "coin_quarter_toman",
  "coin_half_toman",
  "coin_bahar_toman",
  "coin_emami_toman",
];
/** Crypto category: Bitcoin only. */
export const CRYPTO_METRICS: readonly MetricName[] = ["btc_usd"];

/** Rows of one section, in the shared METRIC_LABELS order. */
export function rowsFor(metrics: readonly MetricName[]): readonly MetricLabel[] {
  return METRIC_LABELS.filter((row) => metrics.includes(row.metric));
}

export function labelFor(metric: MetricName): string {
  const row = METRIC_LABELS.find((item) => item.metric === metric);
  return row ? row.label : metric;
}

export function isUsdMetric(metric: MetricName): boolean {
  const row = METRIC_LABELS.find((item) => item.metric === metric);
  return row ? row.usd : false;
}
