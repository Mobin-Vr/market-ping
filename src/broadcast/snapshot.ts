import {
  MESSAGE_MAX_DISPLAY_LINES,
  ON_DEMAND_MAX_AGE_HOURS,
  ON_DEMAND_REFRESH_MIN_GAP_SEC,
  SETTING_LAST_REFRESH_AT,
} from "../config";
import { getLastGood, saveLastGood } from "../db/lastGood";
import { getSetting, setSetting } from "../db/settings";
import { getLatestSnapshot, htmlForLang, insertSnapshot, type SnapshotRow } from "../db/snapshots";
import { t, type Lang } from "../i18n";
import { logEvent } from "../log";
import { countDisplayLines, renderMessage } from "../render/message";
import { resolveMetrics, type ResolveResult } from "../resolve/resolver";
import { fetchAllSources, pickUsdtHelper, type FetchAllResult } from "../sources/fetchAll";
import { hourKey as computeHourKey } from "../time";
import type { Env, ResolvedMetrics, SourceName } from "../types";

const HOUR_SEC = 3600;

export interface PriceCycle {
  fetchResult: FetchAllResult;
  resolved: ResolveResult;
}

/**
 * One full price cycle: fetch all four sources in parallel, resolve them (priority,
 * freshness, last_good fallback, sanity guards) and persist the fresh selections.
 * Called by the hourly cron, by the explicit admin actions (Send now, API health) and by the
 * guarded emergency refresh of the on-demand path - never once per user.
 */
export async function collectPriceCycle(env: Env, nowEpochSec: number): Promise<PriceCycle> {
  const fetchResult = await fetchAllSources(env, nowEpochSec);
  const lastGood = await getLastGood(env.DB);
  const usdtHelper = pickUsdtHelper(fetchResult.extractions);
  const resolved = resolveMetrics(fetchResult.candidates, lastGood, usdtHelper?.value ?? null, nowEpochSec);
  if (resolved.lastGoodUpdates.length > 0) {
    await saveLastGood(env.DB, resolved.lastGoodUpdates);
  }
  for (const warning of resolved.warnings) {
    logEvent("sanity.warning", { detail: warning });
  }
  return { fetchResult, resolved };
}

/** True when at least one metric resolved to a value (stale values are still data). */
export function hasAnyValue(metrics: ResolvedMetrics): boolean {
  return Object.values(metrics).some((item) => item.value !== null);
}

export interface StoredSnapshot {
  id: number;
  /** English copy (also stored in message_html for backward compatibility). */
  htmlEn: string;
  htmlFa: string;
  createdAt: number;
}

/**
 * Renders and stores one snapshot in both languages (data_json stays the source of truth).
 * message_html keeps the English copy so older queue messages and code paths still work.
 */
export async function storeSnapshot(
  env: Env,
  nowEpochSec: number,
  hourKey: string,
  metrics: ResolvedMetrics,
  sources: readonly SourceName[],
): Promise<StoredSnapshot> {
  const data = {
    hourKey,
    createdAt: nowEpochSec,
    metrics,
    sources: [...sources],
  };
  const htmlEn = renderMessage(data, "en");
  const htmlFa = renderMessage(data, "fa");
  const id = await insertSnapshot(env.DB, {
    createdAt: nowEpochSec,
    hourKey,
    messageHtml: htmlEn,
    htmlFa,
    htmlEn,
    dataJson: JSON.stringify(data),
  });
  return { id, htmlEn, htmlFa, createdAt: nowEpochSec };
}

export interface SnapshotForUser {
  id: number;
  html: string;
  createdAt: number;
  /** true when this call actually refreshed the data. */
  refreshed: boolean;
}

function ageOf(row: SnapshotRow, nowEpochSec: number): number {
  return Math.max(0, nowEpochSec - row.created_at);
}

/** Still worth serving as is: the message carries its own date/time. */
function isServable(row: SnapshotRow, nowEpochSec: number): boolean {
  return ageOf(row, nowEpochSec) <= ON_DEMAND_MAX_AGE_HOURS * HOUR_SEC;
}

/**
 * Adds the "🕒 Last update" note in the user's language. It counts towards the message
 * budget: when the stored message already uses every display line, the note is folded into
 * the last line instead of adding a 21st.
 */
function withLastUpdateLine(
   html: string,
   createdAtEpochSec: number,
   nowEpochSec: number,
   lang: Lang,
): string {
   const line = t(lang).lastUpdateLine(createdAtEpochSec, nowEpochSec);
   const appended = `${html}\n${line}`;
   if (countDisplayLines(appended) <= MESSAGE_MAX_DISPLAY_LINES) return appended;
   const lines = html.split("\n");
   const lastIndex = lines.length - 1;
   lines[lastIndex] = `${lines[lastIndex] ?? ""} ${line}`;
   return lines.join("\n");
}

function asForUser(
   row: SnapshotRow,
   nowEpochSec: number,
   lang: Lang,
   refreshed: boolean,
): SnapshotForUser {
   return {
      id: row.id,
      html: withLastUpdateLine(htmlForLang(row, lang), row.created_at, nowEpochSec, lang),
      createdAt: row.created_at,
      refreshed,
   };
}

/**
 * The only emergency refresh of the on-demand path. The global last_refresh_at slot is
 * claimed before the APIs are touched, so at most one refresh happens per
 * ON_DEMAND_REFRESH_MIN_GAP_SEC however many users ask at the same moment.
 */
async function emergencyRefresh(env: Env, nowEpochSec: number): Promise<StoredSnapshot | null> {
  const lastRefreshRaw = await getSetting(env.DB, SETTING_LAST_REFRESH_AT);
  const lastRefresh = Number(lastRefreshRaw ?? 0);
  const gapSec = nowEpochSec - lastRefresh;
  if (Number.isFinite(lastRefresh) && lastRefresh > 0 && gapSec < ON_DEMAND_REFRESH_MIN_GAP_SEC) {
    logEvent("snapshot.refresh_suppressed", { ageSec: gapSec, minGapSec: ON_DEMAND_REFRESH_MIN_GAP_SEC });
    return null;
  }
  await setSetting(env.DB, SETTING_LAST_REFRESH_AT, String(nowEpochSec));
  const cycle = await collectPriceCycle(env, nowEpochSec);
  if (!hasAnyValue(cycle.resolved.metrics)) {
    logEvent("snapshot.refresh_no_data");
    return null;
  }
  const stored = await storeSnapshot(
    env,
    nowEpochSec,
    computeHourKey(nowEpochSec),
    cycle.resolved.metrics,
    cycle.resolved.usedSources,
  );
  logEvent("snapshot.refreshed", { snapshotId: stored.id });
  return stored;
}

/**
 * On-demand path for /price, "Get prices now" and the join flow.
 * The newest STORED snapshot (hourly or manual) is served exactly as stored, so the message
 * shows the snapshot's own date/time and the price APIs stay quiet - the hourly cron remains
 * their only regular caller. A single guarded refresh is attempted only when there is no
 * snapshot at all, or the newest one is older than ON_DEMAND_MAX_AGE_HOURS; if that refresh
 * fails or is suppressed, the older snapshot is served instead. Returns null only when
 * nothing can be shown.
 */
export async function getSnapshotForUser(
   env: Env,
   nowEpochSec: number,
   lang: Lang = 'en',
): Promise<SnapshotForUser | null> {
   const latest = await getLatestSnapshot(env.DB);
   if (latest && isServable(latest, nowEpochSec)) {
      logEvent("price_served", { source: "stored", snapshotAgeSec: ageOf(latest, nowEpochSec), lang });
      return asForUser(latest, nowEpochSec, lang, false);
   }

   const refreshed = await emergencyRefresh(env, nowEpochSec);
   if (refreshed) {
      logEvent("price_served", { source: "refreshed", snapshotAgeSec: 0, lang });
      return {
         id: refreshed.id,
         html: withLastUpdateLine(
            lang === 'fa' ? refreshed.htmlFa : refreshed.htmlEn,
            refreshed.createdAt,
            nowEpochSec,
            lang,
         ),
         createdAt: refreshed.createdAt,
         refreshed: true,
      };
   }

   if (latest) {
      logEvent("price_served", {
         source: "stored",
         snapshotAgeSec: ageOf(latest, nowEpochSec),
         refreshFailed: true,
         lang,
      });
      return asForUser(latest, nowEpochSec, lang, false);
   }

   logEvent("price_unavailable", { lang });
   return null;
}
