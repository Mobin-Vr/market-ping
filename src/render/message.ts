import { CATEGORY_ORDER, FA_LAYOUT, GOLD_COIN_ROW_GROUPS, type PriceCategory } from '../config';
import { RLM, t, type Lang, type MessageStrings } from '../i18n';
import {
  COIN_METRICS,
  CRYPTO_METRICS,
  CURRENCY_METRICS,
  GOLD_COINS_METRICS,
  GOLD_METRICS,
  RATE_METRICS,
  rowsFor,
  type MetricLabel,
} from '../labels';
import type { MetricName, ResolvedMetric, ResolvedMetrics, SnapshotData } from '../types';
import { escapeHtml, groupDigits } from './format';

/** Right-to-left mark: prefixes every Persian text line (RTL safety). Re-exported from the i18n layer. */
export { RLM };

/** Prefixes one line with RLM unless it already starts with one (no doubling). */
export function rlm(line: string): string {
  return line.startsWith(RLM) ? line : `${RLM}${line}`;
}

/** "244,800 T", "$4,143", "~249,950 T", "244,800 T*", "N/A" */
function cell(metric: ResolvedMetric, usd: boolean, strings: MessageStrings): string {
   if (metric.value === null) return strings.na;
   const digits = groupDigits(metric.value);
   const body = usd ? strings.formatUsdValue(digits) : `${digits}${strings.tomanSuffix}`;
   return `${metric.approximate ? '~' : ''}${body}${metric.stale ? '*' : ''}`;
}

/**
 * Right-aligns the value column and left-aligns the label column inside <pre>.
 * Row groups are separated by one truly empty line; both column widths are computed
 * over the whole block, so the separators never affect the alignment.
 */
function preBlock(
   groups: readonly (readonly MetricLabel[])[],
   metrics: ResolvedMetrics,
   strings: MessageStrings,
): string {
   const rows = groups.flat();
   const cells = new Map<MetricName, string>();
   for (const row of rows) cells.set(row.metric, cell(metrics[row.metric], row.usd, strings));
   const labelWidth = Math.max(...rows.map((row) => strings.metricLabels[row.metric].length));
   const valueWidth = Math.max(...rows.map((row) => (cells.get(row.metric) ?? '').length));
   const lines: string[] = [];
   for (const [index, group] of groups.entries()) {
      if (index > 0) lines.push('');
      for (const row of group) {
         const label = strings.metricLabels[row.metric].padEnd(labelWidth, ' ');
         const value = (cells.get(row.metric) ?? '').padStart(valueWidth, ' ');
         lines.push(`${label}  ${value}`);
      }
   }
   return `<pre>${lines.join('\n')}</pre>`;
}

/** One Persian row: label, colon, number, unit after the number. */
function faRow(row: MetricLabel, metrics: ResolvedMetrics, strings: MessageStrings): string {
  const metric = metrics[row.metric];
  const label = strings.metricLabels[row.metric];
  if (metric.value === null) return rlm(`${label}: ${strings.na}`);
  const digits = groupDigits(metric.value);
  const body = row.usd ? strings.formatUsdValue(digits) : `${digits}${strings.tomanSuffix}`;
  return rlm(`${label}: ${metric.approximate ? '~' : ''}${body}${metric.stale ? '*' : ''}`);
}

function categoryMetrics(category: PriceCategory): readonly MetricName[] {
  if (category === 'currency') return CURRENCY_METRICS;
  if (category === 'goldCoins') return GOLD_COINS_METRICS;
  return CRYPTO_METRICS;
}

/**
 * Row groups of one category, separated by one blank line. Only Gold & Coins has
 * more than one group; the per-language grouping lives in GOLD_COIN_ROW_GROUPS.
 */
function rowGroups(
  category: PriceCategory,
  rows: readonly MetricLabel[],
  lang: Lang,
): readonly (readonly MetricLabel[])[] {
  if (category !== 'goldCoins') return [rows];
  const byMetric = new Map(rows.map((row) => [row.metric, row] as const));
  const groups: (readonly MetricLabel[])[] = [];
  for (const metric of GOLD_COIN_ROW_GROUPS[lang]) {
    const group = metric
      .map((name) => byMetric.get(name))
      .filter((row): row is MetricLabel => row !== undefined);
    if (group.length > 0) groups.push(group);
  }
  return groups;
}

/** Persian body lines. Blank group separators carry only U+200F so Telegram keeps them. */
function faBlock(
  groups: readonly (readonly MetricLabel[])[],
  metrics: ResolvedMetrics,
  strings: MessageStrings,
): string {
  const lines: string[] = [];
  for (const [index, group] of groups.entries()) {
    if (index > 0) lines.push(RLM);
    for (const row of group) lines.push(faRow(row, metrics, strings));
  }
  return lines.join('\n');
}

function categoryHeading(category: PriceCategory, strings: MessageStrings): string {
  if (category === 'currency') return strings.headingCurrency;
  if (category === 'goldCoins') return strings.headingGoldCoins;
  return strings.headingCrypto;
}

function categorySection(
  category: PriceCategory,
  metrics: ResolvedMetrics,
  strings: MessageStrings,
  lang: Lang,
  faLayout: 'blockquote' | 'pre',
): string[] {
  const groups = rowGroups(category, rowsFor(categoryMetrics(category)), lang);
  const heading = lang === 'fa' ? rlm(categoryHeading(category, strings)) : categoryHeading(category, strings);
  if (lang === 'fa') {
    const body = faBlock(groups, metrics, strings);
    return [heading, faLayout === 'blockquote' ? `<blockquote>${body}</blockquote>` : `<pre>${body}</pre>`];
  }
  return [heading, preBlock(groups, metrics, strings)];
}

/** Up to two footnote lines: stale markers first, then the approximate-source note. */
function footnotes(metrics: ResolvedMetrics, strings: MessageStrings, lang: Lang): string[] {
   const stale = RATE_METRICS.concat(GOLD_METRICS, COIN_METRICS).filter((metric) => {
      const item = metrics[metric];
      return item.stale && item.value !== null;
   });
   const lines: string[] = [];

   if (stale.length === 1) {
      const metric = stale[0];
      const item = metrics[metric];
      const text = strings.staleOne(strings.metricLabels[metric], strings.shortDate(item.updatedAtEpochSec ?? 0));
      lines.push(lang === 'fa' ? rlm(escapeHtml(text)) : escapeHtml(text));
   } else if (stale.length > 1) {
      const shown = stale.slice(0, 2).map((metric) => {
         const item = metrics[metric];
         return `${strings.metricLabels[metric]} (${strings.shortDate(item.updatedAtEpochSec ?? 0)})`;
      });
      const extra = stale.length - shown.length;
      lines.push(lang === 'fa' ? rlm(escapeHtml(strings.staleMany(shown, extra))) : escapeHtml(strings.staleMany(shown, extra)));
   }

   const hasApproximate = RATE_METRICS.concat(GOLD_METRICS, COIN_METRICS).some((metric) => {
      const item = metrics[metric];
      return item.approximate && item.value !== null;
   });
   if (hasApproximate) lines.push(lang === 'fa' ? rlm(escapeHtml(strings.approximateNote)) : escapeHtml(strings.approximateNote));

   return lines;
}

/**
 * Renders one language of the hourly message (HTML parse mode). The layout, the metric order,
 * the Gold & Coins row groups and the units come from src/config.ts (CATEGORY_ORDER,
 * GOLD_COIN_ROW_GROUPS, FA_LAYOUT) plus the language bundle. There is no source footer any more;
 * the stale "*" and approximate "~" footnotes appear only when needed. The trailing blank line
 * after the last category is intentional: the on-demand "Last update" note is appended after it.
 * The admin health panel shares labels but keeps its own flat order on purpose (see src/labels.ts).
 */
export interface FaLayoutOptions { faLayout?: 'blockquote' | 'pre'; }

export function renderMessage(data: SnapshotData, lang: Lang = 'en', options: FaLayoutOptions = {}): string {
  const strings = t(lang);
  const metrics = data.metrics;
  const faLayout = options.faLayout || FA_LAYOUT;
  const headerText = strings.message.header(data.createdAt);
  const header = lang === 'fa' ? rlm(escapeHtml(headerText)) : escapeHtml(headerText);
  const parts = [strings.message.title, '', header, ''];
  for (const category of CATEGORY_ORDER) {
    const secs = categorySection(category, metrics, strings.message, lang, faLayout);
    for (const sec of secs) parts.push(sec);
    parts.push('');
  }
  for (const note of footnotes(metrics, strings.message, lang)) parts.push(note);
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