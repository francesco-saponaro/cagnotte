import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { connectPglite, type Db } from "../src/index.js";

/** The tables the plan names, as the migration must create them. */
const TABLES = [
  "users",
  "sessions",
  "merchants",
  "offers",
  "offer_boosts",
  "activations",
  "import_batches",
  "network_transactions",
  "cashbacks",
  "claims",
  "ledger_entries",
  "payouts",
  "referrals",
  "audit_log",
];

let db: Db;
let close: () => Promise<void>;

/** Drizzle wraps the database's error; the constraint name is in the cause. */
async function refusedWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const cause = (e as { cause?: { message?: string } }).cause;
    const message = cause?.message ?? (e as Error).message;
    expect(message).toMatch(pattern);
    return;
  }
  throw new Error("expected the database to refuse the row");
}

beforeAll(async () => {
  ({ db, close } = await connectPglite());
});
afterAll(() => close());

const now = new Date("2026-11-11T18:00:00Z");

async function user(id: string, email: string) {
  await db.execute(sql`insert into users (id, email, password_hash, display_name, role, referral_code, created_at)
    values (${id}, ${email}, 'x', 'Someone', 'member', ${id.replace("usr_", "")}, ${now})`);
}

async function merchant(id = "mer_1") {
  await db.execute(sql`insert into merchants (id, slug, name, category, country, attribution_days, network, advertiser_ref)
    values (${id}, ${id}, 'Shop', 'fashion', 'FR', 30, 'linkpool', ${"adv-" + id})`);
}

async function offer(id = "ofr_1", merchantId = "mer_1", rateBps = 420) {
  await db.execute(sql`insert into offers (id, merchant_id, kind, title, rate_kind, rate_bps, fixed_cents, min_spend_cents, new_customers_only, validation_days, status, starts_at, created_at, updated_at)
    values (${id}, ${merchantId}, 'online', 'Offer', 'percent', ${rateBps}, 0, 0, false, 45, 'live', ${now}, ${now}, ${now})`);
}

describe("the migration", () => {
  it("creates every table of the plan", async () => {
    const rows = (await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    )) as { rows: { table_name: string }[] };
    const names = rows.rows.map((r) => r.table_name).filter((n) => !n.startsWith("__drizzle"));
    expect(names).toEqual([...TABLES].sort());
  });

  it("applies twice without complaint", async () => {
    const again = await connectPglite();
    await again.close();
  });
});

describe("the constraints", () => {
  it("keeps emails and referral codes unique", async () => {
    await user("usr_a", "a@example.com");
    await refusedWith(user("usr_b", "a@example.com"), /unique/i);
    await refusedWith(db.execute(sql`insert into users (id, email, password_hash, display_name, role, referral_code, created_at) values ('usr_c', 'c@example.com', 'x', 'C', 'member', 'a', ${now})`), /unique/i);
  });

  it("refuses a role that is not member, agent or manager", async () => {
    await refusedWith(db.execute(sql`insert into users (id, email, password_hash, display_name, role, referral_code, created_at) values ('usr_d', 'd@example.com', 'x', 'D', 'admin', 'd', ${now})`), /enum/i);
  });

  it("refuses an activation of an offer that does not exist", async () => {
    await merchant();
    await offer();
    await refusedWith(db.execute(sql`insert into activations (id, user_id, offer_id, sub_id, rate_bps, boosted, activated_at, tracking_url)
        values ('act_1', 'usr_a', 'ofr_missing', 'sub1', 420, false, ${now}, 'https://example.com')`), /foreign key/i);
  });

  it("keeps the sub id unique, because the network reports it back", async () => {
    await db.execute(sql`insert into activations (id, user_id, offer_id, sub_id, rate_bps, boosted, activated_at, tracking_url)
      values ('act_1', 'usr_a', 'ofr_1', 'sub1', 420, false, ${now}, 'https://example.com')`);
    await refusedWith(db.execute(sql`insert into activations (id, user_id, offer_id, sub_id, rate_bps, boosted, activated_at, tracking_url)
        values ('act_2', 'usr_a', 'ofr_1', 'sub1', 420, false, ${now}, 'https://example.com')`), /unique/i);
  });

  it("refuses a rate outside 0..10000 basis points", async () => {
    await refusedWith(offer("ofr_bad", "mer_1", 10001), /check/i);
  });

  it("refuses a boost that does not end after it starts", async () => {
    await refusedWith(db.execute(sql`insert into offer_boosts (id, offer_id, rate_bps, starts_at, ends_at, created_by) values ('bst_1', 'ofr_1', 800, ${now}, ${now}, 'usr_a')`), /check/i);
  });

  it("allows one cashback per activation and refuses a negative amount", async () => {
    const insert = (id: string, amount: number) =>
      db.execute(sql`insert into cashbacks (id, user_id, offer_id, activation_id, order_cents, rate_bps, amount_cents, margin_clamped, status, expected_validation_at, created_at)
        values (${id}, 'usr_a', 'ofr_1', 'act_1', 12990, 420, ${amount}, false, 'pending', ${now}, ${now})`);
    await refusedWith(insert("cb_neg", -1), /check/i);
    await insert("cb_1", 546);
    await refusedWith(insert("cb_2", 546), /unique/i);
  });

  it("keeps a network's references unique and refuses a zero ledger entry", async () => {
    await db.execute(sql`insert into import_batches (id, network, filename, imported_by, status, created_at) values ('imp_1', 'linkpool', 'a.csv', 'usr_a', 'received', ${now})`);
    const tx = (id: string, ref: string) =>
      db.execute(sql`insert into network_transactions (id, batch_id, network, network_ref, order_ref, merchant_id, ordered_at, order_cents, commission_cents, network_status, reported_at, match_status)
        values (${id}, 'imp_1', 'linkpool', ${ref}, 'o-1', 'mer_1', ${now}, 12990, 900, 'pending', ${now}, 'unmatched')`);
    await tx("ntx_1", "ref-1");
    await refusedWith(tx("ntx_2", "ref-1"), /unique/i);
    await refusedWith(db.execute(sql`insert into ledger_entries (id, user_id, kind, bucket, amount_cents, ref_type, ref_id, created_at) values ('led_0', 'usr_a', 'cashback_pending', 'pending', 0, 'cashback', 'cb_1', ${now})`), /check/i);
  });

  it("allows one referral per referee", async () => {
    await user("usr_r", "r@example.com");
    const insert = (id: string) =>
      db.execute(sql`insert into referrals (id, referrer_id, referee_id, code, status, created_at) values (${id}, 'usr_a', 'usr_r', 'a', 'pending', ${now})`);
    await insert("ref_1");
    await refusedWith(insert("ref_2"), /unique/i);
  });
});
