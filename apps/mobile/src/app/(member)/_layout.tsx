import { Redirect, Slot, usePathname } from "expo-router";
import { useSession } from "@/app-context";
import { useSignOut } from "@/api/queries";
import { Shell, destinationsFor } from "@/ui/shell";

/** Every member screen sits in the shell with the role's destinations; without a session there is nothing to show here. */
export default function MemberLayout() {
  const session = useSession();
  const path = usePathname();
  const signOut = useSignOut();
  if (session.status === "signed-out" || !session.user) return <Redirect href="/sign-in" />;
  return (
    <Shell path={path} destinations={destinationsFor(session.user.role)} onSignOut={() => signOut.mutate()}>
      <Slot />
    </Shell>
  );
}
