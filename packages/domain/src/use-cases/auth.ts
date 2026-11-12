import { sha256 } from "@noble/hashes/sha2.js";
import type { Actor, PublicUser, Referral, Session, User } from "../entities.js";
import { hashPassword, passwordProblems, verifyPassword } from "../password.js";
import type { Deps, Ports } from "../ports.js";
import { fail, ok, type Result } from "../result.js";

/*
 * Sign-up, sign-in, sign-out and "who is this token". Sessions are opaque: the client holds a
 * random token, the database holds its SHA-256, so a leaked table gives nobody a session.
 */

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  referralCode?: string | undefined;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignedIn {
  user: PublicUser;
  token: string;
  expiresAt: Date;
}

export const REFERRAL_CODE_LIMIT = 20;
const REFERRAL_WINDOW_DAYS = 90;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function publicUser(user: User): PublicUser {
  const { passwordHash: _hash, ...rest } = user;
  return rest;
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** The session id for a token: what the sessions table stores. */
export function sessionIdOf(token: string): string {
  return toHex(sha256(new TextEncoder().encode(token)));
}

/** "Jean-Luc Picard" → "jeanluc", the stem of a referral code. */
export function codeStem(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  const stem = first
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return stem || "member";
}

export function authUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids, sessionHours } = deps;

  // Takes the ports to write with: inside a unit of work that must be the transaction's own, never
  // the outer ones, or a single-connection database (PGlite) waits on itself forever.
  async function openSession(on: Ports, userId: string): Promise<{ token: string; session: Session }> {
    const token = ids.token(48);
    const now = clock.now();
    const session: Session = { id: sessionIdOf(token), userId, createdAt: now, expiresAt: new Date(now.getTime() + sessionHours * HOUR) };
    await on.sessions.insert(session);
    return { token, session };
  }

  async function freshReferralCode(displayName: string): Promise<string> {
    const stem = codeStem(displayName);
    for (let i = 0; i < 20; i++) {
      const code = `${stem}${ids.token(i < 10 ? 2 : 4)}`;
      if (!(await ports.users.findByReferralCode(code))) return code;
    }
    return `${stem}${ids.token(8)}`;
  }

  const signUp = async (input: SignUpInput): Promise<Result<SignedIn>> => {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    if (!EMAIL.test(email)) return fail("invalid", "email is not valid");
    if (displayName.length === 0) return fail("invalid", "name is required");
    const problems = passwordProblems(input.password);
    if (problems.length > 0) return fail("invalid", `password needs ${problems.join(", ")}`, problems);
    if (await ports.users.findByEmail(email)) return fail("conflict", "an account with this email already exists");

    let referrer: User | null = null;
    const code = input.referralCode?.trim().toLowerCase();
    if (code) {
      referrer = await ports.users.findByReferralCode(code);
      if (!referrer) return fail("rule", "unknown referral code");
      if ((await ports.referrals.countByReferrer(referrer.id)) >= REFERRAL_CODE_LIMIT) return fail("rule", "this referral code has already been used twenty times");
    }

    const now = clock.now();
    const user: User = {
      id: ids.id("usr_"),
      email,
      passwordHash: await hashPassword(input.password),
      displayName,
      role: "member",
      referralCode: await freshReferralCode(displayName),
      referredBy: referrer?.id ?? null,
      createdAt: now,
    };
    const out = await unitOfWork.run(async (tx) => {
      await tx.users.insert(user);
      if (referrer) {
        const referral: Referral = {
          id: ids.id("ref_"),
          referrerId: referrer.id,
          refereeId: user.id,
          code: referrer.referralCode,
          status: "pending",
          createdAt: now,
          expiresAt: new Date(now.getTime() + REFERRAL_WINDOW_DAYS * DAY),
          validatedAt: null,
          bonusUntil: null,
        };
        await tx.referrals.insert(referral);
      }
      return openSession(tx, user.id);
    });
    return ok({ user: publicUser(user), token: out.token, expiresAt: out.session.expiresAt });
  };

  const signIn = async (input: SignInInput): Promise<Result<SignedIn>> => {
    const user = await ports.users.findByEmail(input.email.trim().toLowerCase());
    // The same answer whether the email or the password is wrong, so the form cannot probe for accounts.
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) return fail("unauthorized", "wrong email or password");
    const { token, session } = await openSession(ports, user.id);
    return ok({ user: publicUser(user), token, expiresAt: session.expiresAt });
  };

  const authenticate = async (token: string): Promise<Result<{ actor: Actor; user: PublicUser }>> => {
    const session = await ports.sessions.findActive(sessionIdOf(token), clock.now());
    if (!session) return fail("unauthorized", "sign in first");
    const user = await ports.users.findById(session.userId);
    if (!user) return fail("unauthorized", "sign in first");
    return ok({ actor: { id: user.id, role: user.role }, user: publicUser(user) });
  };

  const signOut = async (token: string): Promise<Result<null>> => {
    await ports.sessions.delete(sessionIdOf(token));
    return ok(null);
  };

  const me = async (actor: Actor): Promise<Result<PublicUser>> => {
    const user = await ports.users.findById(actor.id);
    if (!user) return fail("unauthorized", "sign in first");
    return ok(publicUser(user));
  };

  return { signUp, signIn, authenticate, signOut, me };
}
