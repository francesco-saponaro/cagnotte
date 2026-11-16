import { hasRole } from "@cagnotte/domain";
import { Redirect, Slot, usePathname } from "expo-router";
import { useSession } from "@/app-context";
import { useSignOut } from "@/api/queries";
import { Shell, destinationsFor } from "@/ui/shell";

/** The back office: agents and managers only. A member who types one of these paths is sent to the offers, not told what is behind them. */
export default function OpsLayout() {
  const session = useSession();
  const path = usePathname();
  const signOut = useSignOut();
  if (session.status === "signed-out" || !session.user) return <Redirect href="/sign-in" />;
  if (!hasRole({ id: session.user.id, role: session.user.role }, "agent")) return <Redirect href="/offers" />;
  return (
    <Shell path={path} destinations={destinationsFor(session.user.role)} onSignOut={() => signOut.mutate()}>
      <Slot />
    </Shell>
  );
}
