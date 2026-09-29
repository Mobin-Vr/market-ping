-- Market Ping - phase 2: language selection, per-language storage and broadcast.
-- Additive and backward compatible: the previous Worker version ignores these columns.

-- Persian is the default; existing users become 'fa'.
ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'fa';

-- Every cycle renders both languages. message_html keeps the English copy for backward
-- compatibility (in-flight queue messages, rows written before this migration).
ALTER TABLE snapshots ADD COLUMN html_fa TEXT;
ALTER TABLE snapshots ADD COLUMN html_en TEXT;

-- Broadcast target lookup: WHERE subscribed = 1 AND blocked = 0, grouped by language.
CREATE INDEX IF NOT EXISTS idx_users_subscribed_lang ON users(subscribed, lang);

UPDATE users SET lang = 'fa' WHERE lang IS NULL;
