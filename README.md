# Market Ping

A Telegram bot that sends Iranian market prices (US Dollar, Bitcoin, Gold and Coins) to every
subscriber once an hour, from 09:00 to 21:00 Tehran time - 13 messages a day. It runs entirely
on the Cloudflare **free plan**: one Worker, one D1 database, one queue and a single cron
trigger. The bot speaks **Persian (default) and English** - a new user sees the Persian welcome
first and can switch with the `🌐` button or `/language` (admin panel, admin alerts and
API-health stay English). Nothing is sent to a user unless they tap *Join*.

## What a user sees

```
📈 <b>Market Ping</b>
3Shanbe, 7 Mehr 1405 | 10:34 Tehran

💱 <b>Rates</b>
<pre>USD         244,800 T
Bitcoin       $83,989
Gold Ounce     $4,142</pre>

🥇 <b>Gold (per gram)</b>
<pre>Tala Garam  24,835,000 T</pre>

🪙 <b>Coins</b>
<pre>Rob Seke     68,500,000 T
Nim Seke    127,800,000 T
Tamam Seke  243,500,000 T
Emami       250,100,000 T</pre>

<i>T = Toman | Source: Nerkh, Megaweb</i>
```

Missing values print `N/A`. A value that could not be refreshed within 3 hours gets a `*` and a
footnote (`* USD: last update 6 Mehr 1405 20:58`). The USDT-derived fallback USD rate is shown as
`~249,950 T` with the note `~ via USDT rate`. These screenshots come from the committed API
fixtures - see `npm run preview` below.

## How it works

```
Telegram ──webhook──▶ Worker fetch()      ──▶ D1 (users, settings, snapshots, last_good, broadcast_log)
Cron 30 5-17 * * * ─▶ Worker scheduled()  ──▶ fetch 4 sources ─▶ resolve ─▶ snapshot ─▶ queue (chunks of 15)
                                            Queue consumer ─▶ sendMessage (≤15 per invocation)
Admin ──/admin──────▶ Worker fetch()      ──▶ ON/OFF, Send now, API health, Refresh
```

* **Sources**: Nerkh (primary), Navasan (second), Megaweb (BTC/USD only) and Zipodo (last-resort
  approximate USD). All four are fetched in parallel with an 8 s timeout and one retry.
* **Resolution**: for every metric the sources are walked in priority order; the first value
  within 180 minutes wins. Otherwise the newest timestamp among the live values and the stored
  `last_good` value wins, marked stale. Otherwise `N/A`.
* **Guards**: 30 % deviation from `last_good`, `coin_emami / gold18` ratio 5-15 (catches a missing
  x1000 on Navasan coins) and `usdt / usd` ratio 0.9-1.15 (skipped for the approximate source).
* **Why a queue**: the free plan allows 50 subrequests per invocation, so a single invocation can
  never message everybody. The cron stores one snapshot and enqueues the subscribers in chunks of
  15; each consumer invocation sends at most 15 messages.

## Project layout

```
wrangler.toml          Worker, D1 binding, queue producer/consumer, the single cron trigger
migrations/            D1 schema (0001_init.sql, 0002_lang.sql for the language columns)
fixtures/              Real captured API responses (keys removed) used by the tests and preview
src/config.ts          Every tunable constant (send window, timeouts, limits, tolerances)
src/labels.ts          Single source of truth for metric labels + order (message and admin panel)
src/i18n/              Persian (fa, default) and English (en) text; both implement the same type
src/time.ts            Tehran/Jalali dates, weekday names, hour keys, send window
src/sources/           One extractor per source + the parallel fetcher
src/resolve/           Sanity guards and the resolver
src/render/            Message template and number formatting
src/db/                users, settings, snapshots, last_good, broadcast_log
src/broadcast/         Snapshot pipeline, cron handler, queue consumer, chunking
src/telegram/          Bot HTTP API, classification, keyboards, commands, callbacks
src/admin/             Admin panel and the live API-health report
test/                  Vitest suites (+ fakes for D1, Queue and the network)
scripts/preview.ts     Renders the message, health panel and admin panel from the fixtures
```

## Requirements

* Node.js 20 or newer and npm.
* A Telegram bot token from [@BotFather](https://t.me/BotFather).
* API keys for [Nerkh](https://nerkh.io) and [Navasan](https://navasan.tech).
* A Cloudflare account (free).

## First-time setup

Everything below is copy-paste. Steps 1-3 need your Cloudflare account; steps 4-7 need your
secrets. No secret is ever printed by these commands.

### 1. Install and log in

```bash
npm install
npx wrangler login
```

### 2. Create the D1 database

```bash
npx wrangler d1 create market-ping
```

Copy the `database_id` value it prints into `wrangler.toml`, replacing
`00000000-0000-0000-0000-000000000000`.

### 3. Create the queue

```bash
npx wrangler queues create market-ping-broadcast
```

### 4. Apply the database schema

```bash
npm run db:migrate:local     # the local D1 used by `wrangler dev`
npm run db:migrate:remote    # the deployed database
```

Both commands apply every pending migration in order: `0001_init.sql` (the initial schema) and
`0002_lang.sql` (the `users.lang` column, the `snapshots.html_fa` / `html_en` columns and the
`(subscribed, lang)` index; existing users become Persian). Run the remote command **before**
deploying a build that contains phase-2 code.

### 5. Set the secrets

Each command prompts for the value; paste it and press Enter. Never put a secret in a file that
is committed, and never paste one into a chat.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN   # from @BotFather
npx wrangler secret put WEBHOOK_SECRET       # random 32+ chars (see below)
npx wrangler secret put ADMIN_IDS            # your numeric Telegram id(s), comma separated
npx wrangler secret put NERKH_API_KEY
npx wrangler secret put NAVASAN_API_KEY
```

Generate a `WEBHOOK_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Find your numeric Telegram id by messaging [@userinfobot](https://t.me/userinfobot).

### 6. Local secrets for development

```bash
cp .dev.vars.example .dev.vars
```

Fill in the same five values. `.dev.vars` is git-ignored; `.dev.vars.example` deliberately has
empty values so it is safe to commit.

### 7. Deploy

```bash
npm run deploy:dry   # bundles and validates the config, changes nothing
npm run deploy
```

Wrangler prints your Worker URL, normally `https://market-ping.<your-subdomain>.workers.dev`.

### 8. Point Telegram at the Worker

The webhook path is `/telegram/<WEBHOOK_SECRET>` and the same secret is sent in the
`X-Telegram-Bot-Api-Secret-Token` header. Both are read from the environment, so neither the token
nor the secret ends up in your shell history or in this file:

```bash
set -a; . <(tr -d '\r' < .dev.vars); set +a

curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://market-ping.<your-subdomain>.workers.dev/telegram/${WEBHOOK_SECRET}" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message","callback_query","my_chat_member"]'
```

(`tr -d '\r'` only exists to survive Windows line endings. On PowerShell you can set the same
variables with `Get-Content .dev.vars | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { Set-Item "env:$($matches[1])" $matches[2] } }`.)

Check it (the answer shows your secret path, so do not share the output):

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Expected: your `.../telegram/...` URL, `"pending_update_count": 0` and no `last_error_message`.

### 9. Try it in Telegram

New users see the Persian welcome first (with `[🌐 English]`); use `/language` for the picker
(`[🇮🇷 فارسی] [🇬🇧 English]`) or tap the `🌐` button to toggle in place.

* Send `/start` - welcome text with the Join/Leave + `Get prices` buttons.
* Tap **Join hourly updates** (fa: `✅ عضویت در قیمت‌های ساعتی`) - you are subscribed; you get the
  current stored prices (or the time of the next update) and the button becomes Leave / `🚪 لغو عضویت`.
* Tap **Get prices now** (or send `/price`) - the newest stored snapshot in your language, with a
  `🕒 Last update` / `🕒 آخرین به‌روزرسانی` line. One request per minute per user.
* Send `/help` for what is stored, `/stop` to leave.
* From an `ADMIN_IDS` account send `/admin` - the admin panel (below). After the first deploy,
  also run `/setup_profile` once from an admin account: it writes the localized command list,
  description and short description (default + `fa` + `en`, 9 calls) and replies with a per-call
  OK/FAIL summary.

### 10. Local development

`wrangler dev` reads `.dev.vars` and uses its own local D1 copy, so you can work without touching
production data:

```bash
npx wrangler dev
```

Test the hourly cron without waiting for the clock:

```bash
npx wrangler dev --test-scheduled
# in a second terminal, fire the real cron expression:
curl "http://localhost:8787/__scheduled?cron=30+5-17+*+*+*"
```

The Worker still re-checks the Tehran hour, so a run outside 09:00-21:00 logs
`cron.outside_window` and stops. Render the message, health report and admin panel from the
committed fixtures without any network access:

```bash
npm run preview
```

### 11. Watching a broadcast

```bash
npx wrangler tail                     # live structured logs
npx wrangler tail --format pretty
```

Useful events: `cron.done`, `cron.skipped_no_data` (all sources failed - admins also get a
Telegram alert), `cron.already_claimed` (idempotency kicked in), `source.fetched`,
`broadcast.enqueued`, `queue.reenqueued`, `queue.gave_up`, `admin.service_changed`,
`sanity.warning`. Logs never contain tokens, keys or URLs with keys.

Broadcast history and subscriber count:

```bash
npx wrangler d1 execute market-ping --remote \
  --command "SELECT hour_key, total, sent, blocked, failed, status FROM broadcast_log ORDER BY started_at DESC LIMIT 5"

npx wrangler d1 execute market-ping --remote \
  --command "SELECT COUNT(*) AS subscribers FROM users WHERE subscribed = 1 AND blocked = 0"
```

### 12. The admin panel

Send `/admin` from an account listed in `ADMIN_IDS` (every non-admin gets no reply at all).
Every button edits the same message in place:

| Button | What it does |
| --- | --- |
| `🔴 Turn OFF` / `🟢 Turn ON` | Flips the whole service. While OFF nobody gets hourly or manual prices, but users can still join and leave. |
| `📤 Send now` | Asks `Send prices to N subscribers now?` then runs the normal broadcast pipeline under its own `manual-<epoch>` log key. Refused while the service is OFF. |
| `📡 API health` | Fetches all four sources live: per-source OK/FAIL, latency, HTTP status or error type, the live USD value per source with the spread, and every resolved value with its source. This is how you see geo-blocking. |
| `🔄 Refresh` | Reloads the panel (also the way back from the health view). |

The panel, its alerts and the health view are English only; every user-facing message
(welcome, Join/Leave confirmations, `/price`, `/help`, `/language`, errors, cooldown, the
hourly broadcast and its `🕒 Last update` / `🕒 آخرین به‌روزرسانی` line) follows the user's
stored language (`users.lang`, Persian by default).

The panel shows the service state, the subscriber count and
`Last broadcast: <Tehran time> - sent X, blocked Y, failed Z`, with a `[pending]` or `[skipped]`
tag when the newest run has not finished.

### 13. Rotating keys

Secrets are read per invocation, so no redeploy is needed after a rotation.

```bash
# provider key (issue the new key first, then):
npx wrangler secret put NERKH_API_KEY

# bot token: BotFather -> /revoke -> then:
npx wrangler secret put TELEGRAM_BOT_TOKEN
# and re-run the setWebhook command from step 8 (token and secret both change there)

# webhook secret: generate a new one (step 5), then:
npx wrangler secret put WEBHOOK_SECRET
# update .dev.vars and re-run setWebhook - the old URL stops working immediately

# admins:
npx wrangler secret put ADMIN_IDS          # "123456789,987654321"
```

Remember to update `.dev.vars` too, and to delete (`npx wrangler secret delete NAME`) anything that
is no longer used. A secret that ever reached git must be treated as compromised.

## Troubleshooting

**The bot replies to nothing.** Run `getWebhookInfo` (step 8). If `url` is empty, set it again. A
`401` from the Worker means the path secret and the `X-Telegram-Bot-Api-Secret-Token` header
disagree - re-run `setWebhook`. `wrangler tail` shows `webhook.unauthorized` for those.

**API health shows FAIL for an Iranian source.** Iranian providers sometimes block Cloudflare
(and other hosting) egress IPs; from a home connection Zipodo was already unreachable while this
was built (the server closes the connection). The bot is designed around it: the remaining
sources fill the snapshot, older values are served as `*` stale with a footnote, and nothing
crashes. If a source stays blocked, reorder it in `src/sources/fetchAll.ts` +
`src/resolve/resolver.ts`, or put your own proxy in front of it. `403` responses are deliberately
not retried (they save subrequest budget), while timeouts are.

**429 Too Many Requests.** The consumer reads `parameters.retry_after`, stops the chunk,
re-enqueues **only** the subscribers it did not reach with `delaySeconds = retry_after`, and acks
the original message only after that enqueue succeeded. Progress is tracked per chat id, so nobody
is messaged twice. Telegram allows roughly 30 messages per second for broadcasts; with
`CHUNK_SIZE = 15` and `max_concurrency = 2` the bot stays far below that.

**"All price sources failed" alert.** All four sources were unreachable for that hour: the run is
logged as `skipped`, no message is sent and every admin gets one short alert. Check the API health
view, then retry with `Send now` once at least one source answers.

**The hourly message did not arrive.** Cron expressions are UTC: `30 5-17 * * *` means
05:30-17:30 UTC = 09:00-21:00 Tehran. Look for `cron.outside_window` (the Tehran-hour guard),
`cron.already_claimed` (that hour was already handled) or `cron.failed`.

**Free-plan limits.**

| Limit (free plan) | How the code stays inside it |
| --- | --- |
| 50 subrequests per invocation | The cron does ~8 fetches + a few D1 statements; a consumer invocation does at most 15 sends + 2 statements. No invocation ever messages everybody. |
| 10 ms CPU per invocation | Payloads are parsed and immediately reduced to candidates, no `Intl`, small bundle (~19 KiB gzipped). |
| 100,000 requests per day | A few webhook calls plus 13 cron runs per day. |
| 1 cron trigger (5 allowed) | Exactly one: `30 5-17 * * *`. |
| D1: 5M rows read / 100k rows written per day | Index-backed reads and batched writes; a normal day uses a tiny fraction. |
| Queues: 10,000 operations per day | About 3 operations per delivered chunk message. |

**Capacity.** With `CHUNK_SIZE = 15` and 13 runs a day, the 10,000 daily queue operations support
roughly 250 chunk messages per run - about 3,800 subscribers. With fewer than 500 subscribers a
full day costs around 1,300 operations. Raising `CHUNK_SIZE` lowers the queue usage but increases
the chance of Telegram 429s; raising `max_concurrency` shortens a broadcast but hits the 30 msg/s
limit sooner.

**Retention.** Snapshots older than 3 days are pruned on every cron run. `last_good` keeps one row
per metric and is what feeds stale values. Users are never deleted - a blocked account is flagged
and unsubscribed.

## Units, dates and labels (for maintainers)

* Every Iranian price is normalised to plain **Toman**. Nerkh already quotes Toman; Navasan quotes
  **coins in thousand Toman** (multiplied by 1000) and its `usd_xau` is USD while the un-prefixed
  `xau` is Toman. Each extractor reads only the documented keys and ignores the rest
  (`bub_*`, `mob_*`, `GOLD24K`, `MAZANEH`, ...).
* `Bitcoin` is taken from Megaweb (the only source returning USD directly) or derived as
  `BTC / USDT` from a Toman pair (about 0.1 % off).
* Dates are Jalali in Tehran local time and use English digits:
  `3Shanbe, 7 Mehr 1405 | 09:00 Tehran`. The weekday is computed from the **Tehran** wall clock via
  an array indexed by the Tehran weekday number, and API timestamps are converted with
  `jalaaliToEpochSec()` (Jalali string treated as Tehran local time, offset applied once in
  `src/config.ts`).
* Labels and their order live in one place, `src/labels.ts`, and are shared by the hourly message
  and the admin panel.

## Tests and definition of done

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run deploy:dry   # wrangler bundle + config check (no account changes)
npm run preview      # renders the message, health report and panel from the fixtures
```

The suites cover: every extractor against the committed fixtures (units, the x1000 coin trap,
derived BTC, per-key freshness, malformed payloads), cross-source agreement (3 % for `usd_toman`,
1 % for everything else), the resolver (priority, freshness boundary, stale `last_good` fallback,
`N/A`), the sanity guards, Jalali/Tehran formatting including all seven weekday names and a
midnight boundary, message rendering (`N/A`, `*`, `~`, escaping, line budget), chunks, error
classification, the cron (window, OFF, idempotency, fan-out, `sentBatch` splitting, skipped,
partial data), the consumer (per-chat progress, 429, ack ordering, attempt cap, vanished
snapshot), snapshots (reuse, refresh suppression, burst) and the admin panel (toggles,
confirmation, manual key, health view, non-admin silence).

## Version control

`.gitignore` already excludes the things that must never be committed: `.dev.vars`,
`node_modules/`, `.wrangler/`, `dist/` and logs. `.dev.vars.example` keeps empty values on purpose,
so it is safe to commit. If a secret ever reaches git, rotate it and remove it from history.

## Privacy

Stored per user: chat id, first name, username and join time, plus the manual-price cooldown
timestamp. No message content is stored. `/stop` or the Leave button sets `subscribed = 0`; if a
user blocks the bot, Telegram tells the Worker and the account is flagged blocked and
unsubscribed. Groups and channels are ignored completely.
