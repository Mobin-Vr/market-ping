import { t, type Lang, type MessageStrings } from '../i18n';
import { COIN_METRICS, GOLD_METRICS, RATE_METRICS, rowsFor, type MetricLabel } from '../labels';
import type { MetricName, ResolvedMetric, ResolvedMetrics, SnapshotData } from '../types';
import { escapeHtml, groupDigits } from './format';

/** "244,800 T", "$4,143", "~249,950 T", "244,800 T*", "N/A" */
function cell(metric: ResolvedMetric, usd: boolean, strings: MessageStrings): string {
   if (metric.value === null) return strings.na;
   const digits = groupDigits(metric.value);
   const body = usd ? strings.formatUsdValue(digits) : `${digits}${strings.tomanSuffix}`;
   return `${metric.approximate ? '~' : ''}${body}${metric.stale ? '*' : ''}`;
}

/** Right-aligns the value column and left-aligns the label column inside <pre>. */
function block(
   rows: readonly MetricLabel[],
   metrics: ResolvedMetrics,
   strings: MessageStrings,
): string {
   const cells = rows.map((row) => cell(metrics[row.metric], row.usd, strings));
   const labelWidth = Math.max(...rows.map((row) => strings.metricLabels[row.metric].length));
   const valueWidth = Math.max(...cells.map((value) => value.length));
   const lines = rows.map((row, index) => {
      const label = strings.metricLabels[row.metric].padEnd(labelWidth, ' ');
      const value = (cells[index] ?? '').padStart(valueWidth, ' ');
      return `${label}  ${value}`;
   });
   return `<pre>${lines.join('\n')}</pre>`;
}

/** Up to two footnote lines: stale markers first, then the approximate-source note. */
function footnotes(metrics: ResolvedMetrics, strings: MessageStrings): string[] {
   const stale = RATE_METRICS.concat(GOLD_METRICS, COIN_METRICS).filter((metric) => {
      const item = metrics[metric];
      return item.stale && item.value !== null;
   });
   const lines: string[] = [];

   if (stale.length === 1) {
      const metric = stale[0];
      const item = metrics[metric];
      lines.push(
         escapeHtml(
            strings.staleOne(strings.metricLabels[metric], strings.shortDate(item.updatedAtEpochSec ?? 0)),
         ),
      );
   } else if (stale.length > 1) {
      const shown = stale.slice(0, 2).map((metric) => {
         const item = metrics[metric];
         return `${strings.metricLabels[metric]} (${strings.shortDate(item.updatedAtEpochSec ?? 0)})`;
      });
      const extra = stale.length - shown.length;
      lines.push(escapeHtml(strings.staleMany(shown, extra)));
   }

   const hasApproximate = RATE_METRICS.concat(GOLD_METRICS, COIN_METRICS).some((metric) => {
      const item = metrics[metric];
      return item.approximate && item.value !== null;
   });
   if (hasApproximate) lines.push(escapeHtml(strings.approximateNote));

   return lines;
}

/**
 * Renders one language of the hourly message (HTML parse mode). The layout, the metric order
 * and the units come from src/labels.ts plus the language bundle, so the message and the
 * admin health panel stay consistent. Blank separator lines are kept; the structure is 14
 * non-empty lines plus up to 2 footnote lines, 20 display lines in total.
 */
export function renderMessage(data: SnapshotData, lang: Lang = 'en'): string {
   const strings = t(lang);
   const metrics = data.metrics;
   const parts = [
      strings.message.title,
      escapeHtml(strings.message.header(data.createdAt)),
      '',
      strings.message.headingRates,
      block(rowsFor(RATE_METRICS), metrics, strings.message),
      '',
      strings.message.headingGold,
      block(rowsFor(GOLD_METRICS), metrics, strings.message),
      '',
      strings.message.headingCoins,
      block(rowsFor(COIN_METRICS), metrics, strings.message),
      '',
      `<i>${escapeHtml(strings.message.footer(data.sources))}</i>`,
      ...footnotes(metrics, strings.message),
   ];
   return parts.join('\n');
}

/** Display lines (used by the tests to enforce the line budget). */
export function countDisplayLines(message: string): number {
   return message.split('\n').length;
}

/** Non-empty display lines. */
export function countNonEmptyLines(message: string): number {
   return message.split('\n').filter((line) => line.trim().length > 0).length;
}

/** Human-readable metric label in English (admin views). */
export function metricLabel(metric: MetricName): string {
   return t('en').message.metricLabels[metric];
}