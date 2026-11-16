import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardScreen, marginLine, queueLine } from "@/screens/dashboard";
import { formatEuros } from "@/ui/format";
import { renderApp, signedIn } from "./harness";
import { margin, nadia, overview, reconciliationOk } from "./ops-fixtures";

/*
 * "Is the book right, and what is waiting for a human?" The dashboard is read in the morning:
 * the three queues, the margin per merchant, the pot across every member, and the proof that the
 * ledger reconciles.
 */

const routes = (reconciliation = reconciliationOk) => ({
  "GET /reports/overview": () => overview,
  "GET /reports/margin": () => margin,
  "GET /reports/reconciliation": () => reconciliation,
});

describe("the dashboard", () => {
  it("leads with the three queues and the ledger's verdict, each queue a link", async () => {
    const { nav } = await renderApp(<DashboardScreen />, { session: await signedIn(nadia), routes: routes() });
    expect(await screen.findByText("37 sales matched no click, 14 claims open, 9 payouts waiting; the ledger reconciles.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /Claims open/ }));
    expect(nav.pushed).toEqual(["/support"]);
    expect(screen.getByRole("link", { name: /Sales with no click/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Payouts waiting/ })).toBeInTheDocument();
  });

  it("draws the margin per merchant with the totals summed from the lines and a negative margin signed", async () => {
    await renderApp(<DashboardScreen />, { session: await signedIn(nadia), routes: routes() });
    expect(await screen.findByText("Maison Vernet")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Maison Vernet: 614,76 € commission, 307,38 € cashback, 307,38 € margin/ })).toBeInTheDocument();
    expect(screen.getByText("−2,52 €")).toBeInTheDocument();
    expect(screen.getByText("882,24 €")).toBeInTheDocument();
    expect(screen.getByText("517,38 €")).toBeInTheDocument();
    expect(screen.getByText("364,86 €")).toBeInTheDocument();
    expect(screen.getByText("All shops, 65 sales")).toBeInTheDocument();
    expect(screen.getByText(/16 oct\. 2026 to 15 nov\. 2026/)).toBeInTheDocument();
  });

  it("says when the ledger does not reconcile and shows the failing check", async () => {
    const broken = { ...reconciliationOk, ok: false, checks: [reconciliationOk.checks[0]!, { ...reconciliationOk.checks[1]!, actual: 1_938_515, ok: false }], cashbacksOutOfBalance: ["cb_000042"] };
    await renderApp(<DashboardScreen />, { session: await signedIn(nadia), routes: routes(broken) });
    expect(await screen.findByText(/the ledger does not reconcile: 1 check failed/)).toBeInTheDocument();
    expect(screen.getByText("off")).toBeInTheDocument();
    expect(screen.getByText(`expected ${formatEuros(1_938_615)}, found ${formatEuros(1_938_515)}`)).toBeInTheDocument();
  });

  it("prints the reconciliation's zeros as zeros", async () => {
    await renderApp(<DashboardScreen />, { session: await signedIn(nadia), routes: routes() });
    expect(await screen.findByText("Cashbacks out of balance")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(3);
  });
});

describe("the sentences", () => {
  it("counts in words and names the baseline of the margin", () => {
    expect(queueLine(overview, reconciliationOk)).toBe("37 sales matched no click, 14 claims open, 9 payouts waiting; the ledger reconciles.");
    expect(queueLine({ ...overview, unmatchedTransactions: 1, openClaims: 0, payoutsWaiting: 1 }, { ...reconciliationOk, ok: false, checks: [{ ...reconciliationOk.checks[0]!, ok: false }, { ...reconciliationOk.checks[1]!, ok: false }] })).toBe(
      "1 sale matched no click, no claim open, 1 payout waiting; the ledger does not reconcile: 2 checks failed.",
    );
    expect(marginLine(margin)).toBe("Over 30 days the networks paid 882,24 € of commission on 65 sales and the members got 517,38 €; one shop paid out more than it earned.");
  });
});
