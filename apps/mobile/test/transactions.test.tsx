import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransactionScreen } from "@/screens/transaction";
import { TransactionsScreen } from "@/screens/transactions";
import { nadia, txIgnored, txMatched, txMatchedDetail, txUnmatched, txUnmatchedDetail } from "./ops-fixtures";
import { page, refuse, renderApp, signedIn } from "./harness";

describe("the transactions queue", () => {
  it("asks the server for the unmatched ones first and says how many wait", async () => {
    const { api, nav } = await renderApp(<TransactionsScreen />, { session: await signedIn(nadia), routes: { "GET /transactions": () => page([txUnmatched], 37) } });
    expect(await screen.findByText(/ORD-77213/)).toBeInTheDocument();
    expect(api.calls[0]?.query).toMatchObject({ match: "unmatched" });
    expect(screen.getByText("37 sales matched no click; each waits for a claim or a match by hand.")).toBeInTheDocument();
    expect(screen.getByText("unmatched")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /ORD-77213/ }));
    expect(nav.pushed).toEqual(["/transactions/ntx_unmatched"]);
  });

  it("sends the chosen match status and network to the server", async () => {
    const { api } = await renderApp(<TransactionsScreen />, { session: await signedIn(nadia), routes: { "GET /transactions": ({ query }) => (query["match"] === "ignored" ? page([txIgnored]) : page([txUnmatched, txMatched])) } });
    await screen.findByText(/ORD-77213/);
    fireEvent.click(screen.getByRole("radio", { name: "Ignored" }));
    expect(await screen.findByText(/ORD-77400/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "affinet" }));
    await waitFor(() => expect(api.calls.at(-1)?.query).toMatchObject({ match: "ignored", network: "affinet" }));
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() => expect(api.calls.at(-1)?.query?.["match"]).toBeUndefined());
  });

  it("says so when the filter finds nothing", async () => {
    await renderApp(<TransactionsScreen />, { session: await signedIn(nadia), routes: { "GET /transactions": () => page([]) } });
    expect(await screen.findByText(/Nothing waits here/)).toBeInTheDocument();
    expect(screen.getByText(/Every reported sale has a member or a reason; nothing waits/)).toBeInTheDocument();
  });
});

describe("one transaction", () => {
  it("says why the automatic match did not happen and lists the clicks that qualify", async () => {
    const { api } = await renderApp(<TransactionScreen id="ntx_unmatched" />, { session: await signedIn(nadia), routes: { "GET /transactions/:id": () => txUnmatchedDetail, "POST /transactions/:id/match": () => ({ ...txUnmatched, matchStatus: "matched", activationId: "act_lucas" }) } });
    expect(await screen.findByRole("heading", { level: 1, name: "ORD-77213 at Maison Vernet" })).toBeInTheDocument();
    expect(screen.getByText(/the network reported no click reference/)).toBeInTheDocument();
    expect(screen.getByText("Marie Dubois")).toBeInTheDocument();
    expect(screen.getByText("Lucas Petit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Match to Lucas Petit's click" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ activationId: "act_lucas" }));
    expect(api.calls.find((c) => c.method === "POST")?.path).toBe("/transactions/ntx_unmatched/match");
  });

  it("refuses an empty ignore reason before sending, then posts the reason", async () => {
    const { api } = await renderApp(<TransactionScreen id="ntx_unmatched" />, { session: await signedIn(nadia), routes: { "GET /transactions/:id": () => txUnmatchedDetail, "POST /transactions/:id/ignore": () => ({ ...txUnmatched, matchStatus: "ignored" }) } });
    await screen.findByText(/no click reference/);
    fireEvent.click(screen.getByRole("button", { name: "Ignore this sale" }));
    expect(await screen.findByText("required")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "test order by the shop" } });
    fireEvent.click(screen.getByRole("button", { name: "Ignore this sale" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ reason: "test order by the shop" }));
  });

  it("shows the booked cashback with how it was computed and posts a validation with its reason", async () => {
    const { api } = await renderApp(<TransactionScreen id="ntx_matched" />, { session: await signedIn(nadia), routes: { "GET /transactions/:id": () => txMatchedDetail, "POST /cashbacks/:id/validate": () => ({ ...txMatchedDetail.cashback, status: "validated" }) } });
    expect(await screen.findByText("Marie Dubois")).toBeInTheDocument();
    expect(screen.getByText(/9 % of 129,90 €, the rate locked on the click, makes 11,69 €/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "The cashback" })).toBeInTheDocument();
    expect(screen.getByText("11,69 €")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "shop confirmed by email" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.path).toBe("/cashbacks/cb_pending/validate"));
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ reason: "shop confirmed by email" });
  });

  it("shows the API's sentence when the state machine refuses", async () => {
    await renderApp(<TransactionScreen id="ntx_unmatched" />, { session: await signedIn(nadia), routes: { "GET /transactions/:id": () => txUnmatchedDetail, "POST /transactions/:id/match": () => refuse(409, "conflict", "that click already has a cashback") } });
    fireEvent.click(await screen.findByRole("button", { name: "Match to Marie Dubois's click" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("that click already has a cashback");
  });
});
