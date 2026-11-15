import { Redirect, Slot, usePathname } from "expo-router";
import { useSession } from "@/app-context";
import { useSignOut } from "@/api/queries";
import { Shell } from "@/ui/shell";

/** Every member screen sits in the shell; without a session there is nothing to show here. */
export default function MemberLayout() {
  const session = useSession();
  const path = usePathname();
  const signOut = useSignOut();
  if (session.status === "signed-out") return <Redirect href="/sign-in" />;
  return (
    <Shell path={path} onSignOut={() => signOut.mutate()}>
      <Slot />
    </Shell>
  );
}
