import { expect, test } from "@playwright/test";
import { firstOffer, go, signIn } from "./helpers";

/*
 * Marie activates an offer, gets her tracking link, then takes 20 € out of her pot: the payout is
 * requested and the wallet shows the money reserved. Everything runs on the database in the page.
 */
test("a member activates an offer and requests a payout from her pot", async ({ page }) => {
  await page.goto("/sign-in");
  await signIn(page, "marie@example.com");

  // Offers: the first row is the highest rate; open it and activate.
  await expect(page.getByRole("heading", { level: 1, name: "Offers" })).toBeVisible();
  const first = firstOffer(page);
  const offerName = (await first.getAttribute("aria-label")) ?? "";
  await first.click();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Offers");
  await page.getByRole("button", { name: "Activate and shop" }).click();
  const link = page.getByRole("link", { name: /^Continue to / });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href")) ?? "";
  expect(href).toMatch(/[?&]sub=[a-z0-9]{16}/);
  expect(offerName.length).toBeGreaterThan(0);

  // Wallet: 169,10 € available in the seed; request a 20 € transfer.
  await go(page, "Wallet");
  await expect(page.getByText("Available now")).toBeVisible();
  await expect(page.getByText("169,10 €").first()).toBeVisible();
  await page.getByRole("link", { name: "Use my pot" }).click();
  await page.getByLabel("Amount").fill("20");
  await page.getByLabel("IBAN").fill("FR7630006000011234567890189");
  await page.getByRole("button", { name: "Request the transfer" }).click();
  await expect(page.getByText(/20,00 €.*requested|requested/i).first()).toBeVisible();

  // The wallet now holds 20 € in reserved and 149,10 € available: the ledger moved it, not a counter.
  await go(page, "Wallet");
  await expect(page.getByText("149,10 €").first()).toBeVisible();
  await expect(page.getByText("20,00 €").first()).toBeVisible();
});
