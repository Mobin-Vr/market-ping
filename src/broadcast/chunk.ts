import { CHUNK_SIZE, QUEUE_MAX_MESSAGES_PER_SEND_BATCH } from '../config';
import type { BroadcastTarget } from '../db/users';
import type { BroadcastMessage, Lang } from '../types';

/** Splits chat ids into chunks of at most `size` (never smaller than one). */
export function chunkChatIds(chatIds: readonly number[], size: number = CHUNK_SIZE): number[][] {
   const chunkSize = Math.max(1, Math.floor(size));
   const chunks: number[][] = [];
   for (let index = 0; index < chatIds.length; index += chunkSize) {
      chunks.push(chatIds.slice(index, index + chunkSize));
   }
   return chunks;
}

/**
 * One queue message per chunk (so no invocation ever sends to everybody), carrying the
 * re-enqueue attempt number so a redelivered message can be recognised.
 */
export function buildQueueMessages(
   snapshotId: number,
   hourKey: string,
   chatIds: readonly number[],
   attempt = 1,
   lang?: Lang,
): BroadcastMessage[] {
   return chunkChatIds(chatIds).map((chunk) => ({
      snapshotId,
      hourKey,
      chatIds: chunk,
      attempt,
      ...(lang ? { lang } : {}),
   }));
}

/**
 * Per-language fan-out: the targets are grouped by language first, then each group is
 * chunked, so a single queue message never mixes languages.
 */
export function buildQueueMessagesByLang(
   snapshotId: number,
   hourKey: string,
   targets: readonly BroadcastTarget[],
   attempt = 1,
): BroadcastMessage[] {
   const messages: BroadcastMessage[] = [];
   for (const lang of ['fa', 'en'] as const) {
      const chatIds = targets.filter((target) => target.lang === lang).map((target) => target.chatId);
      if (chatIds.length === 0) continue;
      messages.push(...buildQueueMessages(snapshotId, hourKey, chatIds, attempt, lang));
   }
   return messages;
}

/** Cloudflare Queues accepts at most 100 messages per sendBatch call. */
export function splitSendBatches<T>(
   messages: readonly T[],
   maxPerBatch: number = QUEUE_MAX_MESSAGES_PER_SEND_BATCH,
): T[][] {
   const limit = Math.max(1, Math.floor(maxPerBatch));
   const batches: T[][] = [];
   for (let index = 0; index < messages.length; index += limit) {
      batches.push(messages.slice(index, index + limit));
   }
   return batches;
}