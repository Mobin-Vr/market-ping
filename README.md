# Market Ping

A Telegram bot that sends Iranian market prices - US Dollar, Gold &amp; Coins, Bitcoin - to every
subscriber once an hour, from 09:00 to 21:00 **Tehran time**: 13 messages a day. It runs
entirely on the Cloudflare **free plan**: one Worker, one D1 database, one queue and a single
cron trigger. The bot speaks **Persian (default) and English**; the admin panel, admin alerts
and the API-health report are always English. Nothing is sent to a user until they tap
**Join**.

## Table of contents

- [1. What the bot does](#1-what-the-bot-does)
- [2. Message layout](#2-message-layout)
- [3. User commands and buttons](#3-user-commands-and-buttons)
- [4. Admin panel](#4-admin-panel)
- [5. Data sources](#5-data-sources)
- [6. Architecture and data model](#6-architecture-and-data-model)
- [7. i18n (two languages)](#7-i18n-two-languages)
- [8. First-time setup](#8-first-time-setup)
- [9. Upgrading an existing deployment](#9-upgrading-an-existing-deployment)
- [10. Operations](#10-operations)
- [11. Troubleshooting](#11-troubleshooting)
- [12. Free-plan limits](#12-free-plan-limits)
- [13. Security and privacy](#13-security-and-privacy)
- [14. Development](#14-development)

## 1. What the bot does

- **One cron trigger** (`30 5-17 * * *` = 05:30-17:30 UTC = 09:00-21:00 Tehran, 13 runs a day)
  is the **only regular caller of the price APIs**. Each run fetches the four sources,
  resolves every metric, stores one snapshot in both languages and fans the message out
  through a queue.
- **User requests never call the price APIs.** `/price` or the *Get prices now* button serve
  the newest stored snapshot exactly as it was stored, plus a `🕒 Last update` /
  `🕒 آخرین به‌روزرسانی` line in the user's language.
- **Guarded emergency refresh**: outside cron the pipeline runs only when there is no snapshot
  at all or the newest one is older than `ON_DEMAND_MAX_AGE_HOURS` (24 h) - and at most once
  every `ON_DEMAND_REFRESH_MIN_GAP_SEC` (600 s), no matter how many users ask at the same
  moment. A burst of users can never cause a burst of API calls.
- **Join-gated**: hourly messages go only to rows with `subscribed = 1 AND blocked = 0`.
- **Two languages**: a new user sees the Persian welcome first and switches with the `🌐`
  button or `/language`. The admin panel, admin alerts and API health stay English.
- The bot works in **private chats only**; group and channel updates are ignored.

```text
Telegram ──webhook──▶ Worker fetch()      ──▶ D1 (users, settings, snapshots, last_good, broadcast_log)
Cron 30 5-17 * * * ─▶ Worker scheduled()  ──▶ fetch 4 sources ─▶ resolve ─▶ snapshot ─▶ queue (chunks of 15)
                                            Queue consumer ─▶ sendMessage (≤15 per invocation)
Admin ──/admin──────▶ Worker fetch()      ──▶ ON/OFF, Send now, API health, Refresh
```

## 2. Message layout

The price message has three categories in a fixed display order (`CATEGORY_ORDER` in
`src/config.ts`): **Currency**, **Gold &amp; Coins**, **Crypto**. English is built from aligned
`<pre>` blocks; Persian (`FA_LAYOUT = "blockquote"`, the default) uses one `<blockquote>` per
category with logical `label: number unit` rows - English digits, unit after the number.

Both samples below are the **exact output of `npm run preview`** (rendered from the committed
fixtures - they are copied from that command, never hand-written):

**English:**

```text
📈 <b>Market Ping</b>

3Shanbe, 7 Mehr 1405 | 10:34

💱 <b>Currency</b>
<pre>USD  244,800 T</pre>

🥇 <b>Gold &amp; Coins</b>
<pre>Gold Ounce               $4,142

Tala Garam (18K)   24,835,000 T

Rob Seke           68,500,000 T
Nim Seke          127,800,000 T
Tamam Seke        243,500,000 T
Emami             250,100,000 T</pre>

₿ <b>Crypto</b>
<pre>Bitcoin  $83,989</pre>
```

**Persian (default):**

```text
‏📈 <b>مارکت پینگ</b>

‏سه‌شنبه، 7 مهر 1405 | 10:34

‏💱 <b>نرخ ارز</b>
<blockquote>‏دلار: 244,800 تومان</blockquote>

‏🥇 <b>طلا و سکه</b>
<blockquote>‏اونس طلا: 4,142 دلار
‏
‏طلا گرم 18 عیار: 24,835,000 تومان
‏
‏ربع سکه: 68,500,000 تومان
‏نیم سکه: 127,800,000 تومان
‏تمام سکه: 243,500,000 تومان
‏سکه امامی: 250,100,000 تومان</blockquote>

‏₿ <b>ارز دیجیتال</b>
<blockquote>‏بیت‌کوین: 83,989 دلار</blockquote>
```

Under the two blocks `npm run preview` prints `[en] [20 display lines, 13 non-empty]` and
`[fa] [21 display lines, 16 non-empty]`.

Layout rules - each one enforced by tests:

| Rule | Where |
| --- | --- |
| One blank line between the title and the date header. The header carries **no city word**: `3Shanbe, 7 Mehr 1405 \| 10:34` / `سه‌شنبه، 7 مهر 1405 \| 10:34` | `src/time.ts` |
| Hard budget: `MESSAGE_MAX_DISPLAY_LINES` = 26 display lines, footnotes and the on-demand `Last update` line included (when the stored message is already full, the note is folded into the last line) | `src/config.ts`, `src/render/message.ts` |
| Gold &amp; Coins rows are split into **row groups separated by exactly one blank line**: `GOLD_COIN_ROW_GROUPS` gives both languages the same 3 groups (ounce / gram / all four coins) | `src/config.ts` |
| Right-alignment uses one width across the whole Gold &amp; Coins block, so the blank separator lines never shift the columns | `src/render/message.ts` |
| RTL safety: every Persian line starts with exactly one RLM (U+200F). Blank separator lines inside a Persian block contain **only** U+200F so Telegram cannot collapse them; English separators inside `<pre>` are truly empty. Persian rows never contain Latin text or `T`/`$` units | `src/render/message.ts` |
| **Price messages carry no inline keyboard.** Tapping buttons under an hourly price message is an accepted UX exception - only the welcome and language menus have keyboards | `src/render/message.ts` |

Value markers:

- `N/A` / `ناموجود` - the metric could not be resolved at all.
- `*` - the value is older than `FRESH_MAX_AGE_MIN` (180 minutes); a footnote prints its age:
  `* USD: last update 6 Mehr 1405 20:58` (Persian: `* دلار: آخرین به‌روزرسانی ...`).
- `~249,950 T` - USD derived from the USDT rate (approximate), explained by the note
  `~ via USDT rate`.
- A missing value in one category never hides the others; the categories always print in
  `CATEGORY_ORDER`.

The same numbers appear in the admin API-health view, and labels/order come from one place,
`src/labels.ts`, shared by the message and the health panel.

## 3. User commands and buttons

Every message update is handled by `src/telegram/commands.ts`:

| Command | What it does |
| --- | --- |
| `/start`, `/menu` | The main menu: welcome text plus the buttons below. |
| `/price` | The newest stored snapshot in the user's language with the `Last update` line. One request per `MANUAL_COOLDOWN_SEC` (60 s) per user; while the service is OFF it answers with the "paused" text instead. |
| `/language` | Language picker with `🇮🇷 فارسی` and `🇬🇧 English` buttons. |
| `/stop` | Leaves the hourly queue (identical to the Leave button). |
| `/help` | A short help text: how the bot works, the buttons/commands, and one line about what data is stored. |
| `/admin`, `/setup_profile` | Admin only - **anybody else gets no response at all** (see §4). |

- **Any other text - including an unknown `/command` - shows the main menu again.** Typos do
  not produce an error message; the bot simply re-sends the menu.
- The command menu Telegram shows is the one registered by `/setup_profile` (`start`, `menu`,
  `price`, `language`, `stop`, `help`; `/admin` and `/setup_profile` are deliberately not
  listed).

Buttons under the menu - row 1 is the state action plus *Get prices now*, row 2 is the
language toggle, whose label always shows the **other** language:

| State | English UI | Persian UI |
| --- | --- | --- |
| Not joined | `[✅ Join hourly updates] [💵 Get prices now]` | `[✅ عضویت در قیمت‌های ساعتی] [💵 دریافت قیمت‌ها]` |
| Joined | `[🚪 Leave] [💵 Get prices now]` | `[🚪 لغو عضویت] [💵 دریافت قیمت‌ها]` |
| Language toggle | `[🌐 فارسی]` | `[🌐 English]` |

Behaviour of the buttons:

- **Join** subscribes, rewrites the message to the Joined state and immediately sends the
  current stored prices when the request falls inside the send window (otherwise the
  "next update" text). While the service is OFF the user still gets the confirmation plus
  the paused note.
- **Leave** / `/stop` unsubscribes and rewrites the message back to the Join state.
- **Get prices now** behaves exactly like `/price` (stored snapshot, 60 s cooldown).
- Every tap is acknowledged with a short toast **in the user's language** ("joined", "left",
  "prices sent", "language updated", "please wait", "service paused").
- The `/language` picker stores the choice in `users.lang` (Persian is the default) and
  rewrites the open menu in the new language immediately.

## 4. Admin panel

- **Who counts as admin**: the numeric Telegram ids in the `ADMIN_IDS` secret, comma
  separated (e.g. `123456789,987654321`). Non-admins who send `/admin` or `/setup_profile`
  get **no response at all**, and pressing a panel button as a non-admin does nothing either
  (logged as `admin.denied`).
- **English only**: the panel body, the confirmation screen, every button toast and the
  health view are rendered through the English bundle regardless of who presses them.
- Open it with `/admin`. Every button edits the same message in place:

| Button | What it does |
| --- | --- |
| `🔴 Turn OFF` / `🟢 Turn ON` | Flips the whole service (`service_enabled` in D1). While OFF nobody receives hourly or manual prices (users see the paused text), but joining and leaving still works. Logged as `admin.service_changed`. |
| `📤 Send now` | First asks `Send prices to N subscribers now?` with `Yes` / `Cancel`. **Yes** runs the normal broadcast pipeline under its own log key `manual-<epoch>` (e.g. `manual-1770596446`), so the hourly log key is never touched. Refused with a toast while the service is OFF. |
| `📡 API health` | Fetches all four sources live: per-source OK/FAIL, latency, HTTP status or error type, the live USD value per source with its deviation, and every resolved value with its source. This is how you see geo-blocking. |
| `🔄 Refresh` | Reloads the panel - also the way back from the health view. |

The panel body shows:

- `Service: ON` / `Service: OFF` and `Subscribers: N` (rows with `subscribed = 1 AND blocked = 0`).
- `Last broadcast: 7 Mehr 1405 10:00 - sent 40, blocked 1, failed 1` - the time is Tehran
  local, and a `[pending]` or `[skipped]` tag is appended while the newest run is unfinished
  or was skipped. Counters come from `broadcast_log`; with no run at all the line reads
  `Last broadcast: none yet`.

### `/setup_profile`

Run it **once from an admin account after the first deploy**, and **again whenever the
command list or any description changes**. It makes 9 Telegram API calls -
`setMyCommands`, `setMyDescription` and `setMyShortDescription` for the default, `fa` and
`en` scopes - and replies with a per-call `OK` / `FAIL` line plus a failed-count. The bot
token is never printed or logged. Until it has run once, Telegram shows no command menu for
the bot.

## 5. Data sources

Four sources are fetched **in parallel**, each with `FETCH_TIMEOUT_MS` (8 s) and
`FETCH_RETRIES` (1) retry. The retry policy in `fetchJson` (`src/http.ts`) is: timeouts and
network errors are retried; **4xx responses are not retried except 429** (saves subrequest
budget - a hard `403` will not be hammered).

### Priority chains (verified from `METRIC_PRIORITY` in `src/resolve/resolver.ts`)

| Metric(s) | Priority order | Note |
| --- | --- | --- |
| `usd_toman` | **nerkh → navasan → zipodo** | zipodo is last resort and approximate |
| `ounce_usd`, `gold18_toman`, `coin_quarter_toman`, `coin_half_toman`, `coin_bahar_toman`, `coin_emami_toman` | **nerkh → navasan** | both quote Toman/USD directly |
| `btc_usd` | **megaweb → nerkh → navasan** (`BTC_SOURCE_ORDER`) | megaweb is the only source returning BTC in USD directly |
| USDT helper (internal, never displayed) | nerkh → navasan → zipodo | feeds the usdt/usd sanity guard |

Resolution rule: walk the chain in order; **the first value no older than
`FRESH_MAX_AGE_MIN` (180 minutes) wins**. If nothing is fresh, the newest timestamp among
the live candidates *and* the stored `last_good` value wins and is marked stale (printed
with `*`). If there is nothing at all, the metric is `N/A`.

### Units

| Source | Units and traps |
| --- | --- |
| **Nerkh** | Already Toman/USD. Reads only the documented keys; gold-futures, `GOLD24K`, `MAZANEH` etc. are ignored. |
| **Navasan** | **Coins are quoted in thousand Toman and multiplied by 1000** (`THOUSAND` in `src/sources/navasan.ts`) - forgetting this is the classic x1000 bug, and the coin/gold18 ratio guard exists to catch it. `usd_xau` is the USD ounce while the un-prefixed `xau` is Toman; `bub_*`, `mob_*`, `mex_*`, `harat_*` are ignored. |
| **Megaweb** | BTC in USD directly; also the USDT reference for the derived-BTC path (`BTC / USDT`, about 0.1 % off). |
| **Zipodo** | Approximate USD derived from USDT, shown as `~...` with `~ via USDT rate`; skipped by the usdt/usd guard (comparing USDT with USDT would be meaningless). |

### Sanity guards (every candidate, before resolution)

| Guard | Constants | Limit |
| --- | --- | --- |
| Deviation from the last known good value | `MAX_DEVIATION_PCT` | 30 % |
| `coin_emami_toman / gold18_toman` (catches thousand-Toman mistakes) | `COIN_TO_GOLD18_MIN_RATIO` / `COIN_TO_GOLD18_MAX_RATIO` | 5 - 15 |
| `usdt_toman / usd_toman` (not applied to zipodo) | `USDT_TO_USD_MIN_RATIO` / `USDT_TO_USD_MAX_RATIO` | 0.9 - 1.15 |

A rejected candidate is dropped (logged as `sanity.warning`); if a metric has no candidate
left, the resolver keeps the highest-priority one and warns again - a bad hour never crashes
the run.

**Cross-source agreement is informational only** - it never decides which value wins
(priority + freshness do). `USD_CROSS_SOURCE_TOLERANCE_PCT` = **3 % for `usd_toman`**
(free-market USD providers legitimately differ by 1-2 %, and 3 % still catches x10/x1000
unit mistakes) and `CROSS_SOURCE_TOLERANCE_PCT` = **1 %** for everything in
`STRICT_AGREEMENT_METRICS`. The unit tests assert exactly these numbers, and the health
panel prints `spread 2.10% (info only, warn above 3%)`.

## 6. Architecture and data model

### Webhook

The only route is `POST /telegram/<WEBHOOK_SECRET>`; any other method or path returns
`404 Not found`. Both the path segment **and** the `X-Telegram-Bot-Api-Secret-Token` header
must equal `WEBHOOK_SECRET` (constant-time comparison in `src/security.ts`), otherwise the
Worker answers `401` and logs `webhook.unauthorized`. Only `message`, `callback_query` and
`my_chat_member` updates are registered.

### Cron → snapshot → queue

1. `scheduled()` re-checks the Tehran hour (`cron.outside_window`), the service switch
   (`cron.service_off`) and hour-key idempotency (`cron.already_claimed` - the same hour can
   never be broadcast twice).
2. All four sources are fetched and resolved. **If every metric is `N/A`, the run is written
   as `broadcast_log.status = 'skipped'` and every admin gets one English alert**
   (`cron.skipped_no_data`); partial data is still broadcast, with `*`/`N/A` markers.
3. The snapshot is rendered twice and stored: `snapshots.html_fa` and `snapshots.html_en`
   (`message_html` keeps the English copy so older queue messages and code paths still
   work), plus `data_json` as the source of truth for re-renders.
4. Subscribers are read with `WHERE subscribed = 1 AND blocked = 0 ORDER BY chat_id`
   (index `idx_users_subscribed_lang`), split into chunks of `CHUNK_SIZE` = **15**, and one
   queue message is written per chunk. A queue exists because the free plan allows 50
   subrequests per invocation - no single invocation can message everybody.
5. Snapshots older than `SNAPSHOT_RETENTION_DAYS` = **3** days are pruned on every run.

### Queue settings (wrangler.toml + `src/config.ts`)

| Setting | Value |
| --- | --- |
| Queue name | `market-ping-broadcast` (`QUEUE_NAME`) - producer and consumer on the same Worker |
| `max_batch_size` | **1** - one chunk message per invocation (≤ 15 Telegram sends) |
| `max_concurrency` | **2** |
| `max_retries` (queue redelivery) | **3** |
| Hard attempt cap in code | `QUEUE_MAX_ATTEMPTS` = 3 (1 initial + 2 re-enqueues); Cloudflare allows ≤ 100 messages per `sendBatch` (`QUEUE_MAX_MESSAGES_PER_SEND_BATCH`) |

The consumer tracks progress **per chat id**, so a re-enqueue never messages anyone twice.
On Telegram `429` it stops the chunk, re-enqueues only the subscribers it did not reach with
`delaySeconds = parameters.retry_after`, and acks the original message only after that
enqueue succeeded. Other failures back off `DEFAULT_RETRY_AFTER_SEC × attempt`. When the
attempt cap is reached it logs `queue.gave_up`. Recipients that Telegram rejects as blocked
(`403` / blocked descriptions) are marked `blocked = 1, subscribed = 0`.

### D1 tables - all migrations, in order

`migrations/0001_init.sql`:

| Table | Columns |
| --- | --- |
| `users` | `chat_id` (PK), `username`, `first_name`, `subscribed`, `joined_at`, `blocked`, `last_manual_at` |
| `settings` | `key`, `value` (seeded with `service_enabled = 1`) |
| `snapshots` | `id`, `created_at`, `hour_key`, `message_html`, `data_json` |
| `last_good` | `metric` (PK), `value`, `source`, `updated_at`, `approximate` |
| `broadcast_log` | `hour_key` (PK), `started_at`, `total`, `sent`, `blocked`, `failed`, **`status`** (`pending` / `done` / `skipped`) |

`migrations/0002_lang.sql` - additive, apply **after** 0001 (an older Worker simply ignores
the new columns):

- `users.lang` - `TEXT DEFAULT 'fa'`; existing rows are backfilled with
  `UPDATE users SET lang = 'fa' WHERE lang IS NULL`.
- `snapshots.html_fa` and `snapshots.html_en` - per-language message storage.
- Index `idx_users_subscribed_lang` on `(subscribed, lang)` for the per-language fan-out.

These are the only two migration files; both migrate commands apply pending files
**alphabetically**, i.e. `0001_init.sql` before `0002_lang.sql`.

## 7. i18n (two languages)

- `src/i18n/index.ts` defines the shared types - `TextBundle` (every user-visible string),
  `MessageStrings` (one rendered price message) and `ProfileStrings` (the `setMyCommands`
  payload) - plus the `t(lang)` lookup. `LANGS = ['fa', 'en']` and `DEFAULT_LANG = 'fa'`
  live in `src/types.ts`.
- `src/i18n/fa.ts` and `src/i18n/en.ts` each export an object annotated `: TextBundle`.
  Because of that annotation, **a missing or misspelled key is a compile error** -
  `npm run typecheck` lists every key you still owe; there is no runtime `undefined`.
- The admin panel, admin alerts and the API-health report are always rendered through
  `t('en')`, even though both bundles define the admin keys.

**Digits rule:** Persian messages use **English digits** - `244,800 تومان`,
`سه‌شنبه، 7 مهر 1405` - never `۰-۹`. This keeps the columns aligned and matches the
fixtures and tests.

**Adding a new language** (the compiler walks you through it):

1. Add the code to the `Lang` union and `LANGS` in `src/types.ts`.
2. Create `src/i18n/<code>.ts` exporting `const <code>: TextBundle = { ... }` - copy
   `en.ts` and translate; TypeScript reports every missing key.
3. Register it in the `t()` map in `src/i18n/index.ts`.
4. Add a `GOLD_COIN_ROW_GROUPS` entry in `src/config.ts` (the record is keyed by `Lang`).
5. Add a `PROFILE_TARGETS` entry in `src/telegram/profile.ts` if the language should get its
   own `setMyCommands` scope, then run `/setup_profile` so Telegram learns about it.

**Glossary** - the Persian terms used in messages (from `metricLabels` in `src/i18n/fa.ts`):

| Persian | English |
| --- | --- |
| `نرخ ارز` | Currency |
| `طلا و سکه` | Gold &amp; Coins |
| `ارز دیجیتال` | Crypto |
| `دلار` | USD |
| `اونس طلا` | Gold Ounce |
| `طلا گرم 18 عیار` | Tala Garam (18K) |
| `ربع سکه` / `نیم سکه` / `تمام سکه` | Rob / Nim / Tamam Seke (quarter / half / full coin) |
| `سکه امامی` | Emami |
| `بیت‌کوین` | Bitcoin |
| `ناموجود` | N/A (the `na` string) |
| `تومان` | the Toman suffix (English ` T`) |
| `آخرین به‌روزرسانی` | Last update (on-demand line and stale footnotes) |

Note that `تمام سکه` (full coin, `coin_bahar_toman`) is the Persian-only display term;
English shows the transliteration `Tamam Seke`. Metric labels and their order live in one
place, `src/labels.ts`, shared by the hourly message and the health view.

**Dates.** Jalali, Tehran local time, English digits, **no city word in the header**:
`3Shanbe, 7 Mehr 1405 | 09:00`. The weekday name comes from an array indexed by the Tehran
weekday number (0 = Sunday), API timestamps are parsed with `jalaliToEpochSec()`
(`src/time.ts`) which treats the Jalali string as Tehran wall time and applies
`TEHRAN_OFFSET_MIN` (210 minutes - Tehran is UTC+3:30 all year, no DST) once.

## 8. First-time setup

Copy-paste, beginners welcome. **PowerShell first** (Windows), then the bash equivalent
where it differs. No command below prints or stores a secret in a file you might commit.

### 8.1 Install and log in

```powershell
npm install
npx wrangler login          # opens the browser, once per machine
```

bash is identical.

### 8.2 Create the D1 database

```powershell
npx wrangler d1 create market-ping
```

Copy the `database_id` value it prints into `wrangler.toml`, replacing the value that is
currently committed under `[[d1_databases]]` - that one belongs to the original author's
database, so a fresh setup must swap in the id of the database you just created. (Keep the
`DB` binding name and the rest of the file as they are.)

### 8.3 Create the queue

```powershell
npx wrangler queues create market-ping-broadcast
```

### 8.4 Apply the database schema - in order

```powershell
npm run db:migrate:local     # local D1 used by `wrangler dev`
npm run db:migrate:remote    # the deployed database
```

bash is identical. Both commands apply every pending file **in order**: `0001_init.sql`
(initial schema) first, then `0002_lang.sql` (`users.lang`, `snapshots.html_fa` / `html_en`,
the `(subscribed, lang)` index, existing users become Persian). Run the **remote** command
before you deploy any code that reads those columns.

### 8.5 Set the secrets

Each command prompts for the value (paste it, press Enter). The value goes straight to
Cloudflare's encrypted store - it is never written to a file and never becomes part of a
command line or your shell history:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN   # from @BotFather
npx wrangler secret put WEBHOOK_SECRET       # random 32+ chars, see below
npx wrangler secret put ADMIN_IDS            # your numeric Telegram id(s), comma separated
npx wrangler secret put NERKH_API_KEY
npx wrangler secret put NAVASAN_API_KEY
```

Generate a `WEBHOOK_SECRET` (works in PowerShell and bash):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Find your numeric Telegram id by messaging
[@userinfobot](https://t.me/userinfobot). `ADMIN_IDS` is a comma-separated list:
`123456789,987654321`.

### 8.6 Local secrets for development

```powershell
Copy-Item .dev.vars.example .dev.vars
```

```bash
cp .dev.vars.example .dev.vars
```

Fill in the same five values (no quotes needed). `.dev.vars` is git-ignored;
`.dev.vars.example` deliberately has empty values so it is safe to commit.

### 8.7 Explain `wrangler.toml`, then deploy

What the file controls (all values are the committed defaults):

| Line(s) | Meaning |
| --- | --- |
| `name`, `main`, `compatibility_date` | Worker name, entry point (`src/index.ts`), runtime version |
| `workers_dev = true` | Publish to `https://market-ping.<your-subdomain>.workers.dev` |
| `preview_urls = false` | Preview URLs are **disabled** for this Worker - only the real workers.dev URL answers; random preview links cannot reach the webhook |
| `[[d1_databases]]` | `DB` binding; `database_id` must be the value from step 8.2 |
| `[[queues.producers]]` / `[[queues.consumers]]` | Queue `market-ping-broadcast`; consumer: `max_batch_size = 1`, `max_concurrency = 2`, `max_retries = 3` |
| `[triggers] crons = ["30 5-17 * * *"]` | The single cron trigger (09:00-21:00 Tehran) |
| `[observability] enabled = true` | Log storage for the Cloudflare dashboard |

Deploy:

```powershell
npm run deploy:dry   # bundles + validates config, changes nothing
npm run deploy
```

Wrangler prints your Worker URL - use it below as
`https://market-ping.<your-subdomain>.workers.dev`.

### 8.8 Point Telegram at the Worker

**PowerShell** - the token is read interactively with `Read-Host`: it is never written to
disk, never part of a command line, and never lands in your command history:

```powershell
$Token  = Read-Host "Bot token from @BotFather"   # typed at the prompt, not saved anywhere
$Secret = (Get-Content .dev.vars | Where-Object { $_ -match '^WEBHOOK_SECRET=' }) `
            -replace '^WEBHOOK_SECRET=', '' -replace '"', ''

Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$Token/setWebhook" -Body @{
  url             = "https://market-ping.<your-subdomain>.workers.dev/telegram/$Secret"
  secret_token    = $Secret
  allowed_updates = '["message","callback_query","my_chat_member"]'
}

Invoke-RestMethod -Uri "https://api.telegram.org/bot$Token/getWebhookInfo"   # check it
$Token = $null      # done: drop the token from memory
```

**bash** - reads the token and the secret from the git-ignored `.dev.vars` instead, so
neither appears on the command line:

```bash
set -a; . <(tr -d '\r' < .dev.vars); set +a

curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://market-ping.<your-subdomain>.workers.dev/telegram/${WEBHOOK_SECRET}" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","callback_query","my_chat_member"]'

curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

(`tr -d '\r'` only strips Windows line endings.) Expected `getWebhookInfo` answer: your
`.../telegram/...` URL, `"pending_update_count": 0` and no `last_error_message`. The output
contains your secret path - do not share it.

### 8.9 Register the bot profile

From an admin account in Telegram send `/setup_profile` once and check the report
(9 lines, all `OK`). Run it again **every time** command lists or descriptions change (§4).

### 8.10 Try it in Telegram

- `/start` (or any unknown text) - the Persian menu; tap `✅ عضویت` to join, `🌐 English` to
  switch language.
- `/price` or `💵 Get prices now` - the stored snapshot with the `Last update` line.
- `/language` for the picker, `/stop` to leave, `/help` for the short help.
- From an `ADMIN_IDS` account: `/admin` for the panel.

## 9. Upgrading an existing deployment

Checklist, in this order:

1. `git pull` the new code; `npm install` if `package.json` changed.
2. **Run the remote migrations first**: `npm run db:migrate:remote`.
   Never deploy code that reads columns the database does not have yet.
3. `npm run deploy` (optionally `npm run deploy:dry` first to validate the bundle).
4. If the command list or any description changed: send `/setup_profile` from an admin
   account and check the 9-line report.
5. Tap **`📤 Send now`** once in `/admin`. This rebuilds the stored snapshot in the new
   layout; until you do, `/price` keeps serving the old-format snapshot (the on-demand path
   serves snapshots as stored, and will only auto-refresh one older than 24 hours).
6. Check `/price` in both languages and confirm the new layout.

## 10. Operations

### Watch it live: `wrangler tail`

```powershell
npx wrangler tail                      # structured JSON events from the deployed Worker
npx wrangler tail --format pretty      # human-readable
npx wrangler tail --status error       # only invocations that threw
```

`observability.enabled = true` in `wrangler.toml` powers the stored logs (viewable in the
Cloudflare dashboard under Workers → your Worker → Logs); `tail` streams live events (local
`wrangler dev` prints its own output instead). The events you will use
most:

| Event | Meaning |
| --- | --- |
| `cron.done` | An hourly run finished (counters in the payload) |
| `cron.outside_window` | Scheduled run outside 09:00-21:00 Tehran (hour guard) |
| `cron.already_claimed` | That hour key was already handled (idempotency) |
| `cron.service_off` | Run skipped: the admin turned the service OFF |
| `cron.skipped_no_data` | **All sources failed** - logged as `skipped`, admins alerted |
| `broadcast.enqueued` | Chunks written to the queue |
| `queue.reenqueued` / `queue.gave_up` | Retry (429/backoff) / attempt cap reached |
| `price_served` / `price_unavailable` | `/price` answered from a snapshot / nothing yet |
| `snapshot.refreshed` / `snapshot.refresh_suppressed` | Guarded emergency refresh ran / was throttled by the 600 s gap |
| `sanity.warning` | A candidate failed a sanity guard |
| `admin.service_changed` / `admin.denied` | Panel toggle / non-admin pressed an admin button |
| `webhook.unauthorized` | Wrong path secret or header (401) |
| `membership.unsubscribed` | A user blocked the bot |
| `source.fetched` / `source.extractor_failed` | Per-source fetch/parse outcome |
| `profile.setup` | `/setup_profile` ran (total/failed counts) |

Event payloads carry ids, counts, ages and error **names** - not tokens, keys or secret URLs.

### `Send now`

The manual rebuild/broadcast from §4. It runs the identical pipeline (fetch → resolve →
snapshot → queue) under a `manual-<epoch>` log key, so it never collides with the hourly
hour key. Refused while the service is OFF. Also the fix for a snapshot in an old layout.

### Reading the API health view

`📡 API health` fetches all four sources live, in three blocks:

1. **Sources** - `nerkh OK HTTP 200 412 ms 8 values` per row; a `FAIL` shows the HTTP status
   or error type. **One `FAIL` on an Iranian provider while others are OK = geo-blocking**
   (Cloudflare egress IPs are sometimes blocked); everything keeps working from the rest.
2. **USD per source** - each provider's live USD with its deviation from the top-priority
   one, then `spread 2.10% (info only, warn above 3%)`. The spread is diagnostic: above 3 %
   means the providers disagree unusually much (often a unit or stale-data problem).
3. **Resolved** - exactly what a broadcast would contain right now, each row with the source
   that won the priority chain (`USD 244,800 T nerkh`).

`🔄 Refresh` re-fetches; it is also the way back to the panel.

### Check the last broadcast / history

Panel line: `Last broadcast: ... - sent X, blocked Y, failed Z` with `[pending]` / `[skipped]`
tags. In D1:

```powershell
npx wrangler d1 execute market-ping --remote --command "SELECT hour_key, total, sent, blocked, failed, status FROM broadcast_log ORDER BY started_at DESC LIMIT 5"

npx wrangler d1 execute market-ping --remote --command "SELECT COUNT(*) AS subscribers FROM users WHERE subscribed = 1 AND blocked = 0"
```

### ON/OFF semantics

- **OFF** stops the hourly broadcast (`cron.service_off`) and `/price` answers with the
  paused text; Join/Leave and `/language` keep working so nobody loses their settings.
  `Send now` is refused too.
- **ON** restores everything; the next cron run behaves normally (no catch-up burst - each
  hour key runs at most once).

### When all sources fail

The run is written as `broadcast_log.status = 'skipped'`, **no message goes out**, and every
admin gets one short English alert ("All price sources failed..."). Fix the source (health
view), then use `Send now`.

### How users get blocked/unsubscribed automatically

- Telegram sends `my_chat_member` with status `kicked` when a user blocks the bot →
  `blocked = 1, subscribed = 0` (`membership.unsubscribed`). If they unblock later, their
  first message clears `blocked` again (subscription stays off until they Join).
- During a broadcast, Telegram answers `403` / blocked-bot errors → same flags, counted in
  the `blocked` column of `broadcast_log`.
- Users are never deleted; the row keeps the history for the subscriber count.

## 11. Troubleshooting

**The bot replies to nothing.** Run `getWebhookInfo` (step 8.8). An empty `url` means the
webhook was never set or was removed - run setWebhook again. Also check `pending_update_count`
and `last_error_message`.

**401 / `webhook.unauthorized`.** The path secret and the `X-Telegram-Bot-Api-Secret-Token`
header must both equal the current `WEBHOOK_SECRET`. After rotating the secret or the token,
re-run setWebhook - the old URL stops working immediately. `wrangler tail` shows
`webhook.unauthorized` for every rejected POST.

**404.** The Worker has exactly one route: `POST /telegram/<WEBHOOK_SECRET>`. A browser GET,
a typo in the path or an `https://...workers.dev/` root URL all return `404 Not found`. Copy
the URL from setWebhook verbatim; also remember `preview_urls = false`, so preview links do
not serve this Worker either.

**API health shows FAIL for an Iranian source (geo-blocked).** Iranian providers sometimes
block Cloudflare (and other hosting) egress IPs; Zipodo was already unreachable from a home
connection while this bot was built (the server closes the connection mid-request - a
"connection reset"). The design absorbs it: the remaining sources fill the snapshot, older
values are served as `*` stale with a footnote, nothing crashes. If one source stays blocked,
reorder it in `src/resolve/resolver.ts` (`METRIC_PRIORITY`) or put your own proxy in front
of it. Hard `4xx` answers are deliberately not retried (budget); timeouts are.

**429 Too Many Requests.** The consumer stops the chunk, re-enqueues only the subscribers it
did not reach with `delaySeconds = retry_after`, and acks the original message only after
that enqueue succeeded. Progress is tracked per chat id, so nobody is messaged twice.
Telegram allows roughly 30 messages per second; with `CHUNK_SIZE = 15` and
`max_concurrency = 2` the bot stays well below that. If you raised either constant, lower it
again.

**Stale prices (`*` markers, old timestamps).** Values older than `FRESH_MAX_AGE_MIN`
(180 min) are marked stale but still shown, fed by `last_good`. Check the API health view:
if the sources are dead, fix access first; if they answer, tap `Send now` to rebuild the
snapshot. A footnote like `* USD: last update 6 Mehr 1405 20:58` tells you exactly how old
the value is.

**The hourly message did not arrive.** Cron expressions are UTC:
`30 5-17 * * *` = 05:30-17:30 UTC = 09:00-21:00 Tehran. Look for `cron.outside_window`
(guard tripped), `cron.already_claimed` (hour already handled), `cron.service_off` (panel is
OFF), `cron.no_subscribers` or `cron.failed` in `wrangler tail`. Also confirm the trigger
exists in the Cloudflare dashboard (Workers → your Worker → Settings → Triggers).

**"All price sources failed" alert.** All four sources were unreachable for that hour: the
run is logged as `skipped`, no message is sent, every admin gets one alert. Use the health
view, then `Send now` once at least one source answers.

**The old layout is still shown.** The on-demand path serves the stored snapshot *exactly as
stored*. After a layout change (new grouping, new footnotes, removed footer) the old snapshot
keeps being served until it is rebuilt - tap **`📤 Send now`** in `/admin`. (Only a snapshot
older than 24 h is refreshed automatically, and at most once per 600 s.)

**The old commands are still in Telegram's menu.** The menu is whatever the last successful
`/setup_profile` wrote. Send `/setup_profile` again and check the 9 OK/FAIL lines.

**Language problems after the migration (duplicate/missing language).**

- Error `no such column: lang` → the remote database is still pre-0002:
  run `npm run db:migrate:remote` (deploy the code only after it succeeds).
- `lang` is `NULL` → `0002_lang.sql` already backfills `'fa'`; if rows appeared while an old
  version was live, run
  `npx wrangler d1 execute market-ping --remote --command "UPDATE users SET lang = 'fa' WHERE lang IS NULL"`.
- A user has the wrong or duplicated preference → the stored value wins everywhere; sending
  `/language` rewrites it in place (no second row can exist - `chat_id` is the primary key).

**`Send now` says no subscribers / no data.** `no_subscribers`: everybody left or is blocked
(see the `Subscribers:` count). `no data`: all sources failed this minute - see the alert
entry above.

## 12. Free-plan limits

| Cloudflare free-plan limit | How this code stays inside it |
| --- | --- |
| 50 subrequests per invocation | The cron does ~8 fetches (4 sources × parallel attempts) plus a few D1 statements; a consumer invocation does at most 15 sends plus a couple of statements. No invocation ever messages everybody - that is why the queue exists. |
| 10 ms CPU per invocation | Payloads are parsed and immediately reduced to candidates; no `Intl` in the hot path; the bundle is ~100 KiB raw / ~24 KiB gzipped (`npm run deploy:dry` prints the real number). |
| 100,000 requests per day | Webhook traffic plus 13 cron runs a day - a tiny fraction. |
| 1 cron trigger | Exactly one: `30 5-17 * * *`. |
| D1: 5M rows read / 100k rows written per day | Index-backed reads (`idx_users_subscribed_lang`, `hour_key`) and batched writes; a normal day uses a tiny fraction. |
| Queues: 10,000 operations per day | About 3 operations per delivered chunk message. |

**Capacity math.** With `CHUNK_SIZE = 15` and 13 runs a day, 10,000 daily queue operations
support roughly 250 chunk messages per run - about **3,800 subscribers**. Fewer than 500
subscribers cost around 1,300 operations a day. Raising `CHUNK_SIZE` lowers queue usage but
raises the chance of Telegram 429s; raising `max_concurrency` shortens a broadcast but hits
the ~30 msg/s limit sooner.

**Snapshot retention.** Snapshots older than `SNAPSHOT_RETENTION_DAYS = 3` days are pruned on
every cron run. `last_good` keeps one row per metric (that is what feeds stale values) and is
never pruned by age.

## 13. Security and privacy

### Secrets

- **Production**: only via `npx wrangler secret put NAME` - stored encrypted on Cloudflare,
  read per invocation (no redeploy needed after a rotation).
- **Local**: `.dev.vars`, which `.gitignore` excludes (along with `node_modules/`, `dist/`,
  `.wrangler/`, `*.log`). `.dev.vars.example` has empty values on purpose so it is safe to
  commit. Never put a secret in `wrangler.toml`, in a script, or in chat - and never commit
  one. A secret that ever reached git must be treated as compromised.

### Rotating keys

```powershell
# API provider key (issue the new key first):
npx wrangler secret put NERKH_API_KEY

# Bot token: BotFather -> /revoke -> then:
npx wrangler secret put TELEGRAM_BOT_TOKEN
# ...and re-run setWebhook (step 8.8): the token changed

# Webhook secret: generate a new value (step 8.5), then:
npx wrangler secret put WEBHOOK_SECRET
# update .dev.vars too and re-run setWebhook - the old URL stops working immediately

# Admins:
npx wrangler secret put ADMIN_IDS          # "123456789,987654321"

# Remove anything no longer used:
npx wrangler secret delete NAME
```

### What user data is stored

| Stored | Where |
| --- | --- |
| chat id, first name, username, join time | `users.chat_id`, `first_name`, `username`, `joined_at` |
| language preference | `users.lang` (`fa` default) |
| subscription and blocked flags | `users.subscribed`, `users.blocked` |
| manual-price cooldown timestamp | `users.last_manual_at` |

**No message content is ever stored.** `/stop` or the Leave button sets `subscribed = 0`;
blocking the bot flags the row and unsubscribes it (§10).

- Only accounts in `ADMIN_IDS` can open `/admin`, press its buttons or run
  `/setup_profile`; everyone else gets no response at all. The panel shows only the
  **subscriber count** - no screen lists individual users, and admin toasts are answered
  only to the admin who pressed the button.
- The bot does not post into groups, does not read other chats, and ignores every
  non-private update.
- The short `/help` text tells users in one line what is stored about them; the full detail
  lives in this README.

### Webhook hardening

`WEBHOOK_SECRET` appears twice - in the URL path and in the secret header - and both are
checked with a constant-time comparison before the Worker parses anything. Wrong secret →
`401`, no work done.

## 14. Development

### npm scripts (all of them, from `package.json`)

| Script | What it runs |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` - includes the i18n key check |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` in watch mode |
| `npm run deploy:dry` | `wrangler deploy --dry-run --outdir dist` - bundle + config check, no account changes |
| `npm run deploy` | `wrangler deploy` |
| `npm run db:migrate:local` / `npm run db:migrate:remote` | `wrangler d1 migrations apply market-ping --local` / `--remote` |
| `npm run dev` | `wrangler dev --test-scheduled` |
| `npm run cf-typegen` | `wrangler types` |
| `npm run preview` | bundles `scripts/preview.ts` and renders messages, health panel and admin panel from `fixtures/` |

### Local development

`wrangler dev` reads `.dev.vars` and uses its own local D1 copy, so you never touch
production data:

```powershell
npx wrangler dev --test-scheduled
# in a second terminal, fire the real cron expression:
curl "http://localhost:8787/__scheduled?cron=30+5-17+*+*+*"
```

The Worker still re-checks the Tehran hour, so a run outside 09:00-21:00 logs
`cron.outside_window` and stops. `npm run preview` renders the message (both languages), the
stale/`~` variant, the health report and the admin panel from the committed fixtures with
zero network access - it is also where the samples in §2 came from.

### Project layout

```
wrangler.toml          Worker config: D1 binding, queue producer/consumer, the single cron
                       trigger, preview_urls = false, observability
package.json           npm scripts
migrations/            0001_init.sql, 0002_lang.sql (apply in this order)
fixtures/              Real captured API responses (keys removed) for tests and preview
scripts/               build-preview.mjs (bundler) + preview.ts (fixture renderer)
src/
  index.ts             Entry point: routes POST /telegram/* (404/401 handling)
  http.ts              fetchJson with timeout + retry policy (4xx not retried, 429 excepted)
  config.ts            Every tunable constant (window, limits, groups, tolerances)
  types.ts             Shared types, LANGS, DEFAULT_LANG
  security.ts          Constant-time secret compare, ADMIN_IDS parsing
  time.ts              Tehran/Jalali dates, weekday names, hour keys, send window
  labels.ts            Metric labels + order (shared by message and health panel)
  log.ts               Structured event logger (the events in §10)
  i18n/                index.ts (TextBundle types + t()), fa.ts, en.ts
  sources/             nerkh, navasan, megaweb, zipodo extractors + parallel fetchAll
  resolve/             resolver (priority/freshness/stale) + sanity guards
  render/              message template (groups, RLM, budget) + number formatting
  db/                  users, settings, snapshots, last_good, broadcastLog
  broadcast/           snapshot pipeline, cron handler, queue consumer, chunking
  telegram/            api, classify (error mapping), keyboards, commands, callbacks,
                       profile (/setup_profile), update routing
  admin/               panel (buttons, toasts) + API-health report
test/                  19 Vitest suites (+ fakes.ts and fixtures.ts helpers)
vitest.config.ts       Vitest configuration
tsconfig.json          TypeScript configuration
```

### Test suite

```powershell
npm run typecheck    # tsc --noEmit
npm test             # vitest run - currently 19 files / 184 tests, all green
npm run deploy:dry   # bundle + config check (no account changes)
npm run preview      # render messages/panels from the fixtures
```

Current real numbers (re-run `npm test` to confirm): **19 test files, 184 tests**. The
suites cover: every extractor against the committed fixtures (units, the x1000 coin trap,
derived BTC, per-key freshness, malformed payloads), cross-source agreement (3 % for
`usd_toman`, 1 % for the rest), the resolver (priority, freshness boundary, stale
`last_good`, `N/A`), the sanity guards, Jalali/Tehran formatting (all seven weekday names,
midnight boundary), message rendering (exact en/fa snapshots - base, `N/A`, stale +
approximate; the 26-line budget with the on-demand line; `CATEGORY_ORDER`; the per-language
Gold &amp; Coins row groups; Persian blockquote RTL safety: one RLM per line, U+200F-only
separators, no Latin units), chunking, error classification, the cron (window, OFF,
idempotency, fan-out, skipped, partial data), the consumer (per-chat progress, 429, ack
ordering, attempt cap, vanished snapshot), snapshots (reuse, refresh suppression, burst),
the admin panel (toggles, confirmation, `manual-<epoch>`, health view, non-admin silence),
the language flows and the `Last update` line (both languages, no city word).

DoD = the four commands above all pass. The samples in §2 are generated with
`npm run preview`, never typed by hand.
