import { DEFAULT_RETRY_AFTER_SEC, QUEUE_MAX_ATTEMPTS } from '../config';
import { addCounters } from '../db/broadcastLog';
import { getSnapshotById, htmlForLang } from '../db/snapshots';
import { markBlocked } from '../db/users';
import { resolveLang } from '../i18n';
import { errorName, logEvent } from '../log';
import { tgSendMessage } from '../telegram/api';
import { classifyTelegramResult } from '../telegram/classify';
import type { BroadcastMessage, Env } from '../types';

export interface SendProgress {
   sent: number;
   blocked: number;
   failed: number;
   /** Chats that were not reached and must be retried (never contains a delivered chat). */
   remaining: number[];
   /** Set when Telegram asked us to slow down (429 parameters.retry_after). */
   retryAfterSec: number | null;
   /** true when the chunk was cut short because Telegram looked unhealthy. */
   stoppedEarly: boolean;
}

export function createProgress(): SendProgress {
   return { sent: 0, blocked: 0, failed: 0, remaining: [], retryAfterSec: null, stoppedEarly: false };
}

/**
 * Sends one chunk of the snapshot. Progress is tracked per chat id, so a re-enqueue can
 * never deliver twice to the same chat. On 429 (or a transient failure) the rest of the
 * chunk is deferred instead of hammering the API.
 */
export async function sendChunk(env: Env, html: string, chatIds: readonly number[]): Promise<SendProgress> {
   const progress = createProgress();
   for (const chatId of chatIds) {
      if (progress.stoppedEarly) {
         progress.remaining.push(chatId);
         continue;
      }
      const response = await tgSendMessage(env.TELEGRAM_BOT_TOKEN, chatId, html);
      const verdict = classifyTelegramResult(response);
      switch (verdict.outcome) {
         case 'sent':
            progress.sent += 1;
            break;
         case 'blocked':
            progress.blocked += 1;
            await markBlocked(env.DB, chatId);
            break;
         case 'rate_limited':
            progress.retryAfterSec = verdict.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC;
            progress.stoppedEarly = true;
            progress.remaining.push(chatId);
            break;
         case 'transient':
            progress.stoppedEarly = true;
            progress.remaining.push(chatId);
            break;
         default:
            progress.failed += 1;
      }
   }
   return progress;
}

/** Telegram's retry_after when it told us to wait, otherwise a small linear backoff. */
export function retryDelaySec(progress: SendProgress, attempt: number): number {
   if (progress.retryAfterSec !== null) return progress.retryAfterSec;
   return DEFAULT_RETRY_AFTER_SEC * Math.max(1, attempt);
}

/** Counts a remainder as failed once the retry budget is exhausted. */
function failRemainder(progress: SendProgress): void {
   progress.failed += progress.remaining.length;
   progress.remaining = [];
}

/**
 * Handles one queue message (max_batch_size = 1). The original message is acknowledged only
 * after the follow-up message carrying the remaining chat ids has been accepted by Queues.
 */
export async function processBroadcastMessage(env: Env, message: Message<BroadcastMessage>): Promise<void> {
   const body = message.body;
   if (!body || typeof body.snapshotId !== 'number' || !Array.isArray(body.chatIds)) {
      logEvent('queue.invalid_body');
      message.ack();
      return;
   }
   const attempt = typeof body.attempt === 'number' && body.attempt > 0 ? body.attempt : 1;

   const snapshot = await getSnapshotById(env.DB, body.snapshotId);
   if (!snapshot) {
      // Pruned or unknown snapshot: these subscribers received nothing.
      logEvent('queue.snapshot_missing', { snapshotId: body.snapshotId });
      await addCounters(env.DB, body.hourKey, { failed: body.chatIds.length });
      message.ack();
      return;
   }

   // A message without a language (written before phase 2) falls back to message_html.
   const lang = resolveLang(body.lang);
   const html = htmlForLang(snapshot, lang);
   const progress = await sendChunk(env, html, body.chatIds);
   const canRetry = progress.remaining.length > 0 && attempt < QUEUE_MAX_ATTEMPTS;

   if (!canRetry) {
      failRemainder(progress);
      await addCounters(env.DB, body.hourKey, {
         sent: progress.sent,
         blocked: progress.blocked,
         failed: progress.failed,
      });
      message.ack();
      if (progress.stoppedEarly) {
         logEvent('queue.gave_up', { hourKey: body.hourKey, attempt, failed: progress.failed });
      }
      return;
   }

   const delaySeconds = retryDelaySec(progress, attempt);
   const followUp: BroadcastMessage = {
      snapshotId: body.snapshotId,
      hourKey: body.hourKey,
      chatIds: progress.remaining,
      attempt: attempt + 1,
      lang,
   };

   try {
      await env.BROADCAST_QUEUE.send(followUp, { delaySeconds });
   } catch (err) {
      // The remainder could not be handed over: leave the original message unacknowledged so
      // those subscribers are retried rather than silently dropped.
      logEvent('queue.reenqueue_failed', { hourKey: body.hourKey, error: errorName(err) });
      await addCounters(env.DB, body.hourKey, {
         sent: progress.sent,
         blocked: progress.blocked,
         failed: progress.failed,
      });
      message.retry({ delaySeconds });
      return;
   }

   await addCounters(env.DB, body.hourKey, {
      sent: progress.sent,
      blocked: progress.blocked,
      failed: progress.failed,
   });
   // Acknowledge only now that the follow-up message exists.
   message.ack();
   logEvent('queue.reenqueued', {
      hourKey: body.hourKey,
      attempt: attempt + 1,
      remaining: followUp.chatIds.length,
      delaySeconds,
      lang,
   });
}

/** Queue handler entry point (max_batch_size = 1, max_concurrency = 2). */
export async function handleQueueBatch(env: Env, batch: MessageBatch<BroadcastMessage>): Promise<void> {
   for (const message of batch.messages) {
      try {
         await processBroadcastMessage(env, message);
      } catch (err) {
         logEvent('queue.message_failed', { error: errorName(err), attempt: message.attempts });
         message.retry();
      }
   }
}