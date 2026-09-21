// German tax years and calendar days follow local time (Europe/Berlin), not UTC:
// a trade at 2026-12-31 23:30 UTC happens on 2027-01-01 in Germany.

export const TAX_TIME_ZONE = "Europe/Berlin";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TAX_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(d: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(d)) p[type] = value;
  return p;
}

const asDate = (d: Date | string) => (typeof d === "string" ? new Date(d) : d);

/** Tax year of an instant in German local time. */
export const berlinYear = (d: Date | string) => Number(parts(asDate(d)).year);

/** "YYYY-MM-DD" in German local time. */
export function berlinDate(d: Date | string): string {
  const p = parts(asDate(d));
  return `${p.year}-${p.month}-${p.day}`;
}

/** "YYYY-MM" in German local time. */
export const berlinMonth = (d: Date | string) => berlinDate(d).slice(0, 7);

/** "YYYY-MM-DD HH:mm:ss" in German local time. */
export function berlinDateTime(d: Date | string): string {
  const p = parts(asDate(d));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

// January 1st is always in winter time (UTC+1), so tax year bounds are exact without a tz database.
/** First instant of the tax year. */
export const taxYearStart = (year: number) => new Date(Date.UTC(year, 0, 1) - 3_600_000);
/** First instant after the tax year. */
export const taxYearEnd = (year: number) => taxYearStart(year + 1);
