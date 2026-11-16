import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaimCaseScreen } from "@/screens/claim-case";
import { PayoutsQueueScreen } from "@/screens/payouts-queue";
import { SupportQueueScreen } from "@/screens/support-queue";
import { claimDeclined, claimFiled, offerVernet, wallet } from "./fixtures";
import { page, refuse, renderApp, signedIn } from "./harness";
import { nadia, payoutChecking, payoutRequested, sam, txUnmatched } from "./ops-fixtures";

/*
 * The agent's queue and the case they work; the manager's payouts queue. Every move is a POST to
 * the route of the transition, and a refusal from the state machine is shown in the API's words.
 */

const claimRaised = { ...claimFiled, id: "clm_3", orderRef: "ORD-55100", status: "raised" as const, assigneeId: sam.id, updatedAt: "2026-11-09T10:00:00.000Z" };
const claimAcknowledged = { ...claimFiled, id: "clm_4", status: "acknowledged" as const, assigneeId: sam.id };

describe("the support queue", () => {
  it("lists the claims with who filed them and where they stand, open first, and opens one", async () => {
    const { api, nav } = await renderApp(<SupportQueueScreen />, { session: await signedIn(sam), routes: { "GET /claims": () => page([claimFiled, claimRaised], 14) } });
    expect(await screen.findByText(/ORD-77213/)).toBeInTheDocument();
    expect(screen.getAllByText(/Marie Dubois/).length).toBeGreaterThan(0);
    expect(screen.getByText("filed")).toBeInTheDocument();
    expect(screen.getByText("raised")).toBeInTheDocument();
    expect(screen.getByText(/14 claims/)).toBeInTheDocument();
    expect(api.calls[0]?.query).toMatchObject({ page: 1, pageSize: 20 });
    fireEvent.click(screen.getByRole("link", { name: /ORD-77213/ }));
    expect(nav.pushed).toEqual(["/support/clm_1"]);
  });

  it("filters by status and by mine on the server", async () => {
    const { api } = await renderApp(<SupportQueueScreen />, { session: await signedIn(sam), routes: { "GET /claims": () => page([claimRaised]) } });
    await screen.findByText(/ORD-55100/);
    fireEvent.click(screen.getByRole("radio", { name: "Raised" }));
    await waitFor(() => expect(api.calls.at(-1)?.query).toMatchObject({ status: "raised" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mine" }));
    await waitFor(() => expect(api.calls.at(-1)?.query).toMatchObject({ status: "raised", assignee: sam.id }));
  });

  it("keeps the frame when nothing waits", async () => {
    await renderApp(<SupportQueueScreen />, { session: await signedIn(sam), routes: { "GET /claims": () => page([]) } });
    expect(await screen.findByText(/Nothing here/)).toBeInTheDocument();
  });
});

describe("the claim case", () => {
  const routes = (claim: typeof claimFiled) => ({
    "GET /claims/:id": () => claim,
    "GET /users/:id/wallet": () => wallet,
    "GET /users/:id/cashbacks": () => page([]),
    "GET /transactions": () => page([txUnmatched]),
  });

  it("shows the order, the proof, the member's pot, and offers Take, Acknowledge and Decline on a filed claim", async () => {
    await renderApp(<ClaimCaseScreen id="clm_1" />, { session: await signedIn(sam), routes: routes(claimFiled) });
    expect(await screen.findByRole("heading", { level: 1, name: "Claim ORD-77213" })).toBeInTheDocument();
    expect(screen.getByText(/Order ORD-77213 confirmed/)).toBeInTheDocument();
    expect(screen.getByText("169,10 €")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take it" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Credit the cashback" })).not.toBeInTheDocument();
  });

  it("takes a filed claim: posts the agent's id to assign", async () => {
    const { api } = await renderApp(<ClaimCaseScreen id="clm_1" />, { session: await signedIn(sam), routes: { ...routes(claimFiled), "POST /claims/:id/assign": ({ body }) => ({ ...claimFiled, assigneeId: (body as { assigneeId: string }).assigneeId }) } });
    fireEvent.click(await screen.findByRole("button", { name: "Take it" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/claims/clm_1/assign")?.body).toEqual({ assigneeId: sam.id }));
  });

  it("raises an acknowledged claim; a manager links the unmatched sale with the same order reference", async () => {
    const { api } = await renderApp(<ClaimCaseScreen id="clm_4" />, { session: await signedIn(nadia), routes: { ...routes(claimAcknowledged), "POST /claims/:id/raise": () => claimRaised } });
    expect(await screen.findByText(/LP-90001/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Raise with the network" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/claims/clm_4/raise")?.body).toEqual({ networkTransactionId: "ntx_unmatched" }));
  });

  it("raises without a link for an agent, who cannot read the transactions queue", async () => {
    const { api } = await renderApp(<ClaimCaseScreen id="clm_4" />, { session: await signedIn(sam), routes: { ...routes(claimAcknowledged), "POST /claims/:id/raise": () => claimRaised } });
    fireEvent.click(await screen.findByRole("button", { name: "Raise with the network" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/claims/clm_4/raise")?.body).toEqual({}));
    expect(api.calls.some((c) => c.path === "/transactions")).toBe(false);
  });

  it("credits a raised claim and declines with a reason from the list", async () => {
    const { api } = await renderApp(<ClaimCaseScreen id="clm_3" />, {
      session: await signedIn(sam),
      routes: { ...routes(claimRaised), "POST /claims/:id/credit": () => ({ ...claimRaised, status: "credited" }), "POST /claims/:id/decline": () => claimDeclined },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Credit the cashback" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/claims/clm_3/credit")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(await screen.findByRole("radio", { name: /order was returned/ }));
    fireEvent.click(screen.getByRole("button", { name: "Decline the claim" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/claims/clm_3/decline")?.body).toEqual({ reason: "order_returned" }));
  });

  it("shows the state machine's refusal in the API's words", async () => {
    await renderApp(<ClaimCaseScreen id="clm_1" />, { session: await signedIn(sam), routes: { ...routes(claimFiled), "POST /claims/:id/acknowledge": () => refuse(409, "conflict", "a claim cannot go from filed to credited") } });
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot go from filed");
  });

  it("says why a declined claim was declined and offers nothing to do", async () => {
    await renderApp(<ClaimCaseScreen id="clm_2" />, { session: await signedIn(sam), routes: routes({ ...claimDeclined, offer: offerVernet, member: claimFiled.member }) });
    expect(await screen.findByText(/the order was returned/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });
});

describe("the payouts queue", () => {
  it("lists what is requested first, with the member, the method and the masked destination, and the amount waiting", async () => {
    const { api } = await renderApp(<PayoutsQueueScreen />, { session: await signedIn(nadia), routes: { "GET /payouts": () => page([payoutRequested], 9) } });
    expect(await screen.findByText("Marie Dubois")).toBeInTheDocument();
    expect(screen.getByText(/FR76 •••• 4421/)).toBeInTheDocument();
    expect(screen.getByText(/9 payouts requested/)).toBeInTheDocument();
    expect(api.calls[0]?.query).toMatchObject({ status: "requested", page: 1 });
  });

  it("checks a requested payout, then sends it, each as its own move", async () => {
    let status: "requested" | "checking" = "requested";
    const { api } = await renderApp(<PayoutsQueueScreen />, {
      session: await signedIn(nadia),
      routes: {
        "GET /payouts": ({ query }) => (query["status"] === "checking" ? page([payoutChecking]) : page([payoutRequested])),
        "POST /payouts/:id/check": () => {
          status = "checking";
          return { ...payoutRequested, status };
        },
        "POST /payouts/:id/send": () => ({ ...payoutChecking, status: "sent" }),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Check" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/payouts/pay_req/check")).toBe(true));
    fireEvent.click(screen.getByRole("radio", { name: "Checking" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/payouts/pay_chk/send")).toBe(true));
  });

  it("fails a payout only with a reason, and shows the API's refusal", async () => {
    const { api } = await renderApp(<PayoutsQueueScreen />, {
      session: await signedIn(nadia),
      routes: { "GET /payouts": () => page([payoutRequested]), "POST /payouts/:id/fail": () => refuse(409, "conflict", "a payout cannot go from sent to failed") },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Fail" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark as failed" }));
    expect(await screen.findByText("required")).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.change(screen.getByLabelText("Why it failed"), { target: { value: "IBAN refused by the bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark as failed" }));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/payouts/pay_req/fail")?.body).toEqual({ reason: "IBAN refused by the bank" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot go from sent");
  });
});
