import { SETTING_SERVICE_ENABLED } from "../config";

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?1")
    .bind(key)
    .first<{ value: string | null }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key, value)
    .run();
}

/** A missing row means the service is ON (the migration seeds '1'). */
export async function isServiceEnabled(db: D1Database): Promise<boolean> {
  const value = await getSetting(db, SETTING_SERVICE_ENABLED);
  return value === null ? true : value === "1";
}

export async function setServiceEnabled(db: D1Database, enabled: boolean): Promise<void> {
  await setSetting(db, SETTING_SERVICE_ENABLED, enabled ? "1" : "0");
}
