import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CatalogueScreen } from "@/screens/catalogue";
import { OfferEditScreen } from "@/screens/offer-edit";
import { NewOfferScreen } from "@/screens/offer-new";
import { offerLune, offerVernet, offerVernetDetail } from "./fixtures";
import { page, refuse, renderApp, signedIn } from "./harness";
import { nadia } from "./ops-fixtures";

/*
 * The catalogue as the manager works it: every status in the list, a new offer written in euros
 * and percent and sent in cents and basis points, the moves of the offer state machine, and the
 * boosts with their windows.
 */

const draft = { ...offerLune, id: "ofr_draft", title: "Papeterie Lune: 8 % back in December", status: "draft" as const, rateKind: "percent" as const, rateBps: 800, fixedCents: 0, minSpendCents: 0, capCents: null, newCustomersOnly: false };
const paused = { ...offerVernet, id: "ofr_paused", title: "Maison Vernet: 4 % back on shoes", status: "paused" as const };
const merchants = [offerVernet.merchant, offerLune.merchant];

describe("the catalogue", () => {
  it("lists every status with its pill, counts the live ones, and opens an offer", async () => {
    const { api, nav } = await renderApp(<CatalogueScreen />, { session: await signedIn(nadia), routes: { "GET /offers": () => page([offerVernet, draft, paused], 3) } });
    expect(await screen.findByText("live")).toBeInTheDocument();
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
    expect(screen.getByText(/3 offers, 1 live/)).toBeInTheDocument();
    expect(api.calls[0]?.query).toMatchObject({ all: 1 });
    fireEvent.click(screen.getByRole("link", { name: /8 % back in December/ }));
    expect(nav.pushed).toEqual(["/catalogue/ofr_draft"]);
  });

  it("sends the search to the server", async () => {
    const { api } = await renderApp(<CatalogueScreen />, { session: await signedIn(nadia), routes: { "GET /offers": () => page([offerVernet]) } });
    await screen.findByText("live");
    fireEvent.change(screen.getByLabelText("Search the catalogue"), { target: { value: "vernet" } });
    await waitFor(() => expect(api.calls.at(-1)?.query).toMatchObject({ q: "vernet", all: 1 }));
  });

  it("keeps its frame when nothing matches", async () => {
    await renderApp(<CatalogueScreen />, { session: await signedIn(nadia), routes: { "GET /offers": () => page([]) } });
    expect(await screen.findByText(/No offer matches/)).toBeInTheDocument();
    expect(screen.getByText("No offer yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New offer" })).toBeInTheDocument();
  });
});

describe("the new offer form", () => {
  it("refuses a missing title and a rate it cannot read before sending", async () => {
    const { api } = await renderApp(<NewOfferScreen />, { session: await signedIn(nadia), routes: { "GET /merchants": () => merchants } });
    fireEvent.click(await screen.findByRole("radio", { name: "Maison Vernet" }));
    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "six" } });
    fireEvent.change(screen.getByLabelText("Validation days"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the offer" }));
    expect(await screen.findByText("required")).toBeInTheDocument();
    expect(screen.getByText(/a percentage like 6 or 2,5/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("posts the rate in basis points and the amounts in cents, then opens the offer", async () => {
    const { api, nav } = await renderApp(<NewOfferScreen />, { session: await signedIn(nadia), routes: { "GET /merchants": () => merchants, "POST /offers": () => ({ ...draft, id: "ofr_new" }) } });
    fireEvent.click(await screen.findByRole("radio", { name: "Papeterie Lune" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Papeterie Lune: 2,5 % back from 30 €" } });
    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "2,5" } });
    fireEvent.change(screen.getByLabelText("Minimum spend"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Cap"), { target: { value: "12,50" } });
    fireEvent.change(screen.getByLabelText("Validation days"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the offer" }));
    await waitFor(() => expect(nav.replaced).toEqual(["/catalogue/ofr_new"]));
    const body = api.calls.find((c) => c.method === "POST")?.body;
    expect(body).toMatchObject({ merchantId: "mer_lune", kind: "online", rateKind: "percent", rateBps: 250, fixedCents: 0, minSpendCents: 3000, capCents: 1250, validationDays: 45, newCustomersOnly: false, endsAt: null });
    expect((body as { startsAt: string }).startsAt).toMatch(/^2026-12-01/);
  });
});

describe("the offer screen", () => {
  const routes = (status: "draft" | "live" | "paused" | "ended") => ({
    "GET /offers/:id": () => ({ ...offerVernetDetail, status }),
    "GET /merchants": () => merchants,
  });

  it("offers the moves of the offer's state and posts the chosen one", async () => {
    const { api } = await renderApp(<OfferEditScreen id="ofr_vernet" />, { session: await signedIn(nadia), routes: { ...routes("draft"), "POST /offers/:id/publish": () => ({ ...offerVernet, status: "live" }) } });
    expect(await screen.findByRole("heading", { level: 1, name: /Maison Vernet/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/offers/ofr_vernet/publish")).toBe(true));
  });

  it("shows Pause and End on a live offer and the boosted rate in force", async () => {
    await renderApp(<OfferEditScreen id="ofr_vernet" />, { session: await signedIn(nadia), routes: routes("live") });
    expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End" })).toBeInTheDocument();
    expect(screen.getByText(/9 % in force now, boosted from 6 %/)).toBeInTheDocument();
  });

  it("patches a changed title", async () => {
    const { api } = await renderApp(<OfferEditScreen id="ofr_vernet" />, { session: await signedIn(nadia), routes: { ...routes("live"), "PATCH /offers/:id": () => offerVernet } });
    const title = await screen.findByLabelText("Title");
    expect(title).toHaveValue("Maison Vernet: 6 % back on everything");
    fireEvent.change(title, { target: { value: "Maison Vernet: 6 % back on all orders" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the offer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ title: "Maison Vernet: 6 % back on all orders", rateBps: 600 }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("lists the boosts and posts a new one in basis points with ISO dates", async () => {
    const { api } = await renderApp(<OfferEditScreen id="ofr_vernet" />, { session: await signedIn(nadia), routes: { ...routes("live"), "POST /offers/:id/boosts": () => offerVernetDetail.boosts[0] } });
    expect(await screen.findByText(/9 % from 10 nov. 2026 to 20 nov. 2026/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Boost rate"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Boost starts"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Boost ends"), { target: { value: "2026-12-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the boost" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/offers/ofr_vernet/boosts")).toBe(true));
    const body = api.calls.find((c) => c.path === "/offers/ofr_vernet/boosts")?.body as { rateBps: number; startsAt: string; endsAt: string };
    expect(body.rateBps).toBe(1200);
    expect(body.startsAt).toMatch(/^2026-12-01/);
    expect(body.endsAt).toMatch(/^2026-12-08/);
  });

  it("shows the API's sentence when a boost overlaps", async () => {
    await renderApp(<OfferEditScreen id="ofr_vernet" />, { session: await signedIn(nadia), routes: { ...routes("live"), "POST /offers/:id/boosts": () => refuse(409, "conflict", "this window overlaps an existing boost") } });
    fireEvent.change(await screen.findByLabelText("Boost rate"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Boost starts"), { target: { value: "2026-11-15" } });
    fireEvent.change(screen.getByLabelText("Boost ends"), { target: { value: "2026-11-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the boost" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("overlaps an existing boost");
  });
});
