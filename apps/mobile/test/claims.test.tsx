import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaimDetailScreen } from "@/screens/claim-detail";
import { NewClaimScreen, orderDayEnd } from "@/screens/claim-new";
import { ClaimsScreen } from "@/screens/claims";
import { ReferralsScreen } from "@/screens/referrals";
import { activationVernet, claimDeclined, claimFiled, offerVernet, referrals } from "./fixtures";
import { page, refuse, renderApp } from "./harness";

describe("the claims list", () => {
  it("lists the member's claims with their status and opens one", async () => {
    const { nav } = await renderApp(<ClaimsScreen />, { routes: { "GET /me/claims": () => page([claimFiled, { ...claimDeclined, offer: offerVernet, member: claimFiled.member }]) } });
    expect(await screen.findByText(/ORD-77213/)).toBeInTheDocument();
    expect(screen.getByText("filed")).toBeInTheDocument();
    expect(screen.getByText("declined")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /ORD-77213/ }));
    expect(nav.pushed).toEqual(["/claims/clm_1"]);
  });

  it("says what to do when there is none", async () => {
    await renderApp(<ClaimsScreen />, { routes: { "GET /me/claims": () => page([]) } });
    expect(await screen.findByText(/No claim/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "File a claim" })).toBeInTheDocument();
  });
});

describe("the claim form", () => {
  const activations = () => page([{ ...activationVernet, offer: offerVernet }]);

  it("offers only the offers the member activated", async () => {
    await renderApp(<NewClaimScreen />, { routes: { "GET /me/activations": activations } });
    expect(await screen.findByRole("radio", { name: /Maison Vernet/ })).toBeInTheDocument();
  });

  it("refuses an empty reference and a bad date before sending, with the schema's words", async () => {
    const { api } = await renderApp(<NewClaimScreen />, { routes: { "GET /me/activations": activations } });
    fireEvent.click(await screen.findByRole("radio", { name: /Maison Vernet/ }));
    fireEvent.change(screen.getByLabelText("Order date"), { target: { value: "yesterday" } });
    fireEvent.change(screen.getByLabelText("Order amount"), { target: { value: "64,50" } });
    fireEvent.change(screen.getByLabelText("Order confirmation"), { target: { value: "Order ORD-77213 confirmed." } });
    fireEvent.click(screen.getByRole("button", { name: "File the claim" }));
    expect(await screen.findByText("required")).toBeInTheDocument();
    expect(screen.getByText(/a date like 2026-11-02/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("files the claim with the amount in cents and goes to it", async () => {
    const { api, nav } = await renderApp(<NewClaimScreen />, { routes: { "GET /me/activations": activations, "POST /me/claims": () => ({ ...claimFiled, id: "clm_new" }) } });
    fireEvent.click(await screen.findByRole("radio", { name: /Maison Vernet/ }));
    fireEvent.change(screen.getByLabelText("Order reference"), { target: { value: "ORD-77213" } });
    fireEvent.change(screen.getByLabelText("Order date"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Order amount"), { target: { value: "64,50" } });
    fireEvent.change(screen.getByLabelText("Order confirmation"), { target: { value: "Order ORD-77213 confirmed, total 64,50 €." } });
    fireEvent.click(screen.getByRole("button", { name: "File the claim" }));
    await waitFor(() => expect(nav.replaced).toEqual(["/claims/clm_new"]));
    expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ offerId: "ofr_vernet", orderRef: "ORD-77213", orderCents: 6450, orderedAt: expect.stringMatching(/^2026-11-02/) });
  });

  it("shows the API's rule when the claim is too late", async () => {
    await renderApp(<NewClaimScreen />, { routes: { "GET /me/activations": activations, "POST /me/claims": () => refuse(422, "rule", "a claim must be filed within three months of the order") } });
    fireEvent.click(await screen.findByRole("radio", { name: /Maison Vernet/ }));
    fireEvent.change(screen.getByLabelText("Order reference"), { target: { value: "ORD-1" } });
    fireEvent.change(screen.getByLabelText("Order date"), { target: { value: "2026-01-02" } });
    fireEvent.change(screen.getByLabelText("Order amount"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Order confirmation"), { target: { value: "Order ORD-1." } });
    fireEvent.click(screen.getByRole("button", { name: "File the claim" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("within three months");
  });
});

describe("the order day of a claim", () => {
  it("is read as the end of that day, so a click earlier the same day counts, and never later than now", () => {
    const now = new Date(2026, 10, 16, 19, 30, 0);
    expect(orderDayEnd("2026-11-02", now)?.toISOString()).toBe(new Date(2026, 10, 2, 23, 59, 59, 999).toISOString());
    expect(orderDayEnd("2026-11-16", now)?.toISOString()).toBe(now.toISOString());
    expect(orderDayEnd("2026-11-31", now)).toBeNull();
    expect(orderDayEnd("yesterday", now)).toBeNull();
  });
});

describe("the claim detail", () => {
  it("shows where the claim stands and the reason when it was declined", async () => {
    await renderApp(<ClaimDetailScreen id="clm_2" />, { routes: { "GET /me/claims/:id": () => claimDeclined, "GET /offers/:id": () => offerVernet } });
    expect(await screen.findByRole("heading", { level: 1, name: "Claim ORD-66001" })).toBeInTheDocument();
    expect(screen.getByText("declined")).toBeInTheDocument();
    expect(screen.getByText(/the order was returned/)).toBeInTheDocument();
  });
});

describe("the referrals", () => {
  it("shows the code, how many sign-ups it still accepts, the referees and the bonuses paid", async () => {
    await renderApp(<ReferralsScreen />, { routes: { "GET /me/referrals": () => referrals } });
    expect(await screen.findByText("marie7k")).toBeInTheDocument();
    expect(screen.getByText(/18 more/)).toBeInTheDocument();
    expect(screen.getByText("Lucas Petit")).toBeInTheDocument();
    expect(screen.getByText("Inès Moreau")).toBeInTheDocument();
    expect(screen.getByText("20,00 €")).toBeInTheDocument();
  });
});
