import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfferDetailScreen } from "@/screens/offer-detail";
import { OffersScreen } from "@/screens/offers";
import { activationVernet, offerLune, offerVernet, offerVernetDetail } from "./fixtures";
import { page, refuse, renderApp } from "./harness";

describe("the offers list", () => {
  it("lists the live offers with their merchant and rate, and says how many there are", async () => {
    await renderApp(<OffersScreen />, { routes: { "GET /offers": () => page([offerVernet, offerLune], 89) } });
    expect(await screen.findByText("Maison Vernet")).toBeInTheDocument();
    expect(screen.getByText("6 %")).toBeInTheDocument();
    expect(screen.getByText("5,00 €")).toBeInTheDocument();
    expect(screen.getByText("1–2 of 89")).toBeInTheDocument();
  });

  it("asks the server for the search, the category and the sort", async () => {
    const { api } = await renderApp(<OffersScreen />, { routes: { "GET /offers": () => page([offerVernet]) } });
    await screen.findByText("Maison Vernet");
    fireEvent.change(screen.getByLabelText("Search offers"), { target: { value: "vernet" } });
    fireEvent.click(screen.getByRole("radio", { name: "fashion" }));
    fireEvent.click(screen.getByRole("radio", { name: "Newest" }));
    await waitFor(() => expect(api.calls.at(-1)?.query).toMatchObject({ q: "vernet", category: "fashion", sort: "newest", page: 1 }));
  });

  it("pages on the server", async () => {
    const { api } = await renderApp(<OffersScreen />, { routes: { "GET /offers": ({ query }) => page(query.page === 2 ? [offerLune] : [offerVernet], 40, Number(query.page ?? 1)) } });
    await screen.findByText("Maison Vernet");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Papeterie Lune")).toBeInTheDocument();
    expect(api.calls.at(-1)?.query).toMatchObject({ page: 2 });
    expect(screen.getByText("21–21 of 40")).toBeInTheDocument();
  });

  it("opens an offer", async () => {
    const { nav } = await renderApp(<OffersScreen />, { routes: { "GET /offers": () => page([offerVernet]) } });
    fireEvent.click(await screen.findByRole("link", { name: /Maison Vernet/ }));
    expect(nav.pushed).toEqual(["/offers/ofr_vernet"]);
  });

  it("says when nothing matches and when the list could not load", async () => {
    await renderApp(<OffersScreen />, { routes: { "GET /offers": () => page([]) } });
    expect(await screen.findByText(/No live offer matches/)).toBeInTheDocument();
    await renderApp(<OffersScreen />, { routes: { "GET /offers": () => refuse(500, "internal", "database away") } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("database away");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("the offer detail", () => {
  it("shows the rate in force, the boost, the conditions and when it pays", async () => {
    await renderApp(<OfferDetailScreen id="ofr_vernet" />, { routes: { "GET /offers/:id": () => offerVernetDetail } });
    expect(await screen.findByRole("heading", { level: 1, name: "Maison Vernet: 6 % back on everything" })).toBeInTheDocument();
    expect(screen.getByText("9 %")).toBeInTheDocument();
    expect(screen.getByText(/boosted from 6 % until 20 nov. 2026/)).toBeInTheDocument();
    expect(screen.getByText(/about 60 days after the order/)).toBeInTheDocument();
  });

  it("activates the offer and shows the tracking link with the rate it locked", async () => {
    const { api } = await renderApp(<OfferDetailScreen id="ofr_vernet" />, { routes: { "GET /offers/:id": () => offerVernetDetail, "POST /offers/:id/activate": () => activationVernet } });
    fireEvent.click(await screen.findByRole("button", { name: "Activate and shop" }));
    expect(await screen.findByText(/Activated at 9 %/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continue to Maison Vernet/ })).toHaveAttribute("href", activationVernet.trackingUrl);
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/offers/ofr_vernet/activate")).toBe(true);
  });

  it("lists the member's own activations of this offer, latest first", async () => {
    const older = { ...activationVernet, id: "act_0", activatedAt: "2026-10-01T10:00:00.000Z", rateBps: 600, boosted: false, offer: offerVernet };
    await renderApp(<OfferDetailScreen id="ofr_vernet" />, {
      routes: { "GET /offers/:id": () => offerVernetDetail, "GET /me/activations": () => page([older, { ...activationVernet, offer: offerVernet }, { ...activationVernet, id: "act_other", offerId: "ofr_lune", offer: offerLune }]) },
    });
    const mine = await screen.findByRole("list", { name: "Your activations" });
    const items = within(mine).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("12 nov. 2026");
    expect(items[0]).toHaveTextContent("9 %");
    expect(items[1]).toHaveTextContent("1 oct. 2026");
  });

  it("shows the API's reason when the offer cannot be activated", async () => {
    await renderApp(<OfferDetailScreen id="ofr_vernet" />, { routes: { "GET /offers/:id": () => offerVernetDetail, "POST /offers/:id/activate": () => refuse(422, "rule", "this offer is over") } });
    fireEvent.click(await screen.findByRole("button", { name: "Activate and shop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("this offer is over");
  });
});
