import type { UserRole } from "@cagnotte/domain";

/** Where each role lands after signing in. Staff land on the offers too until the back office screens exist. */
export function homeFor(role: UserRole): string {
  switch (role) {
    case "member":
    case "agent":
    case "manager":
      return "/offers";
  }
}

export const DEMO_ACCOUNTS = [
  { email: "marie@example.com", name: "Marie", role: "member" },
  { email: "sam@example.com", name: "Sam", role: "agent" },
  { email: "nadia@example.com", name: "Nadia", role: "manager" },
] as const;

export const DEMO_PASSWORD = "cagnotte-demo";
