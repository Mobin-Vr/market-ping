/**
 * Dev-only preview. Renders the hourly message and the admin API health panel from the
 * committed fixtures: no network calls, no secrets, nothing is sent anywhere.
 *
 *   npm run preview
 */
import { renderHealthPanel } from "../src/admin/health";
import { adminPanelKeyboard, renderAdminPanel } from "../src/admin/panel";
import { countDisplayLines, countNonEmptyLines, renderMessage } from "../src/render/message";
import { resolveMetrics } from "../src/resolve/resolver";
import { pickUsdtHelper, type FetchAllResult } from "../src/sources/fetchAll";
import { extractMegaweb } from "../src/sources/megaweb";
import { extractNavasan } from "../src/sources/navasan";
import { extractNerkh } from "../src/sources/nerkh";
import { extractZipodo } from "../src/sources/zipodo";
import { formatTehranHeader } from "../src/time";
import megawebFixture from "../fixtures/megaweb.json";
import navasanFixture from "../fixtures/navasan.json";
import nerkhFixture from "../fixtures/nerkh.json";
import zipodoFixture from "../fixtures/zipodo.json";

const NOW = 1790665481;

const extractions = [
  extractNerkh(nerkhFixture as unknown, NOW),
  extractNavasan(navasanFixture as unknown, NOW),
  extractMegaweb(megawebFixture as unknown, NOW),
  extractZipodo(zipodoFixture as unknown, NOW),
];
const candidates = extractions.flatMap((extraction) => extraction.candidates);
const fetched: FetchAllResult = {
  results: extractions.map((extraction, index) => ({
    source: extraction.source,
    ok: true,
    status: 200,
    latencyMs: 412 + index * 57,
    errorName: null,
    attempts: 1,
    extraction,
  })),
  extractions,
  candidates,
};
const resolved = resolveMetrics(candidates, {}, pickUsdtHelper(extractions)?.value ?? null, NOW);

function rule(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

rule("1) Hourly message, English (HTML source, exactly what Telegram receives)");
function showMessage(lang: "fa" | "en", metrics: typeof resolved.metrics, sources: typeof resolved.usedSources): void {
  const message = renderMessage(
    {
      hourKey: "2026-09-29-10",
      createdAt: NOW,
      metrics,
      sources,
    },
    lang,
  );
  console.log(message);
  console.log(`\n[${lang}] [${countDisplayLines(message)} display lines, ${countNonEmptyLines(message)} non-empty]`);
}

showMessage("en", resolved.metrics, resolved.usedSources);

rule("1b) Hourly message, Persian");
showMessage("fa", resolved.metrics, resolved.usedSources);

rule("2) Same message with a STALE usd_toman (navasan) and the approximate marker");
const staleMetrics = { ...resolved.metrics };
staleMetrics.usd_toman = {
  metric: "usd_toman",
  value: 244000,
  source: "navasan",
  updatedAtEpochSec: 1790616530,
  stale: true,
  approximate: false,
};
showMessage("en", staleMetrics, ["nerkh", "navasan", "megaweb"]);

rule("3) Admin API health panel (fixture data)");
console.log(renderHealthPanel(NOW, fetched, resolved.metrics, resolved.warnings));

rule("4) Resolved values");
for (const [metric, item] of Object.entries(resolved.metrics)) {
  const marker = `${item.stale ? " stale" : ""}${item.approximate ? " approx" : ""}`;
  console.log(`${metric.padEnd(18)} ${String(item.value).padStart(12)}  ${item.source ?? "-"}${marker}`);
}
console.log(`\nheader:  ${formatTehranHeader(NOW)}`);
console.log(`sources: ${resolved.usedSources.join(", ")}`);
console.log(`warn:    ${resolved.warnings.length === 0 ? "none" : resolved.warnings.join(" | ")}`);

rule("5) Admin panel (sample data)");
console.log(
  renderAdminPanel({
    serviceEnabled: true,
    subscribers: 42,
    lastBroadcast: {
      hour_key: "2026-09-29-10",
      started_at: NOW,
      total: 42,
      sent: 40,
      blocked: 1,
      failed: 1,
      status: "done",
    },
  }),
);
console.log(
  adminPanelKeyboard(true)
    .inline_keyboard.map((row) => row.map((button) => button.text).join("  |  "))
    .join("\n"),
);
