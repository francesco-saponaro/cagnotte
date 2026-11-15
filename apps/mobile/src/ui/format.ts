import { formatEuros } from "@cagnotte/domain";

/*
 * How the screens write the domain's numbers and dates. Money comes from the domain's own
 * `formatEuros` so the app and the API agree to the cent; the rest is the French way of writing.
 */

export interface RateLike {
  rateKind: "percent" | "fixed";
  rateBps: number;
  fixedCents: number;
}

/** 600 bps → "6 %"; 250 → "2,5 %"; a fixed amount → "5,00 €". */
export function formatRate(offer: RateLike): string {
  if (offer.rateKind === "fixed") return formatEuros(offer.fixedCents);
  const percent = offer.rateBps / 100;
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/0$/, "").replace(".", ",");
  return `${text} %`;
}

export function offerRateLabel(offer: RateLike & { minSpendCents: number }): string {
  const base = `${formatRate(offer)} back`;
  return offer.minSpendCents > 0 ? `${base} from ${formatEuros(offer.minSpendCents)}` : base;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** "14 janv. 2027", for dates read once. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const two = (n: number) => String(n).padStart(2, "0");

/** "14/01/2027", for dates in a column. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** The ISO day of a date, "2027-01-14", for a date field. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "today", "tomorrow", "in 10 days", "5 days ago". */
export function inDays(iso: string, now: Date = new Date()): string {
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / DAY);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** A ledger amount with its sign: "+11,69 €", "−20,00 €", "0,00 €". */
export function formatSigned(cents: number): string {
  if (cents > 0) return `+${formatEuros(cents)}`;
  if (cents < 0) return `−${formatEuros(-cents)}`;
  return formatEuros(0);
}

export { formatEuros };
