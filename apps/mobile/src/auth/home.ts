import type { UserRole } from "@cagnotte/domain";

/** Where each role lands after signing in: the member on the offers, the agent on the support queue, the manager on the dashboard. */
export function homeFor(role: UserRole): string {
  switch (role) {
    case "member":
      return "/offers";
    case "agent":
      return "/support";
    case "manager":
      return "/dashboard";
  }
}

export const DEMO_ACCOUNTS = [
  { email: "marie@example.com", name: "Marie", role: "member" },
  { email: "sam@example.com", name: "Sam", role: "agent" },
  { email: "nadia@example.com", name: "Nadia", role: "manager" },
] as const;

export const DEMO_PASSWORD = "cagnotte-demo";
