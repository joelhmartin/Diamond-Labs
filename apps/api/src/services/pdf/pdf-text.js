/**
 * pdfkit's standard fonts draw WinAnsi only. Keep Latin-1 plus the common
 * typographic marks; anything else (emoji, CJK) would print as garbage, so it
 * becomes "?". Every PDF model runs its strings through deepPrintable.
 */
const UNPRINTABLE = /[^\n\x20-\x7E\u00A0-ÿ–—‘’“”•…]/gu;

export function printable(text) {
  return String(text).normalize("NFC").replace(UNPRINTABLE, "?");
}

export function deepPrintable(value) {
  if (typeof value === "string") return printable(value);
  if (Array.isArray(value)) return value.map(deepPrintable);
  if (value instanceof Date) return value;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepPrintable(v)]));
  return value;
}
