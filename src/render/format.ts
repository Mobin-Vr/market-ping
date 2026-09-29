/** HTML-escapes dynamic text (Telegram parse_mode = HTML). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Groups the integer part with thousands separators (no Intl: same output everywhere). */
export function groupDigits(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Whole number with thousands separators: 24835000 -> "24,835,000". */
export function formatInt(value: number): string {
  return groupDigits(value);
}

/** 249500000 -> "249,500,000 T" */
export function formatToman(value: number): string {
  return `${groupDigits(value)} T`;
}

/** 4142.35 -> "$4,142" (USD values are rounded to whole dollars) */
export function formatUsd(value: number): string {
  return `$${groupDigits(value)}`;
}
