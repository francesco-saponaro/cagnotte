import { expect, test } from "@playwright/test";
import { firstOffer, go, localDay, signIn, signOut, unique } from "./helpers";

/*
 * Marie activates an offer and files a claim for an order the network never reported; Sam takes
 * the claim, acknowledges it, raises it with the network and credits it; Marie sees the cashback
 * in her available balance. Three roles, one database, no reload.
 */
test("a claim goes from the member's form to a credited cashback", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, "marie@example.com");

  // Activate the first offer so the claim stands on a click.
  await firstOffer(page).click();
  await page.getByRole("button", { name: "Activate and shop" }).click();
  await expect(page.getByRole("link", { name: /^Continue to / })).toBeVisible();
  const merchant = ((await page.getByRole("link", { name: /^Continue to / }).getAttribute("aria-label")) ?? "").replace(/^Continue to /, "");

  // File the claim: today's order, 64,50 €, with the confirmation text.
  const orderRef = unique("ORD");
  await go(page, "Claims");
  await page.getByRole("link", { name: "File a claim" }).click();
  await page.getByRole("radio", { name: new RegExp(`^${merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`) }).first().click();
  await page.getByLabel("Order reference").fill(orderRef);
  await page.getByLabel("Order date").fill(localDay());
  await page.getByLabel("Order amount").fill("64,50");
  await page.getByLabel("Order confirmation").fill(`Order ${orderRef} confirmed, total 64,50 €.`);
  await page.getByRole("button", { name: "File the claim" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Claim ${orderRef}` })).toBeVisible();
  await expect(page.getByText("filed", { exact: true })).toBeVisible();
  await signOut(page);

  // Sam works it through its states.
  await signIn(page, "sam@example.com");
  await expect(page.getByRole("heading", { level: 1, name: "Support" })).toBeVisible();
  await page.getByLabel("Search claims").fill(orderRef);
  await page.getByRole("link", { name: new RegExp(orderRef) }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Claim ${orderRef}` })).toBeVisible();
  await page.getByRole("button", { name: "Take it" }).click();
  await expect(page.getByText(/by you/)).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("acknowledged", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Raise with the network" }).click();
  await expect(page.getByText("raised", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Credit the cashback" }).click();
  await expect(page.getByText("credited", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decline" })).toHaveCount(0);
  await signOut(page);

  // Marie sees the outcome and the money.
  await signIn(page, "marie@example.com");
  await go(page, "Claims");
  await page.getByRole("link", { name: new RegExp(orderRef) }).click();
  await expect(page.getByText("Credited: the cashback is in your available balance.")).toBeVisible();
  await go(page, "Wallet");
  await expect(page.getByText(/Credited after a claim/).first()).toBeVisible();
});
