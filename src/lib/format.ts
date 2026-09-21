/**
 * Parses an amount typed by a German or English user: "1.234,56", "1234,56", "1,234.56", "1234.56".
 * The last "," or "." followed by 1–2 digits is the decimal separator; other separators are grouping.
 * Returns 0 for anything unparseable.
 */
export function parseEur(input: string): number {
  const s = input.replace(/[\s€]/g, "");
  const m = /^(.*?)[.,](\d{1,2})$/.exec(s);
  const whole = (m ? m[1] : s).replace(/[.,]/g, "");
  const n = Number(m ? `${whole}.${m[2]}` : whole);
  return Number.isFinite(n) ? n : 0;
}
