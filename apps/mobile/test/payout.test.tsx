import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayoutScreen } from "@/screens/payout";
import { payoutSent, wallet } from "./fixtures";
import { page, refuse, renderApp } from "./harness";

const routes = { "GET /me/wallet": () => wallet, "GET /me/payouts": () => page([payoutSent]) };

describe("the payout form", () => {
  it("shows what is available and the minimum of the chosen method", async () => {
    await renderApp(<PayoutScreen />, { routes });
    expect(await screen.findByText(/169,10 € available/)).toBeInTheDocument();
    expect(screen.getByText(/at least 20,00 €, in steps of 5,00 €/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Donation" }));
    expect(screen.getByText(/at least 5,00 €/)).toBeInTheDocument();
  });

  it("refuses an amount that is not money before sending", async () => {
    const { api } = await renderApp(<PayoutScreen />, { routes });
    await screen.findByText(/169,10 € available/);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "twenty" } });
    fireEvent.change(screen.getByLabelText("IBAN"), { target: { value: "FR76 3000 6000 0112 3456 7890 189" } });
    fireEvent.click(screen.getByRole("button", { name: "Request the transfer" }));
    expect(await screen.findByText("enter an amount in euros, like 20 or 24,50")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("sends the amount in cents and a masked destination, then shows the request", async () => {
    const { api } = await renderApp(<PayoutScreen />, { routes: { ...routes, "POST /me/payouts": ({ body }) => ({ ...payoutSent, id: "pay_new", status: "requested", ...(body as object) }) } });
    await screen.findByText(/169,10 € available/);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("IBAN"), { target: { value: "FR76 3000 6000 0112 3456 7890 189" } });
    fireEvent.click(screen.getByRole("button", { name: "Request the transfer" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ method: "transfer", amountCents: 2500, destination: "FR76 •••• 0189" }));
    expect(await screen.findByText(/25,00 € is reserved/)).toBeInTheDocument();
  });

  it("shows the API's rule when the balance does not cover it", async () => {
    await renderApp(<PayoutScreen />, { routes: { ...routes, "POST /me/payouts": () => refuse(422, "rule", "only 1,50 € is available") } });
    await screen.findByText(/169,10 € available/);
    fireEvent.click(screen.getByRole("radio", { name: "Gift card" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "Maison Vernet" } });
    fireEvent.click(screen.getByRole("button", { name: "Request the gift card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only 1,50 € is available");
  });

  it("lists the earlier payouts with their status", async () => {
    await renderApp(<PayoutScreen />, { routes });
    expect(await screen.findByText("FR76 •••• 4421")).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
  });
});
