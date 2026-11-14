import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedupeWithinFile, parseAffinetJson, parseLinkpoolCsv, parseNetworkFile, type ParsedTransaction } from "../src/index.js";

/*
 * The two export formats the networks send, read into one shape. The fixtures are shaped like the
 * real files: a header and comma-separated rows with quoted fields for one network, a JSON document
 * with nested amounts and upper-case statuses for the other. Each has good rows and one of every
 * kind of bad row, and each repeats a reference so the in-file duplicate rule can be seen.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const csv = fixture("linkpool-transactions-2026-11-13.csv");
const json = fixture("affinet-transactions-2026-11-13.json");

const byRef = (rows: ParsedTransaction[], ref: string) => rows.find((r) => r.networkRef === ref);

describe("parseLinkpoolCsv", () => {
  const parsed = parseLinkpoolCsv(csv);

  it("counts the data lines, blank trailing lines excluded", () => {
    expect(parsed.rowCount).toBe(11);
  });

  it("reads a row into cents, basis-free money, a status and two instants", () => {
    const row = byRef(parsed.rows, "LP100007");
    expect(row).toEqual({
      line: 2,
      networkRef: "LP100007",
      advertiserRef: "LP-1037",
      subId: "k3j9d8s7f6g5h4j3",
      orderRef: "ORD-7F3K2M9Q",
      orderedAt: new Date("2026-11-09T14:22:10Z"),
      orderCents: 12990,
      commissionCents: 1559,
      status: "pending",
      reportedAt: new Date("2026-11-10T03:00:00Z"),
    });
  });

  it("reads an empty click reference as null and a quoted field with a comma and a thousands separator", () => {
    expect(byRef(parsed.rows, "LP100014")?.subId).toBeNull();
    const quoted = byRef(parsed.rows, "LP100021");
    expect(quoted?.orderRef).toBe("ORD-9,ZZ-ÉTÉ");
    expect(quoted?.orderCents).toBe(129900);
    expect(quoted?.status).toBe("approved");
  });

  it("accepts a zero amount and a zero commission on a declined row", () => {
    expect(byRef(parsed.rows, "LP100028")).toMatchObject({ orderCents: 0, commissionCents: 0, status: "declined" });
  });

  it("rejects each bad row with its line number and keeps the others", () => {
    expect(parsed.errors).toEqual([
      { line: 6, message: "sale_amount is not an amount: 12.9O" },
      { line: 7, message: "transaction_date is not a date: 09/11/2026" },
      { line: 8, message: "status must be pending, approved or declined: cancelled" },
      { line: 9, message: "transaction_id is missing" },
      { line: 10, message: "expected 9 columns, found 6" },
    ]);
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 11, 12]);
  });

  it("refuses a file whose header lacks a column, as one error on line 1", () => {
    const broken = parseLinkpoolCsv("transaction_id,advertiser_id,order_ref\nLP1,LP-1,ORD-1\n");
    expect(broken.rows).toEqual([]);
    expect(broken.errors).toEqual([{ line: 1, message: "header is missing click_ref, transaction_date, sale_amount, commission_amount, status, last_updated" }]);
    expect(broken.rowCount).toBe(0);
  });

  it("reads Windows line endings and a header-only file", () => {
    const crlf = parseLinkpoolCsv(csv.split("\n").slice(0, 3).join("\r\n") + "\r\n");
    expect(crlf.rows.map((r) => r.networkRef)).toEqual(["LP100007", "LP100014"]);
    expect(parseLinkpoolCsv(csv.split("\n")[0]!)).toEqual({ rows: [], errors: [], rowCount: 0 });
  });
});

describe("parseAffinetJson", () => {
  const parsed = parseAffinetJson(json);

  it("counts the transactions in the document", () => {
    expect(parsed.rowCount).toBe(9);
  });

  it("maps the network's statuses and nested amounts onto the common shape", () => {
    expect(byRef(parsed.rows, "AF100014")).toEqual({
      line: 1,
      networkRef: "AF100014",
      advertiserRef: "AF-1000",
      subId: "h7g6f5d4s3a2q1w2",
      orderRef: "ORD-A1B2C3D4",
      orderedAt: new Date("2026-11-09T14:22:10Z"),
      orderCents: 12990,
      commissionCents: 1559,
      status: "pending",
      reportedAt: new Date("2026-11-12T02:00:00Z"),
    });
    expect(byRef(parsed.rows, "AF100021")).toMatchObject({ subId: null, status: "approved", orderCents: 129900 });
    expect(byRef(parsed.rows, "AF100028")).toMatchObject({ status: "declined", commissionCents: 0 });
  });

  it("rejects a foreign currency, an unknown status, a missing id, a bad amount and a bad date", () => {
    expect(parsed.errors).toEqual([
      { line: 4, message: "amount.currency must be EUR: USD" },
      { line: 5, message: "status must be PENDING, CONFIRMED or REJECTED: ON_HOLD" },
      { line: 6, message: "id is missing" },
      { line: 7, message: "amount.value is not an amount: eighty" },
      { line: 9, message: "orderDate is not a date: not a date" },
    ]);
  });

  it("refuses a document that is not what the network sends", () => {
    expect(parseAffinetJson("{ not json")).toEqual({ rows: [], errors: [{ line: 0, message: "the file is not valid JSON" }], rowCount: 0 });
    expect(parseAffinetJson('{"transactions": 3}').errors).toEqual([{ line: 0, message: "transactions must be an array" }]);
    expect(parseAffinetJson('{"transactions": [5]}').errors).toEqual([{ line: 1, message: "a transaction must be an object" }]);
  });
});

describe("dedupeWithinFile", () => {
  it("keeps the first occurrence of a reference and reports the second with the first's line", () => {
    const parsed = parseLinkpoolCsv(csv);
    const deduped = dedupeWithinFile(parsed.rows);
    expect(deduped.rows.map((r) => r.networkRef)).toEqual(["LP100007", "LP100014", "LP100021", "LP100028", "LP100063"]);
    expect(deduped.errors).toEqual([{ line: 11, message: "LP100007 appears twice in the file (first on line 2); the second row is ignored" }]);
  });
});

describe("parseNetworkFile", () => {
  it("picks the format by network, dedupes, and merges the errors in line order", () => {
    const linkpool = parseNetworkFile("linkpool", csv);
    expect(linkpool.rows).toHaveLength(5);
    expect(linkpool.errors.map((e) => e.line)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(linkpool.rowCount).toBe(11);
    const affinet = parseNetworkFile("affinet", json);
    expect(affinet.rows.map((r) => r.networkRef)).toEqual(["AF100014", "AF100021", "AF100028"]);
    expect(affinet.errors.map((e) => e.line)).toEqual([4, 5, 6, 7, 8, 9]);
  });
});
