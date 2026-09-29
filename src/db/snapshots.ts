import type { Lang } from '../types';

export interface SnapshotRow {
   id: number;
   created_at: number;
   hour_key: string;
   /** English copy, kept for backward compatibility (pre-migration rows, legacy messages). */
   message_html: string;
   html_fa: string | null;
   html_en: string | null;
   data_json: string;
}

export interface InsertSnapshotInput {
   createdAt: number;
   hourKey: string;
   /** English copy. */
   messageHtml: string;
   htmlFa: string;
   htmlEn: string;
   dataJson: string;
}

const SNAPSHOT_COLUMNS =
   'id, created_at, hour_key, message_html, html_fa, html_en, data_json';

function asMeta(value: unknown): { changes?: number; last_row_id?: number } {
   return (value ?? {}) as { changes?: number; last_row_id?: number };
}

/**
 * Message HTML for one language, falling back to message_html (English) when the row was
 * written before migration 0002 or when a language column is missing.
 */
export function htmlForLang(row: SnapshotRow, lang: Lang): string {
   if (lang === 'fa') return row.html_fa ?? row.message_html;
   return row.html_en ?? row.message_html;
}

/** Newest snapshot, used by /price, the join flow and the queue consumer. */
export async function getLatestSnapshot(db: D1Database): Promise<SnapshotRow | null> {
   return (
      (await db
         .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshots ORDER BY id DESC LIMIT 1`)
         .first<SnapshotRow>()) ?? null
   );
}

export async function getSnapshotById(db: D1Database, id: number): Promise<SnapshotRow | null> {
   return (
      (await db
         .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshots WHERE id = ?1`)
         .bind(id)
         .first<SnapshotRow>()) ?? null
   );
}

export async function insertSnapshot(db: D1Database, input: InsertSnapshotInput): Promise<number> {
   const result = await db
      .prepare(
         'INSERT INTO snapshots (created_at, hour_key, message_html, html_fa, html_en, data_json) ' +
            'VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
      )
      .bind(
         input.createdAt,
         input.hourKey,
         input.messageHtml,
         input.htmlFa,
         input.htmlEn,
         input.dataJson,
      )
      .run();
   return Number(asMeta(result.meta).last_row_id ?? 0);
}

/** Deletes snapshots older than the given instant; returns the rows deleted. */
export async function pruneSnapshots(db: D1Database, olderThanEpochSec: number): Promise<number> {
   const result = await db
      .prepare('DELETE FROM snapshots WHERE created_at < ?1')
      .bind(olderThanEpochSec)
      .run();
   return Number(asMeta(result.meta).changes ?? 0);
}