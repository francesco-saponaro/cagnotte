import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignInScreen } from "@/screens/sign-in";
import { marie } from "./fixtures";
import { refuse, renderApp, signedOut } from "./harness";

describe("the sign-in screen", () => {
  it("refuses an email the API would refuse, before sending anything", async () => {
    const { api } = await renderApp(<SignInScreen />, { session: await signedOut() });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "marie-at-example" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "cagnotte-demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("not a valid email")).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("says where the database runs when the app is in demo mode, and not otherwise", async () => {
    await renderApp(<SignInScreen demo />, { session: await signedOut() });
    expect(screen.getByText(/runs PostgreSQL in your browser/)).toBeInTheDocument();
  });

  it("signs in, stores the session and goes to the offers", async () => {
    const signedInRow = { user: marie, token: "tok_fresh", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    const { api, nav, session } = await renderApp(<SignInScreen />, { session: await signedOut(), routes: { "POST /auth/sign-in": () => signedInRow } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Marie@Example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "cagnotte-demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(session.get().status).toBe("signed-in"));
    expect(session.get().token).toBe("tok_fresh");
    expect(api.calls[0]?.body).toEqual({ email: "marie@example.com", password: "cagnotte-demo" });
    expect(nav.replaced).toEqual(["/offers"]);
  });

  it("shows the API's own words when the password is wrong", async () => {
    await renderApp(<SignInScreen />, { session: await signedOut(), routes: { "POST /auth/sign-in": () => refuse(401, "unauthorized", "wrong email or password") } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "marie@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("wrong email or password");
  });

  it("fills the form from a demo account in one tap", async () => {
    await renderApp(<SignInScreen />, { session: await signedOut() });
    fireEvent.click(screen.getByRole("button", { name: /Sam.*agent/ }));
    expect(screen.getByLabelText("Email")).toHaveValue("sam@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("cagnotte-demo");
  });
});
