import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CashbackDetailScreen } from "@/screens/cashback-detail";
import { WalletScreen } from "@/screens/wallet";
import { cashbackPending, cashbackRefused, cashbackValidated, cashbackValidatedDetail, wallet } from "./fixtures";
import { page, renderApp } from "./harness";

const routes = {
  "GET /me/wallet": () => wallet,
  "GET /me/cashbacks": ({ query }: { query: Record<string, unknown> }) => page([cashbackPending, cashbackValidated, cashbackRefused].filter((c) => !query.status || c.status === query.status)),
};

describe("the wallet", () => {
  it("leads with what is available and shows the other buckets beside it", async () => {
    await renderApp(<WalletScreen />, { routes });
    expect(await screen.findAllByText("169,10 €")).toHaveLength(2);
    expect(screen.getByText("11,69 €", { selector: "[data-bucket=pending]" })).toBeInTheDocument();
    expect(screen.getByText("20,00 €", { selector: "[data-bucket=paid]" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Your pot: 11,69 € pending, 169,10 € available, 0,00 € reserved, 20,00 € paid out" })).toBeInTheDocument();
  });

  it("names the next cashback to validate as the finding under the title", async () => {
    await renderApp(<WalletScreen />, { routes });
    expect(await screen.findByText(/11,69 € from Maison Vernet validates/)).toBeInTheDocument();
  });

  it("lists the cashbacks with their status and filters them on the server", async () => {
    const { api } = await renderApp(<WalletScreen />, { routes });
    expect(await screen.findByText("Papeterie Lune")).toBeInTheDocument();
    expect(screen.getAllByText("refused")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Pending" }));
    await waitFor(() => expect(api.calls.at(-1)?.query).toMatchObject({ status: "pending" }));
    await waitFor(() => expect(screen.queryByText("Papeterie Lune")).not.toBeInTheDocument());
  });

  it("goes to the payout form, the claim form and a cashback", async () => {
    const { nav } = await renderApp(<WalletScreen />, { routes });
    await screen.findAllByText("169,10 €");
    fireEvent.click(screen.getByRole("link", { name: "Use my pot" }));
    fireEvent.click(screen.getByRole("link", { name: "Something missing?" }));
    fireEvent.click(screen.getAllByRole("link", { name: /Maison Vernet/ })[0]!);
    expect(nav.pushed).toEqual(["/wallet/payout", "/claims/new", "/wallet/cashbacks/cb_pending"]);
  });

  it("shows the latest movements with their sign", async () => {
    await renderApp(<WalletScreen />, { routes });
    const movements = await screen.findByRole("list", { name: "Movements" });
    expect(within(movements).getByText("+11,69 €")).toBeInTheDocument();
    expect(within(movements).getAllByText("−20,00 €")).toHaveLength(2);
  });
});

describe("the cashback detail", () => {
  it("shows the amount, how it was computed, and every move of the money", async () => {
    await renderApp(<CashbackDetailScreen id="cb_validated" />, { routes: { "GET /me/cashbacks/:id": () => cashbackValidatedDetail } });
    expect(await screen.findByRole("heading", { level: 1, name: "5,00 € from Papeterie Lune" })).toBeInTheDocument();
    expect(screen.getByText("validated")).toBeInTheDocument();
    expect(screen.getByText(/5,00 € fixed on an order of 42,00 €/)).toBeInTheDocument();
    const moves = screen.getByRole("list", { name: "Moves" });
    expect(within(moves).getAllByRole("listitem")).toHaveLength(3);
    expect(within(moves).getByText(/available.*\+5,00 €/)).toBeInTheDocument();
  });
});
