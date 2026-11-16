import { expect, type Page } from "@playwright/test";

/*
 * The three demo accounts and the few things every run does. The database lives in the page, so a
 * run never reloads: it signs out and in again through the app, and every move is a click.
 */

export const PASSWORD = "cagnotte-demo";

export async function signIn(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
}

/** The first row of the offers list: its name is "<shop>, <title>", and the wordmark's is not. */
export function firstOffer(page: Page) {
  return page.getByRole("link", { name: /^(?!Cagnotte, home$).+, .+$/ }).first();
}

/** The main navigation, wide layout: a text link per destination. */
export async function go(page: Page, label: string): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label, exact: true }).click();
}

/** "k3j9d8s7f6g5h4j3" and "LP-1037" out of a tracking link, the way the networks will see them. */
export function parseTrackingUrl(href: string): { network: "linkpool" | "affinet"; advertiser: string; subId: string } {
  const url = new URL(href);
  const network = url.hostname.includes("affinet") ? "affinet" : "linkpool";
  return { network, advertiser: url.searchParams.get("adv") ?? "", subId: url.searchParams.get("sub") ?? "" };
}

export interface SaleRow {
  ref: string;
  advertiser: string;
  subId: string | null;
  orderRef: string;
  orderedAt: string;
  amount: string;
  commission: string;
  status: "pending" | "approved" | "declined";
}

/** A network's export with these rows, in the format that network sends. */
export function networkFile(network: "linkpool" | "affinet", rows: SaleRow[]): { filename: string; content: string } {
  const day = rows[0]?.orderedAt.slice(0, 10) ?? "2026-11-16";
  if (network === "linkpool") {
    const header = "transaction_id,advertiser_id,click_ref,order_ref,transaction_date,sale_amount,commission_amount,status,last_updated";
    const lines = rows.map((r) => [r.ref, r.advertiser, r.subId ?? "", r.orderRef, r.orderedAt, r.amount, r.commission, r.status, r.orderedAt].join(","));
    return { filename: `linkpool-transactions-${day}.csv`, content: [header, ...lines].join("\n") };
  }
  const STATUS = { pending: "PENDING", approved: "CONFIRMED", declined: "REJECTED" };
  const transactions = rows.map((r) => ({ id: r.ref, advertiserId: r.advertiser, subId: r.subId, orderId: r.orderRef, orderDate: r.orderedAt, amount: { value: r.amount, currency: "EUR" }, commission: { value: r.commission, currency: "EUR" }, status: STATUS[r.status], updatedAt: r.orderedAt }));
  return { filename: `affinet-transactions-${day}.json`, content: JSON.stringify({ network: "affinet", publisherId: "PUB-48213", generatedAt: new Date().toISOString(), transactions }, null, 2) };
}

/** An instant as the networks write it, to the second; `plusSeconds` puts an order safely after a click made this instant. */
export const isoNow = (plusSeconds = 0) => new Date(Math.ceil(Date.now() / 1000) * 1000 + plusSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Today as the claim form's date field wants it, in the browser's own zone. */
export function localDay(date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
