import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { homeFor } from "@/auth/home";
import { Shell, destinationsFor } from "@/ui/shell";
import { marie } from "./fixtures";
import { renderApp, signedIn } from "./harness";

/*
 * Each role has its own set of destinations and its own home: a member browses offers, an agent
 * opens the support queue, a manager opens the dashboard.
 */

describe("where each role lands", () => {
  it("sends a member to the offers, an agent to the support queue and a manager to the dashboard", () => {
    expect(homeFor("member")).toBe("/offers");
    expect(homeFor("agent")).toBe("/support");
    expect(homeFor("manager")).toBe("/dashboard");
  });
});

describe("the destinations", () => {
  it("gives an agent the support queue and their own account's screens", () => {
    expect(destinationsFor("agent").map((d) => d.href)).toEqual(["/support", "/offers", "/wallet", "/referrals"]);
  });

  it("gives a manager the whole back office", () => {
    expect(destinationsFor("manager").map((d) => d.href)).toEqual(["/dashboard", "/support", "/imports", "/transactions", "/payouts", "/catalogue"]);
  });

  it("marks the active destination from the path, so a claim case lights up Support", async () => {
    const nadia = { ...marie, id: "usr_nadia", displayName: "Nadia Benali", role: "manager" as const };
    await renderApp(
      <Shell path="/support/clm_1" destinations={destinationsFor("manager")} onSignOut={() => undefined}>
        <></>
      </Shell>,
      { session: await signedIn(nadia) },
    );
    const support = screen.getByRole("link", { name: "Support" });
    expect(support).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });
});
