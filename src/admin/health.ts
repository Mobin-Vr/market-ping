import { USD_CROSS_SOURCE_TOLERANCE_PCT } from '../config';
import { describeHttpOutcome } from '../http';
import { isUsdMetric, METRIC_LABELS } from '../labels';
import { escapeHtml, groupDigits } from '../render/format';
import { percentDifference } from '../resolve/sanity';
import type { FetchAllResult, SourceFetchResult } from '../sources/fetchAll';
import { formatTehranHeader } from '../time';
import type { MetricName, ResolvedMetrics, SourceName } from '../types';

function signedPct(value: number): string {
   return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function valueText(metric: MetricName, value: number | null): string {
   if (value === null) return 'N/A';
   return isUsdMetric(metric)
      ? `$${groupDigits(value)}`
      : `${groupDigits(value)} T`;
}

/** One row per source: OK/FAIL, HTTP status or error type, latency, retries, value count. */
function sourceLine(result: SourceFetchResult): string {
   const status = result.ok
      ? `HTTP ${result.status}`
      : describeHttpOutcome(result);
   const retried = result.attempts > 1 ? ` x${result.attempts}` : '';
   const shape = result.extraction.shapeError
      ? ` ${result.extraction.shapeError}`
      : '';
   const values = result.extraction.candidates.length;
   return [
      result.source.padEnd(8),
      (result.ok ? 'OK' : 'FAIL').padEnd(5),
      `${status}${retried}`.padEnd(12),
      `${result.latencyMs} ms`.padStart(7),
      `${values} value${values === 1 ? '' : 's'}`.padStart(9) + shape,
   ]
      .join(' ')
      .trimEnd();
}

interface UsdRow {
   source: SourceName;
   value: number;
}

/** Live usd_toman per source, plus the percentage difference against the resolved value. */
function usdSpreadBlock(
   fetch: FetchAllResult,
   metrics: ResolvedMetrics,
): string[] {
   const rows: UsdRow[] = [];
   for (const extraction of fetch.extractions) {
      const found = extraction.candidates.find(
         (candidate) => candidate.metric === 'usd_toman',
      );
      if (found) rows.push({ source: extraction.source, value: found.value });
   }
   if (rows.length === 0) return ['USD per source: no source returned a value'];

   const resolved = metrics.usd_toman.value;
   const base = resolved !== null && resolved > 0 ? resolved : rows[0].value;
   const lines: string[] = [];
   let worst = 0;
   for (const row of rows) {
      const diff = percentDifference(base, row.value);
      if (diff !== null && Math.abs(diff) > Math.abs(worst)) worst = diff;
      const flag =
         diff !== null && Math.abs(diff) > USD_CROSS_SOURCE_TOLERANCE_PCT
            ? ' (!)'
            : '';
      lines.push(
         `${row.source.padEnd(8)} ${`${groupDigits(row.value)} T`.padStart(12)} ${diff === null ? 'base' : signedPct(diff)}${flag}`,
      );
   }
   lines.push(
      `spread ${worst.toFixed(2)}% (info only, warn above ${USD_CROSS_SOURCE_TOLERANCE_PCT}%)`,
   );
   return lines;
}

/**
 * Admin diagnostics: per-source status, live usd_toman comparison, and the resolved value
 * of every metric with the source that supplied it.
 */
export function renderHealthPanel(
   fetchedAtEpochSec: number,
   fetch: FetchAllResult,
   metrics: ResolvedMetrics,
   warnings: readonly string[],
): string {
   const sourceLines = fetch.results.map(sourceLine).join('\n');
   const spreadLines = usdSpreadBlock(fetch, metrics).join('\n');
   const resolvedLines = METRIC_LABELS.map((row) => {
      const item = metrics[row.metric];
      const marker = item.stale ? '*' : '';
      const approx = item.approximate ? '~' : '';
      return [
         row.label.padEnd(14),
         `${approx}${valueText(row.metric, item.value)}${marker}`.padStart(16),
         item.source ?? '-',
      ]
         .join(' ')
         .trimEnd();
   }).join('\n');

   const parts = [
      '📡 <b>API health</b>',
      '',
      escapeHtml(formatTehranHeader(fetchedAtEpochSec)),
      '',
      '<b>Sources</b>',
      `<pre>${escapeHtml(sourceLines)}</pre>`,
      '',
      '<b>USD per source</b>',
      `<pre>${escapeHtml(spreadLines)}</pre>`,
      '',
      '<b>Resolved</b>',
      `<pre>${escapeHtml(resolvedLines)}</pre>`,
   ];
   if (warnings.length > 0) {
      parts.push(
         '',
         `<i>Sanity: ${escapeHtml(warnings.slice(0, 3).join(' | '))}</i>`,
      );
   }
   return parts.join('\n');
}
