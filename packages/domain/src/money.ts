/**
 * Money is integer cents and a rate is integer basis points (1 bps = 0.01 %), so every sum in the
 * ledger is exact and two services never disagree by a cent. Nothing here touches floating point
 * except the one place a rate is applied, and that is rounded once, half up.
 */

const MAX_BPS = 10_000;

function assertCents(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${what} must be a whole number of cents, got ${value}`);
}

function assertBps(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BPS) throw new RangeError(`rate must be 0..10000 basis points, got ${value}`);
}

/** `base` cents at `rateBps`, rounded half up to the cent. Never more than the base. */
export function applyRate(baseCents: number, rateBps: number): number {
  assertCents(baseCents, "base");
  assertBps(rateBps);
  // Integer arithmetic only: (base * bps + 5000) / 10000 floored is round-half-up of base * bps / 10000.
  return Math.floor((baseCents * rateBps + MAX_BPS / 2) / MAX_BPS);
}

/** 4.2 → 420. Accepts at most two decimals, because a basis point is the finest unit a rate has. */
export function percentToBps(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new RangeError(`percent must be 0..100, got ${percent}`);
  const bps = Math.round(percent * 100);
  if (Math.abs(bps - percent * 100) > 1e-6) throw new RangeError(`percent has more than two decimals: ${percent}`);
  return bps;
}

/**
 * Reads an amount as a person or an export file writes it: "129.90", "129,90", "1 299,90 €",
 * "€1,299.90". Returns cents, or null when the text is not clearly a non-negative amount with at
 * most two decimals. Guessing at money is how reconciliations go wrong, so anything odd is null.
 */
export function parseEuros(text: string): number | null {
  const cleaned = text.replace(/[€\s]/g, "");
  if (cleaned === "") return null;
  // A comma or a point is the decimal mark when it is the last separator and has 1–2 digits after it.
  const m = /^(\d[\d.,]*?)(?:([.,])(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const [, whole = "", , frac = ""] = m;
  const digits = whole.replace(/[.,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  // Separators inside the whole part must be thousands groups of three. A lone "12.345" is
  // ambiguous (twelve thousand, or three decimals?) so it is refused unless a decimal part follows.
  if (/[.,]/.test(whole)) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(whole)) return null;
    if (frac === "" && whole.split(/[.,]/).length === 2) return null;
  }
  const cents = Number(digits) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 12990 → "129,90 €", the way the app shows money. */
export function formatEuros(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`cents must be a whole number, got ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole},${frac} €`;
}
