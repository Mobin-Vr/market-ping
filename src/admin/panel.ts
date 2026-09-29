import { enqueueBroadcast } from "../broadcast/cron";
import { collectPriceCycle, hasAnyValue, storeSnapshot } from "../broadcast/snapshot";
import { CALLBACK_DATA } from "../config";
import { claimBroadcast, getLatestBroadcast, setBroadcastStatus, type BroadcastLogRow } from "../db/broadcastLog";
import { isServiceEnabled, setServiceEnabled } from "../db/settings";
import { countSubscribers, listSubscribedTargets } from "../db/users";
import { t } from "../i18n";
import { logEvent } from "../log";
import { escapeHtml } from "../render/format";
import { parseAdminIds } from "../security";
import { formatTehranShort, nowSec } from "../time";
import type { Env, InlineKeyboardMarkup, TgCallbackQuery } from "../types";
import { editOrSend, tgSendMessage } from "../telegram/api";
import { renderHealthPanel } from "./health";

export interface AdminPanelData {
  serviceEnabled: boolean;
  subscribers: number;
  lastBroadcast: BroadcastLogRow | null;
}

export async function loadAdminPanelData(env: Env): Promise<AdminPanelData> {
  const [serviceEnabled, subscribers, lastBroadcast] = await Promise.all([
    isServiceEnabled(env.DB),
    countSubscribers(env.DB),
    getLatestBroadcast(env.DB),
  ]);
  return { serviceEnabled, subscribers, lastBroadcast };
}

/** "Last broadcast: 7 Mehr 1405 10:00 Tehran - sent 40, blocked 1, failed 1" */
function lastBroadcastLine(row: BroadcastLogRow | null): string {
  if (!row) return `Last broadcast: ${t("en").adminLastBroadcastNone}`;
  const when = `${formatTehranShort(row.started_at)} Tehran`;
  const counters = `sent ${row.sent}, blocked ${row.blocked}, failed ${row.failed}`;
  const status = row.status === "done" ? "" : ` [${row.status}]`;
  return `Last broadcast: ${when} - ${counters}${status}`;
}

export function renderAdminPanel(data: AdminPanelData): string {
  return [
    t("en").adminTitle,
    `Service: <b>${data.serviceEnabled ? "ON" : "OFF"}</b>`,
    `Subscribers: ${data.subscribers}`,
    escapeHtml(lastBroadcastLine(data.lastBroadcast)),
  ].join("\n");
}

export function adminPanelKeyboard(serviceEnabled: boolean): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        serviceEnabled
          ? { text: t("en").adminButtonOff, callback_data: CALLBACK_DATA.adminOff }
          : { text: t("en").adminButtonOn, callback_data: CALLBACK_DATA.adminOn },
      ],
      [{ text: t("en").adminButtonSend, callback_data: CALLBACK_DATA.adminSend }],
      [
        { text: t("en").adminButtonHealth, callback_data: CALLBACK_DATA.adminHealth },
        { text: t("en").adminButtonRefresh, callback_data: CALLBACK_DATA.adminRefresh },
      ],
    ],
  };
}

export function sendConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: t("en").adminButtonYes, callback_data: CALLBACK_DATA.adminSendYes },
        { text: t("en").adminButtonCancel, callback_data: CALLBACK_DATA.adminSendNo },
      ],
    ],
  };
}

/** Sends a fresh panel (the /admin command). */
export async function sendAdminPanel(env: Env, chatId: number): Promise<void> {
  const data = await loadAdminPanelData(env);
  await tgSendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    renderAdminPanel(data),
    adminPanelKeyboard(data.serviceEnabled),
  );
}

async function refreshPanel(env: Env, chatId: number, messageId: number | null): Promise<AdminPanelData> {
  const data = await loadAdminPanelData(env);
  await editOrSend(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    messageId,
    renderAdminPanel(data),
    adminPanelKeyboard(data.serviceEnabled),
  );
  return data;
}

export interface ManualBroadcastResult {
  recipients: number;
  chunks: number;
  /** true when nothing was sent (no subscribers or no price data). */
  skipped: boolean;
  reason: "none" | "no_subscribers" | "no_data";
}

/**
 * Manual broadcast (admin "Send now"): the normal broadcast pipeline, logged under its own
 * key so the hourly idempotency claim is left untouched. Works at any time of day, but only
 * while the service is ON (the caller checks that first).
 */
export async function runManualBroadcast(env: Env, nowEpochSec: number): Promise<ManualBroadcastResult> {
  const key = `manual-${nowEpochSec}`;
  const targets = await listSubscribedTargets(env.DB);
  await claimBroadcast(env.DB, key, nowEpochSec, targets.length);

  if (targets.length === 0) {
    await setBroadcastStatus(env.DB, key, "done");
    logEvent("manual.no_subscribers", { key });
    return { recipients: 0, chunks: 0, skipped: true, reason: "no_subscribers" };
  }

  const cycle = await collectPriceCycle(env, nowEpochSec);
  if (!hasAnyValue(cycle.resolved.metrics)) {
    await setBroadcastStatus(env.DB, key, "skipped");
    logEvent("manual.no_data", { key, recipients: targets.length });
    return { recipients: targets.length, chunks: 0, skipped: true, reason: "no_data" };
  }

  const snapshot = await storeSnapshot(env, nowEpochSec, key, cycle.resolved.metrics, cycle.resolved.usedSources);
  const plan = await enqueueBroadcast(env, key, snapshot.id, targets);
  logEvent("manual.done", { key, recipients: plan.recipients, chunks: plan.chunks });
  return { recipients: plan.recipients, chunks: plan.chunks, skipped: false, reason: "none" };
}

/**
 * Admin panel callbacks. Returns an optional toast for answerCallbackQuery.
 * Non-admins get no response at all.
 */
export async function handleAdminCallback(
  env: Env,
  query: TgCallbackQuery,
  data: string,
): Promise<string | null> {
  const chatId = query.message?.chat.id ?? query.from.id;
  const messageId = query.message?.message_id ?? null;
  const token = env.TELEGRAM_BOT_TOKEN;

  if (!parseAdminIds(env.ADMIN_IDS).includes(query.from.id)) {
    logEvent("admin.denied", { data: data.slice(0, 32) });
    return null;
  }

  switch (data) {
    case CALLBACK_DATA.adminOn:
      await setServiceEnabled(env.DB, true);
      logEvent("admin.service_changed", { enabled: true });
      await refreshPanel(env, chatId, messageId);
      return null;
    case CALLBACK_DATA.adminOff:
      await setServiceEnabled(env.DB, false);
      logEvent("admin.service_changed", { enabled: false });
      await refreshPanel(env, chatId, messageId);
      return null;
    case CALLBACK_DATA.adminRefresh:
      await refreshPanel(env, chatId, messageId);
      return null;
    case CALLBACK_DATA.adminHealth: {
      const now = nowSec();
      const cycle = await collectPriceCycle(env, now);
      const serviceEnabled = await isServiceEnabled(env.DB);
      await editOrSend(
        token,
        chatId,
        messageId,
        renderHealthPanel(now, cycle.fetchResult, cycle.resolved.metrics, cycle.resolved.warnings),
        adminPanelKeyboard(serviceEnabled),
      );
      return null;
    }
    case CALLBACK_DATA.adminSend: {
      if (!(await isServiceEnabled(env.DB))) {
        await refreshPanel(env, chatId, messageId);
        return t("en").adminServiceOffToast;
      }
      const subscribers = await countSubscribers(env.DB);
      await editOrSend(
        token,
        chatId,
        messageId,
        t("en").adminSendConfirmText(subscribers),
        sendConfirmKeyboard(),
      );
      return null;
    }
    case CALLBACK_DATA.adminSendNo:
      await refreshPanel(env, chatId, messageId);
      return t("en").adminCancelledToast;
    case CALLBACK_DATA.adminSendYes: {
      if (!(await isServiceEnabled(env.DB))) {
        await refreshPanel(env, chatId, messageId);
        return t("en").adminServiceOffToast;
      }
      const result = await runManualBroadcast(env, nowSec());
      const data2 = await loadAdminPanelData(env);
      const note =
        result.reason === "no_subscribers"
          ? t("en").adminNoSubscribers
          : result.reason === "no_data"
            ? t("en").adminAllSourcesFailed
            : t("en").adminBroadcastQueuedText(result.recipients, result.chunks);
      await editOrSend(
        token,
        chatId,
        messageId,
        `${renderAdminPanel(data2)}\n\n${escapeHtml(note)}`,
        adminPanelKeyboard(data2.serviceEnabled),
      );
      return t("en").adminSendStartedToast;
    }
    default:
      return null;
  }
}
