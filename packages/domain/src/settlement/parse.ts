import type { Network, NetworkStatus } from "../entities.js";
import { parseEuros } from "../money.js";

/*
 * Step one of the settlement: read what a network sends into one shape. Each network has its own
 * format, as they do in reality: one exports a CSV with a header, the other a JSON document with
 * nested amounts and its own status names. Every row that cannot be read is an error with its line
 * number and the rest of the file is still processed, because one bad row must not hold up a
 * fortnight of cashback. A reference seen twice in one file is an error too: the first row stands.
 */

export interface ParsedTransaction {
  /** 1-based line in the CSV (the header is line 1) or 1-based index in the JSON array. */
  line: number;
  networkRef: string;
  subId: string | null;
  orderRef: string;
  advertiserRef: string;
  orderedAt: Date;
  orderCents: number;
  commissionCents: number;
  status: NetworkStatus;
  reportedAt: Date;
}

export interface RowError {
  line: number;
  message: string;
}

export interface ParsedFile {
  rows: ParsedTransaction[];
  errors: RowError[];
  /** Data rows seen, good or bad. */
  rowCount: number;
}

type RowResult = { ok: true; row: ParsedTransaction } | { ok: false; message: string };

const empty = (): ParsedFile => ({ rows: [], errors: [], rowCount: 0 });

function readDate(text: string | null, field: string): Date | string {
  if (text === null || text.trim() === "") return `${field} is missing`;
  const d = new Date(text.trim());
  // Only ISO 8601 is accepted: "09/11/2026" is the 9th of November to one network and September 11 to another.
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(text.trim())) return `${field} is not a date: ${text}`;
  return d;
}

function readMoney(text: string | null, field: string): number | string {
  if (text === null || text.trim() === "") return `${field} is missing`;
  const cents = parseEuros(text);
  return cents === null ? `${field} is not an amount: ${text}` : cents;
}

function readText(text: string | null, field: string): string | { missing: string } {
  const value = text?.trim() ?? "";
  return value === "" ? { missing: `${field} is missing` } : value;
}

/* ---------- Linkpool: CSV ---------- */

const LINKPOOL_COLUMNS = ["transaction_id", "advertiser_id", "click_ref", "order_ref", "transaction_date", "sale_amount", "commission_amount", "status", "last_updated"] as const;
const LINKPOOL_STATUS: Record<string, NetworkStatus> = { pending: "pending", approved: "approved", declined: "declined" };

/** One CSV line into fields. Quotes wrap a field that holds a comma or a quote; a doubled quote is a quote. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      fields.push(field);
      field = "";
    } else field += c;
  }
  fields.push(field);
  return fields;
}

function linkpoolRow(fields: string[], line: number): RowResult {
  if (fields.length !== LINKPOOL_COLUMNS.length) return { ok: false, message: `expected ${LINKPOOL_COLUMNS.length} columns, found ${fields.length}` };
  const get = (name: (typeof LINKPOOL_COLUMNS)[number]) => fields[LINKPOOL_COLUMNS.indexOf(name)] ?? null;
  const networkRef = readText(get("transaction_id"), "transaction_id");
  if (typeof networkRef !== "string") return { ok: false, message: networkRef.missing };
  const advertiserRef = readText(get("advertiser_id"), "advertiser_id");
  if (typeof advertiserRef !== "string") return { ok: false, message: advertiserRef.missing };
  const orderRef = readText(get("order_ref"), "order_ref");
  if (typeof orderRef !== "string") return { ok: false, message: orderRef.missing };
  const orderedAt = readDate(get("transaction_date"), "transaction_date");
  if (typeof orderedAt === "string") return { ok: false, message: orderedAt };
  const orderCents = readMoney(get("sale_amount"), "sale_amount");
  if (typeof orderCents === "string") return { ok: false, message: orderCents };
  const commissionCents = readMoney(get("commission_amount"), "commission_amount");
  if (typeof commissionCents === "string") return { ok: false, message: commissionCents };
  const statusText = (get("status") ?? "").trim().toLowerCase();
  const status = LINKPOOL_STATUS[statusText];
  if (!status) return { ok: false, message: `status must be pending, approved or declined: ${get("status") ?? ""}` };
  const reportedAt = readDate(get("last_updated"), "last_updated");
  if (typeof reportedAt === "string") return { ok: false, message: reportedAt };
  const subId = (get("click_ref") ?? "").trim();
  return { ok: true, row: { line, networkRef, advertiserRef, subId: subId === "" ? null : subId, orderRef, orderedAt, orderCents, commissionCents, status, reportedAt } };
}

export function parseLinkpoolCsv(text: string): ParsedFile {
  const out = empty();
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  const header = lines[0];
  if (header === undefined) return out;
  const names = splitCsvLine(header).map((h) => h.trim().toLowerCase());
  const missing = LINKPOOL_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length > 0) {
    out.errors.push({ line: 1, message: `header is missing ${missing.join(", ")}` });
    return out;
  }
  // Columns may come in any order; read them by name.
  const order = LINKPOOL_COLUMNS.map((c) => names.indexOf(c));
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const line = i + 1;
    out.rowCount++;
    const fields = splitCsvLine(raw);
    const result = fields.length === names.length ? linkpoolRow(order.map((k) => fields[k] ?? ""), line) : { ok: false as const, message: `expected ${names.length} columns, found ${fields.length}` };
    if (result.ok) out.rows.push(result.row);
    else out.errors.push({ line, message: result.message });
  }
  return out;
}

/* ---------- Affinet: JSON ---------- */

const AFFINET_STATUS: Record<string, NetworkStatus> = { PENDING: "pending", CONFIRMED: "approved", REJECTED: "declined" };

const field = (obj: Record<string, unknown>, name: string): string | null => {
  const v = obj[name];
  return v === undefined || v === null ? null : typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
};

function money(obj: Record<string, unknown>, name: string): number | string {
  const value = obj[name];
  if (typeof value !== "object" || value === null) return `${name} is missing`;
  const m = value as Record<string, unknown>;
  const currency = field(m, "currency");
  if (currency !== "EUR") return `${name}.currency must be EUR: ${currency ?? ""}`;
  return readMoney(field(m, "value"), `${name}.value`);
}

function affinetRow(item: unknown, line: number): RowResult {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return { ok: false, message: "a transaction must be an object" };
  const o = item as Record<string, unknown>;
  const networkRef = readText(field(o, "id"), "id");
  if (typeof networkRef !== "string") return { ok: false, message: networkRef.missing };
  const advertiserRef = readText(field(o, "advertiserId"), "advertiserId");
  if (typeof advertiserRef !== "string") return { ok: false, message: advertiserRef.missing };
  const orderRef = readText(field(o, "orderId"), "orderId");
  if (typeof orderRef !== "string") return { ok: false, message: orderRef.missing };
  const orderedAt = readDate(field(o, "orderDate"), "orderDate");
  if (typeof orderedAt === "string") return { ok: false, message: orderedAt };
  const orderCents = money(o, "amount");
  if (typeof orderCents === "string") return { ok: false, message: orderCents };
  const commissionCents = money(o, "commission");
  if (typeof commissionCents === "string") return { ok: false, message: commissionCents };
  const statusText = field(o, "status") ?? "";
  const status = AFFINET_STATUS[statusText.toUpperCase()];
  if (!status) return { ok: false, message: `status must be PENDING, CONFIRMED or REJECTED: ${statusText}` };
  const reportedAt = readDate(field(o, "updatedAt"), "updatedAt");
  if (typeof reportedAt === "string") return { ok: false, message: reportedAt };
  const subId = (field(o, "subId") ?? "").trim();
  return { ok: true, row: { line, networkRef, advertiserRef, subId: subId === "" ? null : subId, orderRef, orderedAt, orderCents, commissionCents, status, reportedAt } };
}

export function parseAffinetJson(text: string): ParsedFile {
  const out = empty();
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    out.errors.push({ line: 0, message: "the file is not valid JSON" });
    return out;
  }
  const transactions = typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>)["transactions"] : undefined;
  if (!Array.isArray(transactions)) {
    out.errors.push({ line: 0, message: "transactions must be an array" });
    return out;
  }
  transactions.forEach((item, i) => {
    const line = i + 1;
    out.rowCount++;
    const result = affinetRow(item, line);
    if (result.ok) out.rows.push(result.row);
    else out.errors.push({ line, message: result.message });
  });
  return out;
}

/* ---------- Common ---------- */

/** A reference seen twice in one file: the first row stands, the second is an error. */
export function dedupeWithinFile(rows: ParsedTransaction[]): { rows: ParsedTransaction[]; errors: RowError[] } {
  const seen = new Map<string, number>();
  const out: ParsedTransaction[] = [];
  const errors: RowError[] = [];
  for (const row of rows) {
    const first = seen.get(row.networkRef);
    if (first !== undefined) {
      errors.push({ line: row.line, message: `${row.networkRef} appears twice in the file (first on line ${first}); the second row is ignored` });
      continue;
    }
    seen.set(row.networkRef, row.line);
    out.push(row);
  }
  return { rows: out, errors };
}

const PARSERS: Record<Network, (text: string) => ParsedFile> = { linkpool: parseLinkpoolCsv, affinet: parseAffinetJson };

/** The file of one network, read and deduplicated, errors in line order. */
export function parseNetworkFile(network: Network, text: string): ParsedFile {
  const parsed = PARSERS[network](text);
  const deduped = dedupeWithinFile(parsed.rows);
  return { rows: deduped.rows, errors: [...parsed.errors, ...deduped.errors].sort((a, b) => a.line - b.line), rowCount: parsed.rowCount };
}
