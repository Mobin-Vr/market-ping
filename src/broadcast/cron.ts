import { SNAPSHOT_RETENTION_DAYS } from "../config";
import { claimBroadcast, setBroadcastStatus } from "../db/broadcastLog";
import { isServiceEnabled } from "../db/settings";
import { pruneSnapshots } from "../db/snapshots";
import { listSubscribedTargets, type BroadcastTarget } from "../db/users";
import { t } from "../i18n";
import { errorName, logEvent } from "../log";
import { parseAdminIds } from "../security";
import { tgSendMessage } from "../telegram/api";
import { hourKey as computeHourKey, isWithinSendHours, tehranHour } from "../time";
import type { Env } from "../types";
import { buildQueueMessagesByLang, splitSendBatches } from "./chunk";
import { collectPriceCycle, hasAnyValue, storeSnapshot } from "./snapshot";

const DAY_SEC = 86_400;

export interface BroadcastPlan {
  recipients: number;
  chunks: number;
  batches: number;
  faChunks: number;
  enChunks: number;
}

/** One chunk message per language chunk, at most 100 queue messages per sendBatch call. */
export async function enqueueBroadcast(
  env: Env,
  hourKey: string,
  snapshotId: number,
  targets: readonly BroadcastTarget[],
): Promise<BroadcastPlan> {
  const messages = buildQueueMessagesByLang(snapshotId, hourKey, targets);
  const batches = splitSendBatches(messages);
  for (const batch of batches) {
    await env.BROADCAST_QUEUE.sendBatch(batch.map((body) => ({ body })));
  }
  const plan: BroadcastPlan = {
    recipients: targets.length,
    chunks: messages.length,
    batches: batches.length,
    faChunks: messages.filter((message) => message.lang === "fa").length,
    enChunks: messages.filter((message) => message.lang === "en").length,
  };
  logEvent("broadcast.enqueued", { hourKey, snapshotId, ...plan });
  return plan;
}

async function alertAdmins(env: Env, text: string): Promise<void> {
  for (const chatId of parseAdminIds(env.ADMIN_IDS)) {
    await tgSendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
  }
}

/**
 * Hourly cron run: Tehran-hour guard, idempotent hour claim, price cycle, snapshot, chunked
 * enqueue and snapshot pruning. Partial data (some N/A or stale values) is still broadcast;
 * only a completely empty cycle is skipped and reported to the admins.
 */
export async function handleScheduled(env: Env, scheduledTimeMs: number): Promise<void> {
  const now = Math.floor(scheduledTimeMs / 1000);
  if (!isWithinSendHours(now)) {
    logEvent("cron.outside_window", { hour: tehranHour(now) });
    return;
  }
  if (!(await isServiceEnabled(env.DB))) {
    logEvent("cron.service_off");
    return;
  }

  const key = computeHourKey(now);
  const targets = await listSubscribedTargets(env.DB);
  if (!(await claimBroadcast(env.DB, key, now, targets.length))) {
    logEvent("cron.already_claimed", { hourKey: key });
    return;
  }
  if (targets.length === 0) {
    await setBroadcastStatus(env.DB, key, "done");
    logEvent("cron.no_subscribers", { hourKey: key });
    return;
  }

  try {
    const cycle = await collectPriceCycle(env, now);
    if (!hasAnyValue(cycle.resolved.metrics)) {
      await setBroadcastStatus(env.DB, key, "skipped");
      logEvent("cron.skipped_no_data", { hourKey: key, recipients: targets.length });
      await alertAdmins(env, t("en").allSourcesFailedText(now));
      return;
    }
    const snapshot = await storeSnapshot(env, now, key, cycle.resolved.metrics, cycle.resolved.usedSources);
    await enqueueBroadcast(env, key, snapshot.id, targets);
    const pruned = await pruneSnapshots(env.DB, now - SNAPSHOT_RETENTION_DAYS * DAY_SEC);
    logEvent("cron.done", { hourKey: key, recipients: targets.length, pruned });
  } catch (err) {
    // The hour stays claimed and visible as pending in the admin panel.
    logEvent("cron.failed", { hourKey: key, error: errorName(err) });
    throw err;
  }
}
