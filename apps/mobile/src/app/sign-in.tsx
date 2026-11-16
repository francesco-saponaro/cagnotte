import { Redirect } from "expo-router";
import { useSession } from "@/app-context";
import { homeFor } from "@/auth/home";
import { demoMode } from "@/deps";
import { SignInScreen } from "@/screens/sign-in";

export default function SignIn() {
  const session = useSession();
  if (session.status === "signed-in" && session.user) return <Redirect href={homeFor(session.user.role) as never} />;
  return <SignInScreen demo={demoMode} />;
}
