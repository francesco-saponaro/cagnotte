import { Redirect } from "expo-router";
import { useSession } from "@/app-context";
import { homeFor } from "@/auth/home";

/** The front door: signed in goes home, anyone else signs in. */
export default function Index() {
  const session = useSession();
  if (session.status === "signed-in" && session.user) return <Redirect href={homeFor(session.user.role) as never} />;
  return <Redirect href="/sign-in" />;
}
