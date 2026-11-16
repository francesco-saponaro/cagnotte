import { expect, test } from "@playwright/test";
import { firstOffer, go, isoNow, networkFile, parseTrackingUrl, signIn, unique } from "./helpers";

/*
 * Nadia activates an offer as a member would, then imports the network's file about a sale at
 * that shop that carries no click reference. The pipeline books nothing for it; the sale lands in
 * the queue, where she matches it to her click by hand and validates the cashback it books.
 */
test("a sale with no click reference is imported, matched by hand and validated", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, "nadia@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  // The click, through the members' offers (a manager has a wallet too).
  await page.goto("/offers");
  await firstOffer(page).click();
  await page.getByRole("button", { name: "Activate and shop" }).click();
  const link = page.getByRole("link", { name: /^Continue to / });
  await expect(link).toBeVisible();
  const { network, advertiser } = parseTrackingUrl((await link.getAttribute("href")) ?? "");

  // The network's file: one sale at that shop, ordered two seconds after the click, with no click reference.
  const ref = unique("NTX");
  const orderRef = unique("ORD");
  const file = networkFile(network, [{ ref, advertiser, subId: null, orderRef, orderedAt: isoNow(2), amount: "80.00", commission: "9.60", status: "pending" }]);
  await go(page, "Imports");
  await page.getByRole("button", { name: "Import a file" }).click();
  await page.getByRole("radio", { name: network }).click();
  await page.getByLabel("Filename").fill(file.filename);
  await page.getByLabel("File contents").fill(file.content);
  await page.getByRole("button", { name: "Run the import" }).click();
  await expect(page.getByRole("heading", { level: 1, name: file.filename })).toBeVisible();
  await expect(page.getByText("processed", { exact: true })).toBeVisible();

  // The sale sits in the batch, unmatched; open it and match it to the click.
  await page.getByRole("link", { name: new RegExp(orderRef) }).click();
  await expect(page.getByText(/the network reported no click reference/)).toBeVisible();
  await page.getByRole("button", { name: "Match to Nadia Benali's click" }).click();
  await expect(page.getByText("matched", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("pending", { exact: true }).first()).toBeVisible();

  // Validate the cashback by hand, with a reason the audit log keeps.
  await page.getByLabel("Decision reason").fill("confirmed with the shop by phone");
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText("validated", { exact: true }).first()).toBeVisible();

  // The dashboard's queues and the ledger still agree.
  await go(page, "Dashboard");
  await expect(page.getByText(/the ledger reconciles/)).toBeVisible();
});
