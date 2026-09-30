import type { Lang, MetricName, SourceName } from "./types";

/** Tehran is UTC+03:30 all year (no DST). Defined once and used everywhere. */
export const TEHRAN_OFFSET_MIN = 210;

/** Send window: every hour from 09:00 to 21:00 Tehran (13 messages/day, inclusive). */
export const SEND_HOUR_FIRST = 9;
export const SEND_HOUR_LAST = 21;

/** The single cron trigger: 05:30..17:30 UTC == 09:00..21:00 Tehran. */
export const CRON_EXPRESSION = "30 5-17 * * *";

/** Freshness, networking. */
export const FRESH_MAX_AGE_MIN = 180;
export const FETCH_TIMEOUT_MS = 8000;
export const FETCH_RETRIES = 1;

/** Queue fan-out. */
export const QUEUE_NAME = "market-ping-broadcast";
export const CHUNK_SIZE = 15;
/** Cloudflare Queues allows at most 100 messages per sendBatch call. */
export const QUEUE_MAX_MESSAGES_PER_SEND_BATCH = 100;
/** Hard cap: 1 initial + 2 re-enqueues. */
export const QUEUE_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_AFTER_SEC = 5;

/** Per-user manual /price cooldown and snapshot retention. */
export const MANUAL_COOLDOWN_SEC = 60;
export const SNAPSHOT_RETENTION_DAYS = 3;

/**
 * On-demand serving. The newest STORED snapshot (hourly or manual) is served exactly as it was
 * stored - including its own date/time - so the hourly cron stays the only regular caller of
 * the price APIs. Only when there is no snapshot at all, or the newest one is older than
 * ON_DEMAND_MAX_AGE_HOURS, is the pipeline used once, guarded globally by
 * ON_DEMAND_REFRESH_MIN_GAP_SEC so a burst of users cannot cause a burst of API calls.
 */
export const ON_DEMAND_MAX_AGE_HOURS = 24;
export const ON_DEMAND_REFRESH_MIN_GAP_SEC = 600;

/** Hard cap for one rendered message, blank lines included (see src/render/message.ts). */
export const MESSAGE_MAX_DISPLAY_LINES = 26;

/** Price-message categories in display order. Reorder to change the layout. */
export type PriceCategory = "currency" | "goldCoins" | "crypto";
export const CATEGORY_ORDER: readonly PriceCategory[] = ["currency", "goldCoins", "crypto"];

/**
 * Persian message style: "blockquote" (default, one quote per category) or
 * "pre" (monospace fallback, same rows inside <pre> blocks).
 */
export const FA_LAYOUT: "blockquote" | "pre" = "blockquote";

/**
 * Row groups inside the Gold & Coins block, separated by exactly one blank line.
 * Both languages use the same grouping: ounce, gold18, then the four coins.
 * Right-alignment still uses one common width across the whole block, so the blank
 * separator lines never affect the columns. Reorder or regroup here only.
 */
export const GOLD_COIN_ROW_GROUPS: Record<Lang, readonly (readonly MetricName[])[]> = {
  en: [
    ["ounce_usd"],
    ["gold18_toman"],
    ["coin_quarter_toman", "coin_half_toman", "coin_bahar_toman", "coin_emami_toman"],
  ],
  fa: [
    ["ounce_usd"],
    ["gold18_toman"],
    ["coin_quarter_toman", "coin_half_toman", "coin_bahar_toman", "coin_emami_toman"],
  ],
};

/** BTC (USD) source order: megaweb is the only source that returns USD directly. */
export const BTC_SOURCE_ORDER: readonly SourceName[] = ["megaweb", "nerkh", "navasan"];

/** Sanity guards. */
export const MAX_DEVIATION_PCT = 30;
/** coin_emami_toman / gold18_toman must be inside this range (catches thousand-Toman mistakes). */
export const COIN_TO_GOLD18_MIN_RATIO = 5;
export const COIN_TO_GOLD18_MAX_RATIO = 15;
/** usdt_toman / usd_toman must be inside this range. */
export const USDT_TO_USD_MIN_RATIO = 0.9;
export const USDT_TO_USD_MAX_RATIO = 1.15;
/**
 * Cross-source agreement tolerances. These are INFORMATIONAL only (unit tests and the
 * admin health panel hint). They never influence value selection: priority order and
 * freshness decide the value. 3% for usd_toman because free-market USD providers
 * legitimately differ by 1-2% (different collection methods and update times), while
 * 3% still catches unit mistakes such as x10 / x1000.
 */
export const CROSS_SOURCE_TOLERANCE_PCT = 1;
export const USD_CROSS_SOURCE_TOLERANCE_PCT = 3;

/** Metrics that must agree within 1% across sources (everything except usd_toman). */
export const STRICT_AGREEMENT_METRICS = [
  "ounce_usd",
  "gold18_toman",
  "coin_bahar_toman",
  "coin_emami_toman",
  "coin_half_toman",
  "coin_quarter_toman",
  "btc_usd",
] as const;

/** settings table keys. */
export const SETTING_SERVICE_ENABLED = "service_enabled";
export const SETTING_LAST_REFRESH_AT = "last_refresh_at";

/** Inline keyboard callback data (validated against this allow-list). */
export const CALLBACK_DATA = {
  join: "join",
  leave: "leave",
  price: "price",
  langFa: "lang:fa",
  langEn: "lang:en",
  adminOn: "admin:on",
  adminOff: "admin:off",
  adminSend: "admin:send",
  adminSendYes: "admin:send:yes",
  adminSendNo: "admin:send:no",
  adminHealth: "admin:health",
  adminRefresh: "admin:refresh",
} as const;

export const CALLBACK_ALLOWLIST: readonly string[] = Object.values(CALLBACK_DATA);

export const WEBHOOK_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
export const WEBHOOK_PATH_PREFIX = "/telegram/";
