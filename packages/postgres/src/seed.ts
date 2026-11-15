import { applyRate, hashPassword, rateInForce } from "@cagnotte/domain";
import type { InferSelectModel } from "drizzle-orm";
import type { Db } from "./db.js";
import * as schema from "./schema.js";

/*
 * The seed: a coherent six months of a cashback app, generated from a fixed seed so every run,
 * every test and the browser demo see the same rows. Everything downstream is derived the way the
 * real pipeline derives it: an activation snapshots the rate in force, a network transaction
 * matches the activation it names, the cashback is computed from the activation's rate and clamped
 * to the cap and the commission, and the ledger entries follow the cashback's status.
 */

export type SeedData = {
  users: InferSelectModel<typeof schema.users>[];
  merchants: InferSelectModel<typeof schema.merchants>[];
  offers: InferSelectModel<typeof schema.offers>[];
  offerBoosts: InferSelectModel<typeof schema.offerBoosts>[];
  activations: InferSelectModel<typeof schema.activations>[];
  importBatches: InferSelectModel<typeof schema.importBatches>[];
  networkTransactions: InferSelectModel<typeof schema.networkTransactions>[];
  cashbacks: InferSelectModel<typeof schema.cashbacks>[];
  claims: InferSelectModel<typeof schema.claims>[];
  ledgerEntries: InferSelectModel<typeof schema.ledgerEntries>[];
  payouts: InferSelectModel<typeof schema.payouts>[];
  referrals: InferSelectModel<typeof schema.referrals>[];
  auditLog: InferSelectModel<typeof schema.auditLog>[];
};

export const DEMO_PASSWORD = "cagnotte-demo";

export const DEMO_ACCOUNTS = [
  { email: "marie@example.com", displayName: "Marie Lefebvre", role: "member" },
  { email: "sam@example.com", displayName: "Sam Okoro", role: "agent" },
  { email: "nadia@example.com", displayName: "Nadia Benali", role: "manager" },
] as const;

export interface SeedOptions {
  seed?: number;
  now?: Date;
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** mulberry32: small, fast, and the same sequence everywhere for the same seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = prng(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error("pick from an empty list");
    return item;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** A weighted choice: `[["a", 3], ["b", 1]]` picks a three times out of four. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((n, [, w]) => n + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1]![0];
  }
  token(length: number): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < length; i++) out += alphabet[Math.floor(this.next() * alphabet.length)];
    return out;
  }
}

const id = (prefix: string, n: number) => `${prefix}_${n.toString().padStart(6, "0")}`;

const FIRST_NAMES = ["Camille", "Lucas", "Inès", "Hugo", "Léa", "Nathan", "Chloé", "Thomas", "Manon", "Louis", "Sarah", "Adam", "Jade", "Raphaël", "Zoé", "Gabriel", "Louise", "Arthur", "Alice", "Jules", "Lina", "Mathis", "Anna", "Ethan", "Rose", "Nolan", "Eva", "Tom", "Mila", "Noah", "Ambre", "Sacha", "Clara", "Liam", "Nina", "Paul", "Lola", "Aaron", "Maya", "Victor", "Yasmine", "Karim", "Fatou", "Diego", "Elena", "Marco", "Sofia", "Ibrahim", "Leïla", "Mehdi"];
const LAST_NAMES = ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefèvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier", "Morel", "Girard", "André", "Mercier", "Dupont", "Lambert", "Bonnet", "François", "Martinez", "Legrand", "Garnier", "Faure", "Rousseau", "Blanc", "Guérin", "Muller", "Henry", "Roussel", "Nicolas", "Perrin", "Benali", "Diallo", "Nguyen", "Haddad", "Costa", "Silva", "Okoro", "Kowalski", "Rossi", "Schmitt"];

const MERCHANTS: { name: string; category: string; percent: number; validationDays: number; attributionDays: number }[] = [
  { name: "Maison Vernet", category: "fashion", percent: 6, validationDays: 60, attributionDays: 30 },
  { name: "Atelier Nord", category: "home", percent: 4, validationDays: 45, attributionDays: 30 },
  { name: "Bleu Marine Sport", category: "sport", percent: 5, validationDays: 45, attributionDays: 14 },
  { name: "Papeterie Lune", category: "home", percent: 8, validationDays: 30, attributionDays: 30 },
  { name: "Cuisine & Co", category: "home", percent: 3.5, validationDays: 60, attributionDays: 30 },
  { name: "Librairie du Canal", category: "culture", percent: 2, validationDays: 30, attributionDays: 7 },
  { name: "Voyages Ouest", category: "travel", percent: 3, validationDays: 120, attributionDays: 45 },
  { name: "Hôtels Horizon", category: "travel", percent: 4.5, validationDays: 120, attributionDays: 45 },
  { name: "Parfumerie Iris", category: "beauty", percent: 7, validationDays: 45, attributionDays: 30 },
  { name: "Beauté Simple", category: "beauty", percent: 10, validationDays: 30, attributionDays: 30 },
  { name: "Techno Dépôt", category: "tech", percent: 1.5, validationDays: 60, attributionDays: 14 },
  { name: "Clavier & Souris", category: "tech", percent: 2.5, validationDays: 60, attributionDays: 14 },
  { name: "Petits Pas", category: "kids", percent: 6, validationDays: 45, attributionDays: 30 },
  { name: "Jouets Marmotte", category: "kids", percent: 5.5, validationDays: 45, attributionDays: 30 },
  { name: "Épicerie Fine Roussel", category: "food", percent: 4, validationDays: 30, attributionDays: 7 },
  { name: "Cave des Coteaux", category: "food", percent: 5, validationDays: 30, attributionDays: 7 },
  { name: "Lunettes Claire", category: "health", percent: 9, validationDays: 60, attributionDays: 30 },
  { name: "Pharma Express", category: "health", percent: 3, validationDays: 30, attributionDays: 14 },
  { name: "Jardin Facile", category: "home", percent: 6.5, validationDays: 45, attributionDays: 30 },
  { name: "Lumière Déco", category: "home", percent: 7.5, validationDays: 60, attributionDays: 30 },
  { name: "Sneakers Avenue", category: "fashion", percent: 4, validationDays: 60, attributionDays: 30 },
  { name: "Tissu Libre", category: "fashion", percent: 8, validationDays: 45, attributionDays: 30 },
  { name: "Denim Atelier", category: "fashion", percent: 5, validationDays: 60, attributionDays: 30 },
  { name: "Montagne Équipement", category: "sport", percent: 4.5, validationDays: 45, attributionDays: 14 },
  { name: "Vélo Urbain", category: "sport", percent: 3, validationDays: 60, attributionDays: 14 },
  { name: "Studio Photo Pixel", category: "tech", percent: 2, validationDays: 60, attributionDays: 14 },
  { name: "Café Torréfacteur", category: "food", percent: 6, validationDays: 30, attributionDays: 7 },
  { name: "Thé & Infusions", category: "food", percent: 7, validationDays: 30, attributionDays: 7 },
  { name: "Assurance Boussole", category: "finance", percent: 0, validationDays: 150, attributionDays: 60 },
  { name: "Banque Rive", category: "finance", percent: 0, validationDays: 180, attributionDays: 60 },
  { name: "Location Roue Libre", category: "travel", percent: 5, validationDays: 90, attributionDays: 30 },
  { name: "Billets Scène", category: "culture", percent: 2.5, validationDays: 30, attributionDays: 7 },
  { name: "Musique en Ligne", category: "culture", percent: 3, validationDays: 30, attributionDays: 7 },
  { name: "Bébé Confort Plus", category: "kids", percent: 4, validationDays: 45, attributionDays: 30 },
  { name: "Animalerie Patte", category: "home", percent: 5, validationDays: 45, attributionDays: 30 },
  { name: "Bricolage Central", category: "home", percent: 3.5, validationDays: 60, attributionDays: 30 },
  { name: "Coiffure Studio", category: "beauty", percent: 12, validationDays: 30, attributionDays: 14 },
  { name: "Optique Vue Nette", category: "health", percent: 8, validationDays: 60, attributionDays: 30 },
  { name: "Fleurs du Marché", category: "home", percent: 9, validationDays: 30, attributionDays: 7 },
  { name: "Cours en Ligne Savoir", category: "culture", percent: 15, validationDays: 30, attributionDays: 14 },
];

const GIFT_CARD_BRANDS = ["Maison Vernet", "Techno Dépôt", "Librairie du Canal", "Sneakers Avenue", "Jardin Facile"];
const CHARITIES = ["Restos Solidaires", "Forêt Vivante", "Toits pour Tous"];
const DECLINE_REASONS = ["no_activation_before_order", "foreign_promo_code", "outside_claim_window", "order_not_found_at_network", "order_returned"];

type User = InferSelectModel<typeof schema.users>;
type Offer = InferSelectModel<typeof schema.offers>;
type Boost = InferSelectModel<typeof schema.offerBoosts>;
type Activation = InferSelectModel<typeof schema.activations>;
type Transaction = InferSelectModel<typeof schema.networkTransactions>;
type Cashback = InferSelectModel<typeof schema.cashbacks>;
type Ledger = InferSelectModel<typeof schema.ledgerEntries>;
type ClaimStatus = InferSelectModel<typeof schema.claims>["status"];

export async function generateSeed(options: SeedOptions = {}): Promise<SeedData> {
  const rng = new Rng(options.seed ?? 1);
  const now = options.now ?? new Date("2026-11-11T18:00:00Z");
  const start = new Date(now.getTime() - 180 * DAY);
  const between = (from: Date, to: Date) => new Date(from.getTime() + Math.floor(rng.float() * (to.getTime() - from.getTime())));

  const data: SeedData = {
    users: [],
    merchants: [],
    offers: [],
    offerBoosts: [],
    activations: [],
    importBatches: [],
    networkTransactions: [],
    cashbacks: [],
    claims: [],
    ledgerEntries: [],
    payouts: [],
    referrals: [],
    auditLog: [],
  };
  let ledgerN = 0;
  let auditN = 0;
  const book = (entry: Omit<Ledger, "id">): void => {
    if (entry.amountCents === 0) return;
    data.ledgerEntries.push({ id: id("led", ++ledgerN), ...entry });
  };
  const audit = (entry: Omit<InferSelectModel<typeof schema.auditLog>, "id">): void => {
    data.auditLog.push({ id: id("aud", ++auditN), ...entry });
  };

  // Users: the demo accounts, a few more staff, and the members.
  const demoHash = await hashPassword(DEMO_PASSWORD, new Uint8Array(16).fill(0x5a));
  const usedEmails = new Set<string>();
  const usedCodes = new Set<string>();
  const strip = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const makeCode = (name: string): string => {
    let code = strip(name.split(" ")[0] ?? name) + rng.int(10, 99);
    while (usedCodes.has(code)) code = strip(name.split(" ")[0] ?? name) + rng.int(100, 999);
    usedCodes.add(code);
    return code;
  };
  let userN = 0;
  const addUser = (displayName: string, role: User["role"], email: string, createdAt: Date, referredBy: string | null = null): User => {
    const user: User = { id: id("usr", ++userN), email, passwordHash: demoHash, displayName, role, referralCode: makeCode(displayName), referredBy, createdAt };
    usedEmails.add(email);
    data.users.push(user);
    return user;
  };
  for (const account of DEMO_ACCOUNTS) addUser(account.displayName, account.role, account.email, new Date(start.getTime() - 30 * DAY));
  addUser("Julien Mercier", "agent", "julien.mercier@example.com", new Date(start.getTime() - 20 * DAY));
  addUser("Amira Haddad", "agent", "amira.haddad@example.com", new Date(start.getTime() - 20 * DAY));
  addUser("Pierre Roussel", "manager", "pierre.roussel@example.com", new Date(start.getTime() - 20 * DAY));
  const memberCount = 300;
  for (let i = 0; i < memberCount; i++) {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    let email = `${strip(first)}.${strip(last)}@example.com`;
    let n = 1;
    while (usedEmails.has(email)) email = `${strip(first)}.${strip(last)}${++n}@example.com`;
    addUser(`${first} ${last}`, "member", email, between(new Date(start.getTime() - 60 * DAY), new Date(now.getTime() - 3 * DAY)));
  }
  const members = data.users.filter((u) => u.role === "member");
  const agents = data.users.filter((u) => u.role === "agent");
  const managers = data.users.filter((u) => u.role === "manager");
  const marie = data.users[0]!;

  // Referrals: later members referred by earlier ones.
  const sortedMembers = [...members].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (let i = 40; i < sortedMembers.length; i++) {
    if (!rng.chance(0.3)) continue;
    const referee = sortedMembers[i]!;
    const referrer = i < 60 && rng.chance(0.5) ? marie : rng.pick(sortedMembers.slice(0, Math.min(i, 80)));
    if (referrer.id === referee.id) continue;
    referee.referredBy = referrer.id;
    data.referrals.push({
      id: id("ref", data.referrals.length + 1),
      referrerId: referrer.id,
      refereeId: referee.id,
      code: referrer.referralCode,
      status: "pending",
      createdAt: referee.createdAt,
      expiresAt: referee.createdAt >= new Date("2026-11-10T00:00:00Z") ? new Date(referee.createdAt.getTime() + 90 * DAY) : null,
      validatedAt: null,
      bonusUntil: null,
    });
  }

  // Merchants and offers.
  MERCHANTS.forEach((m, i) => {
    data.merchants.push({
      id: id("mer", i + 1),
      slug: strip(m.name).replace(/[^a-z0-9]+/g, "-"),
      name: m.name,
      category: m.category,
      country: "FR",
      attributionDays: m.attributionDays,
      network: i % 3 === 0 ? "affinet" : "linkpool",
      advertiserRef: `${i % 3 === 0 ? "AF" : "LP"}-${(1000 + i * 37).toString()}`,
    });
  });
  const offerFor = (merchantIndex: number, variant: number): Offer => {
    const m = MERCHANTS[merchantIndex]!;
    const merchant = data.merchants[merchantIndex]!;
    const n = data.offers.length + 1;
    const fixed = m.percent === 0 || (variant > 0 && rng.chance(0.15));
    const createdAt = between(new Date(start.getTime() - 90 * DAY), new Date(start.getTime() + 30 * DAY));
    const status: Offer["status"] = rng.weighted([
      ["live", 14],
      ["paused", 2],
      ["draft", 1],
      ["ended", 2],
    ]);
    const minSpend = rng.chance(0.3) ? rng.pick([2000, 3000, 5000, 10000]) : 0;
    const title =
      variant === 0
        ? fixed
          ? `${m.name}: ${(fixed ? rng.pick([5, 10, 20, 30]) : 0).toString()} € back on your first contract`
          : `${m.name}: ${m.percent.toString().replace(".", ",")} % back on everything`
        : rng.pick([`${m.name}: new customers`, `${m.name}: the ${m.category} selection`, `${m.name}: app exclusive`]);
    const fixedCents = fixed ? (/(\d+) €/.exec(title) ? Number(/(\d+) €/.exec(title)![1]) * 100 : rng.pick([500, 1000, 2000])) : 0;
    const offer: Offer = {
      id: id("ofr", n),
      merchantId: merchant.id,
      kind: "online",
      title,
      description: fixed
        ? "A fixed amount once the merchant confirms the sign-up. Only the first contract counts."
        : `Cashback on the price including VAT, delivery excluded. Validated by ${m.name} within ${m.validationDays} days.`,
      rateKind: fixed ? "fixed" : "percent",
      rateBps: fixed ? 0 : Math.round((variant === 0 ? m.percent : m.percent * rng.pick([0.5, 0.75, 1.5, 2])) * 100),
      fixedCents,
      minSpendCents: minSpend,
      newCustomersOnly: variant > 0 && rng.chance(0.4),
      capCents: rng.chance(0.12) ? rng.pick([1500, 2500, 5000]) : null,
      validationDays: m.validationDays,
      status,
      startsAt: createdAt,
      endsAt: status === "ended" ? between(createdAt, now) : null,
      createdAt,
      updatedAt: createdAt,
    };
    data.offers.push(offer);
    return offer;
  };
  MERCHANTS.forEach((_, i) => {
    offerFor(i, 0);
    if (rng.chance(0.7)) offerFor(i, 1);
    if (rng.chance(0.4)) offerFor(i, 2);
  });
  // Gift-card offers: instant cashback on a voucher bought in the app.
  for (const brand of GIFT_CARD_BRANDS) {
    const merchant = data.merchants.find((m) => m.name === brand)!;
    const createdAt = new Date(start.getTime() + 10 * DAY);
    data.offers.push({
      id: id("ofr", data.offers.length + 1),
      merchantId: merchant.id,
      kind: "voucher",
      title: `${brand} gift card: 3 % back right away`,
      description: "Buy the gift card in the app and the cashback is validated at once.",
      rateKind: "percent",
      rateBps: 300,
      fixedCents: 0,
      minSpendCents: 1000,
      newCustomersOnly: false,
      capCents: null,
      validationDays: 1,
      status: "live",
      startsAt: createdAt,
      endsAt: null,
      createdAt,
      updatedAt: createdAt,
    });
  }
  const liveOffers = data.offers.filter((o) => o.status === "live" || o.status === "paused" || o.status === "ended");

  // Boosts: non-overlapping windows on live percent offers, past, present and future.
  const boostsByOffer = new Map<string, Boost[]>();
  for (const offer of data.offers) {
    if (offer.status !== "live" || offer.rateKind !== "percent" || !rng.chance(0.45)) continue;
    const windows = rng.int(1, 2);
    let cursor = between(start, new Date(now.getTime() - 60 * DAY));
    for (let w = 0; w < windows; w++) {
      const startsAt = new Date(cursor.getTime() + rng.int(5, 40) * DAY);
      const endsAt = new Date(startsAt.getTime() + rng.int(3, 14) * DAY);
      const boost: Boost = {
        id: id("bst", data.offerBoosts.length + 1),
        offerId: offer.id,
        rateBps: offer.rateBps + rng.pick([200, 300, 500, 800]),
        startsAt,
        endsAt,
        createdBy: rng.pick(managers).id,
      };
      data.offerBoosts.push(boost);
      boostsByOffer.set(offer.id, [...(boostsByOffer.get(offer.id) ?? []), boost]);
      cursor = endsAt;
    }
  }
  const boostsOf = (offerId: string) => (boostsByOffer.get(offerId) ?? []).map((b) => ({ rateBps: b.rateBps, startsAt: b.startsAt, endsAt: b.endsAt }));

  // Activations: members tapping offers over the last six months. Marie gets a rich history.
  const usedSubIds = new Set<string>();
  const subId = () => {
    let s = rng.token(16);
    while (usedSubIds.has(s)) s = rng.token(16);
    usedSubIds.add(s);
    return s;
  };
  const activate = (user: User, offer: Offer, at: Date): Activation => {
    const rate = rateInForce(offer.rateBps, boostsOf(offer.id), at);
    const merchant = data.merchants.find((m) => m.id === offer.merchantId)!;
    const activation: Activation = {
      id: id("act", data.activations.length + 1),
      userId: user.id,
      offerId: offer.id,
      subId: subId(),
      rateBps: rate.rateBps,
      boosted: rate.boosted,
      activatedAt: at,
      trackingUrl: `https://track.${merchant.network}.example/go?adv=${merchant.advertiserRef}&sub=`,
    };
    activation.trackingUrl += activation.subId;
    data.activations.push(activation);
    return activation;
  };
  const activationCount = 4000;
  for (let i = 0; i < activationCount; i++) {
    const user = i < 60 ? marie : rng.pick(members);
    const offer = rng.pick(liveOffers);
    const earliest = new Date(Math.max(start.getTime(), user.createdAt.getTime(), offer.startsAt.getTime()));
    if (earliest >= now) continue;
    activate(user, offer, between(earliest, now));
  }
  data.activations.sort((a, b) => a.activatedAt.getTime() - b.activatedAt.getTime());
  data.activations.forEach((a, i) => (a.id = id("act", i + 1)));

  // Import batches: one per network per fortnight.
  const batchAt: Date[] = [];
  for (let t = start.getTime() + 14 * DAY; t <= now.getTime(); t += 14 * DAY) batchAt.push(new Date(t));
  for (const network of ["linkpool", "affinet"] as const) {
    for (const at of batchAt) {
      data.importBatches.push({
        id: id("imp", data.importBatches.length + 1),
        network,
        filename: `${network}-transactions-${at.toISOString().slice(0, 10)}.${network === "linkpool" ? "csv" : "json"}`,
        importedBy: rng.pick(managers).id,
        status: "processed",
        rowCount: 0,
        newCount: 0,
        updatedCount: 0,
        matchedCount: 0,
        unmatchedCount: 0,
        errorCount: 0,
        errors: [],
        createdAt: at,
        processedAt: new Date(at.getTime() + rng.int(1, 4) * 60 * 1000),
      });
    }
  }
  const batchFor = (network: "linkpool" | "affinet", reportedAt: Date) =>
    data.importBatches.filter((b) => b.network === network && b.createdAt >= reportedAt).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ??
    data.importBatches.filter((b) => b.network === network).at(-1)!;

  // Network transactions and cashbacks: seventy percent of activations led to an order.
  const offersById = new Map(data.offers.map((o) => [o.id, o]));
  const merchantsById = new Map(data.merchants.map((m) => [m.id, m]));
  const usersById = new Map(data.users.map((u) => [u.id, u]));
  const validatedAtMerchant = new Set<string>();
  let txN = 0;
  const newTransaction = (merchant: (typeof data.merchants)[number], orderedAt: Date, orderCents: number, commissionCents: number, status: Transaction["networkStatus"], activation: Activation | null): Transaction => {
    const reportedAt = new Date(orderedAt.getTime() + rng.int(6, 72) * HOUR);
    const batch = batchFor(merchant.network, reportedAt);
    const tx: Transaction = {
      id: id("ntx", ++txN),
      batchId: batch.id,
      network: merchant.network,
      networkRef: `${merchant.network === "linkpool" ? "LP" : "AF"}${(100000 + txN * 7).toString()}`,
      subId: activation ? activation.subId : rng.chance(0.5) ? null : rng.token(16),
      orderRef: `ORD-${rng.token(8).toUpperCase()}`,
      merchantId: merchant.id,
      orderedAt,
      orderCents,
      commissionCents,
      networkStatus: status,
      reportedAt,
      matchStatus: activation ? "matched" : "unmatched",
      activationId: activation ? activation.id : null,
      ignoreReason: null,
    };
    data.networkTransactions.push(tx);
    return tx;
  };
  const bookCashback = (cb: Cashback, createdBy: string | null = null): void => {
    if (cb.amountCents === 0) return;
    const base = { userId: cb.userId, refType: "cashback", refId: cb.id, createdBy };
    if (cb.decidedBy === "claim") {
      book({ ...base, kind: "manual_credit", bucket: "available", amountCents: cb.amountCents, note: "Credited from a claim", createdAt: cb.validatedAt ?? cb.createdAt });
      return;
    }
    book({ ...base, kind: "cashback_pending", bucket: "pending", amountCents: cb.amountCents, note: null, createdAt: cb.createdAt });
    if (cb.status === "validated" || cb.status === "cancelled") {
      book({ ...base, kind: "cashback_validated", bucket: "pending", amountCents: -cb.amountCents, note: null, createdAt: cb.validatedAt! });
      book({ ...base, kind: "cashback_validated", bucket: "available", amountCents: cb.amountCents, note: null, createdAt: cb.validatedAt! });
    }
    if (cb.status === "refused") book({ ...base, kind: "cashback_refused", bucket: "pending", amountCents: -cb.amountCents, note: cb.decisionReason ?? null, createdAt: cb.decidedAt! });
    if (cb.status === "cancelled") book({ ...base, kind: "cashback_cancelled", bucket: "available", amountCents: -cb.amountCents, note: cb.decisionReason ?? null, createdAt: cb.decidedAt! });
  };
  const amountFor = (offer: Offer, orderCents: number, rateBps: number, commissionCents: number | null): { amount: number; clamped: boolean } => {
    if (orderCents < offer.minSpendCents) return { amount: 0, clamped: false };
    let amount = offer.rateKind === "fixed" ? offer.fixedCents : applyRate(orderCents, rateBps);
    if (offer.capCents != null) amount = Math.min(amount, offer.capCents);
    if (commissionCents !== null && commissionCents < amount) return { amount: commissionCents, clamped: true };
    return { amount, clamped: false };
  };
  const activationsWithOrder = new Set<string>();
  for (const activation of data.activations) {
    if (!rng.chance(0.7)) continue;
    const offer = offersById.get(activation.offerId)!;
    const merchant = merchantsById.get(offer.merchantId)!;
    const orderedAt = new Date(activation.activatedAt.getTime() + rng.int(1, Math.min(48, merchant.attributionDays * 24)) * HOUR);
    if (orderedAt >= now) continue;
    activationsWithOrder.add(activation.id);
    const orderCents = offer.kind === "voucher" ? rng.pick([2500, 5000, 10000, 15000]) : rng.int(900, offer.rateKind === "fixed" ? 30000 : 45000);
    // The network's commission is usually above the cashback; a few merchants pay thin margins.
    const commissionCents = offer.rateKind === "fixed" ? offer.fixedCents + rng.int(0, 1500) : applyRate(orderCents, activation.rateBps + rng.pick([-100, 50, 100, 200, 300]));
    const settled = orderedAt.getTime() + offer.validationDays * DAY <= now.getTime();
    const status: Transaction["networkStatus"] = settled ? (rng.chance(0.86) ? "approved" : "declined") : rng.chance(0.08) ? "declined" : "pending";
    const tx = newTransaction(merchant, orderedAt, orderCents, commissionCents, status, activation);
    const { amount, clamped } = amountFor(offer, orderCents, activation.rateBps, commissionCents);
    if (amount === 0) {
      tx.matchStatus = "ignored";
      tx.ignoreReason = "below_minimum";
      tx.activationId = null;
      continue;
    }
    const user = usersById.get(activation.userId)!;
    if (offer.newCustomersOnly && validatedAtMerchant.has(`${user.id}:${merchant.id}`)) {
      tx.matchStatus = "ignored";
      tx.ignoreReason = "not_new_customer";
      tx.activationId = null;
      continue;
    }
    const validatedAt = status === "approved" ? new Date(Math.min(orderedAt.getTime() + offer.validationDays * DAY, now.getTime() - HOUR)) : null;
    const decidedAt = status === "declined" ? new Date(Math.min(orderedAt.getTime() + rng.int(3, offer.validationDays) * DAY, now.getTime() - HOUR)) : validatedAt;
    let cbStatus: Cashback["status"] = status === "approved" ? "validated" : status === "declined" ? "refused" : "pending";
    let decidedBy: Cashback["decidedBy"] = cbStatus === "pending" ? null : "network";
    let reason: string | null = cbStatus === "refused" ? "declined_by_network" : null;
    let cancelAt: Date | null = null;
    if (cbStatus === "validated" && rng.chance(0.015)) {
      cbStatus = "cancelled";
      decidedBy = "manager";
      reason = "order_returned";
      cancelAt = new Date(Math.min(validatedAt!.getTime() + rng.int(1, 20) * DAY, now.getTime() - HOUR));
    }
    const cb: Cashback = {
      id: id("cb", data.cashbacks.length + 1),
      userId: user.id,
      offerId: offer.id,
      activationId: activation.id,
      networkTransactionId: tx.id,
      orderCents,
      rateBps: activation.rateBps,
      amountCents: amount,
      marginClamped: clamped,
      status: cbStatus,
      decidedBy,
      decisionReason: reason,
      expectedValidationAt: new Date(orderedAt.getTime() + offer.validationDays * DAY),
      validatedAt,
      decidedAt: cancelAt ?? decidedAt,
      createdAt: tx.reportedAt,
    };
    data.cashbacks.push(cb);
    if (cbStatus === "validated") validatedAtMerchant.add(`${user.id}:${merchant.id}`);
    bookCashback(cb, cbStatus === "cancelled" ? rng.pick(managers).id : null);
    if (cbStatus === "cancelled") {
      audit({ actorId: rng.pick(managers).id, action: "cashback.cancel", entityType: "cashback", entityId: cb.id, before: { status: "validated" }, after: { status: "cancelled" }, reason, at: cancelAt! });
    }
  }

  // Unattributed transactions: orders the networks report with no activation behind them.
  for (let i = 0; i < 180; i++) {
    const merchant = rng.pick(data.merchants);
    const orderedAt = between(start, new Date(now.getTime() - DAY));
    const orderCents = rng.int(900, 40000);
    newTransaction(merchant, orderedAt, orderCents, applyRate(orderCents, rng.int(100, 900)), rng.weighted([["pending", 2], ["approved", 3], ["declined", 1]]), null);
  }

  // Claims: members whose activation led to an order the network never reported.
  const orphanActivations = data.activations.filter((a) => !activationsWithOrder.has(a.id) && a.activatedAt < new Date(now.getTime() - 5 * DAY));
  const claimedActivations = new Set<string>();
  const unmatchedPool = data.networkTransactions.filter((t) => t.matchStatus === "unmatched" && t.networkStatus !== "declined");
  for (let i = 0; i < 180 && i < orphanActivations.length; i++) {
    const activation = i < 6 ? orphanActivations.filter((a) => a.userId === marie.id)[i] ?? rng.pick(orphanActivations) : rng.pick(orphanActivations);
    if (claimedActivations.has(activation.id)) continue;
    claimedActivations.add(activation.id);
    const offer = offersById.get(activation.offerId)!;
    const merchant = merchantsById.get(offer.merchantId)!;
    const orderedAt = new Date(activation.activatedAt.getTime() + rng.int(1, 36) * HOUR);
    const orderCents = rng.int(Math.max(1500, offer.minSpendCents), 30000);
    const filedAt = new Date(Math.min(orderedAt.getTime() + rng.int(4, 40) * DAY, now.getTime() - HOUR));
    const status = rng.weighted<InferSelectModel<typeof schema.claims>["status"]>([
      ["filed", 3],
      ["acknowledged", 2],
      ["raised", 2],
      ["credited", 4],
      ["declined", 3],
    ]);
    const assignee = status === "filed" ? null : rng.pick(agents).id;
    const updatedAt = status === "filed" ? filedAt : new Date(Math.min(filedAt.getTime() + rng.int(1, 12) * DAY, now.getTime() - HOUR));
    const orderRef = `ORD-${rng.token(8).toUpperCase()}`;
    const claim: InferSelectModel<typeof schema.claims> = {
      id: id("clm", data.claims.length + 1),
      userId: activation.userId,
      offerId: offer.id,
      orderRef,
      orderedAt,
      orderCents,
      proofText: `Order confirmation ${orderRef}\n${merchant.name}\nDate: ${orderedAt.toISOString().slice(0, 10)}\nTotal paid: ${(orderCents / 100).toFixed(2).replace(".", ",")} €\nCustomer: ${usersById.get(activation.userId)!.displayName}`,
      status,
      assigneeId: assignee,
      networkTransactionId: null,
      cashbackId: null,
      declineReason: status === "declined" ? rng.pick(DECLINE_REASONS) : null,
      filedAt,
      updatedAt,
    };
    if ((status === "raised" || status === "credited") && rng.chance(0.4)) {
      const tx = unmatchedPool.find((t) => t.merchantId === merchant.id && Math.abs(t.orderedAt.getTime() - orderedAt.getTime()) < 10 * DAY && !data.claims.some((c) => c.networkTransactionId === t.id));
      if (tx) claim.networkTransactionId = tx.id;
    }
    if (status === "credited") {
      const { amount } = amountFor(offer, orderCents, activation.rateBps, null);
      const cb: Cashback = {
        id: id("cb", data.cashbacks.length + 1),
        userId: activation.userId,
        offerId: offer.id,
        activationId: activation.id,
        networkTransactionId: null,
        orderCents,
        rateBps: activation.rateBps,
        amountCents: amount,
        marginClamped: false,
        status: "validated",
        decidedBy: "claim",
        decisionReason: "credited_from_claim",
        expectedValidationAt: updatedAt,
        validatedAt: updatedAt,
        decidedAt: updatedAt,
        createdAt: updatedAt,
      };
      data.cashbacks.push(cb);
      bookCashback(cb, assignee);
      claim.cashbackId = cb.id;
    }
    data.claims.push(claim);
    const ladder: Record<ClaimStatus, ClaimStatus[]> = { filed: [], acknowledged: ["acknowledged"], raised: ["acknowledged", "raised"], credited: ["acknowledged", "raised", "credited"], declined: ["acknowledged", "declined"] };
    const steps = ladder[status];
    let prev: string = "filed";
    steps.forEach((step, k) => {
      const at = new Date(filedAt.getTime() + ((updatedAt.getTime() - filedAt.getTime()) * (k + 1)) / steps.length);
      audit({ actorId: assignee, action: `claim.${step}`, entityType: "claim", entityId: claim.id, before: { status: prev }, after: { status: step }, reason: step === "declined" ? claim.declineReason : null, at });
      prev = step;
    });
  }

  // Referral bonuses: once a referee has collected five euros, both sides are paid, then ten percent for a year.
  const validatedByUser = new Map<string, Cashback[]>();
  for (const cb of data.cashbacks) {
    if (cb.status !== "validated" || cb.decidedBy === "claim") continue;
    validatedByUser.set(cb.userId, [...(validatedByUser.get(cb.userId) ?? []), cb]);
  }
  for (const referral of data.referrals) {
    const earned = [...(validatedByUser.get(referral.refereeId) ?? [])].sort((a, b) => a.validatedAt!.getTime() - b.validatedAt!.getTime());
    let running = 0;
    let reachedAt: Date | null = null;
    for (const cb of earned) {
      running += cb.amountCents;
      if (running >= 500) {
        reachedAt = cb.validatedAt!;
        break;
      }
    }
    if (!reachedAt) {
      if (referral.expiresAt && referral.expiresAt < now) referral.status = "expired";
      continue;
    }
    referral.status = "validated";
    referral.validatedAt = reachedAt;
    referral.bonusUntil = new Date(reachedAt.getTime() + 365 * DAY);
    const referrerBonus = referral.createdAt >= new Date("2026-11-10T00:00:00Z") ? 2000 : 1000;
    book({ userId: referral.refereeId, kind: "referral_bonus", bucket: "available", amountCents: 500, refType: "referral", refId: referral.id, note: "Welcome bonus", createdBy: null, createdAt: reachedAt });
    book({ userId: referral.referrerId, kind: "referral_bonus", bucket: "available", amountCents: referrerBonus, refType: "referral", refId: referral.id, note: "Referral bonus", createdBy: null, createdAt: reachedAt });
    for (const cb of earned) {
      if (cb.validatedAt! <= reachedAt || cb.validatedAt! > referral.bonusUntil) continue;
      book({ userId: referral.referrerId, kind: "referral_bonus", bucket: "available", amountCents: applyRate(cb.amountCents, 1000), refType: "referral", refId: referral.id, note: `10 % of ${cb.id}`, createdBy: null, createdAt: cb.validatedAt! });
    }
  }

  // Payouts: members with enough available balance cash out; most are sent, a few are in flight or failed.
  const available = new Map<string, number>();
  const firstAvailableAt = new Map<string, Date>();
  for (const e of data.ledgerEntries) {
    if (e.bucket !== "available") continue;
    available.set(e.userId, (available.get(e.userId) ?? 0) + e.amountCents);
    const first = firstAvailableAt.get(e.userId);
    if (!first || e.createdAt < first) firstAvailableAt.set(e.userId, e.createdAt);
  }
  for (const user of [marie, ...members]) {
    let balance = available.get(user.id) ?? 0;
    const rounds = user.id === marie.id ? 3 : rng.chance(0.55) ? 1 : 0;
    for (let r = 0; r < rounds && balance >= 500; r++) {
      const method = rng.weighted<InferSelectModel<typeof schema.payouts>["method"]>([
        ["transfer", 5],
        ["gift_card", 3],
        ["donation", 1],
      ]);
      const minimum = { transfer: 2000, gift_card: 1500, donation: 500 }[method];
      if (balance < minimum) break;
      let amount = method === "transfer" ? Math.floor(Math.min(balance, rng.int(2000, 8000)) / 500) * 500 : Math.min(balance, rng.int(minimum, 4000));
      if (amount < minimum) amount = minimum;
      const status = rng.weighted<InferSelectModel<typeof schema.payouts>["status"]>([
        ["sent", 7],
        ["requested", 1],
        ["checking", 1],
        ["failed", 1],
      ]);
      const requestedAt = between(new Date(Math.max((firstAvailableAt.get(user.id) ?? start).getTime(), start.getTime())), new Date(now.getTime() - 2 * HOUR));
      const checkedAt = status === "requested" ? null : new Date(Math.min(requestedAt.getTime() + rng.int(1, 48) * HOUR, now.getTime() - HOUR));
      const sentAt = status === "sent" ? new Date(Math.min(checkedAt!.getTime() + rng.int(1, 5) * DAY, now.getTime() - HOUR)) : null;
      const payout: InferSelectModel<typeof schema.payouts> = {
        id: id("pay", data.payouts.length + 1),
        userId: user.id,
        method,
        amountCents: amount,
        destination: method === "transfer" ? `FR76 •••• •••• •••• ${rng.int(1000, 9999)}` : method === "gift_card" ? rng.pick(GIFT_CARD_BRANDS) : rng.pick(CHARITIES),
        status,
        requestedAt,
        checkedAt,
        sentAt,
        failedReason: status === "failed" ? "returned_by_bank" : null,
      };
      data.payouts.push(payout);
      const base = { userId: user.id, refType: "payout", refId: payout.id, createdBy: null, note: null };
      book({ ...base, kind: "payout_reserved", bucket: "available", amountCents: -amount, createdAt: requestedAt });
      book({ ...base, kind: "payout_reserved", bucket: "reserved", amountCents: amount, createdAt: requestedAt });
      if (status === "sent") {
        book({ ...base, kind: "payout_sent", bucket: "reserved", amountCents: -amount, createdAt: sentAt! });
        book({ ...base, kind: "payout_sent", bucket: "paid", amountCents: amount, createdAt: sentAt! });
        audit({ actorId: rng.pick(managers).id, action: "payout.send", entityType: "payout", entityId: payout.id, before: { status: "checking" }, after: { status: "sent" }, reason: null, at: sentAt! });
      }
      if (status === "failed") {
        const failedAt = new Date(Math.min(checkedAt!.getTime() + rng.int(1, 3) * DAY, now.getTime() - HOUR));
        book({ ...base, kind: "payout_failed", bucket: "reserved", amountCents: -amount, createdAt: failedAt });
        book({ ...base, kind: "payout_failed", bucket: "available", amountCents: amount, createdAt: failedAt });
        audit({ actorId: rng.pick(managers).id, action: "payout.fail", entityType: "payout", entityId: payout.id, before: { status: "checking" }, after: { status: "failed" }, reason: "returned_by_bank", at: failedAt });
        continue;
      }
      balance -= amount;
    }
  }

  // Offers published: one audit row each, so the log is not only about money.
  for (const offer of data.offers) {
    if (offer.status === "draft") continue;
    audit({ actorId: rng.pick(managers).id, action: "offer.publish", entityType: "offer", entityId: offer.id, before: { status: "draft" }, after: { status: "live" }, reason: null, at: offer.createdAt });
  }

  // Batch summaries, as the pipeline would have written them.
  for (const batch of data.importBatches) {
    const rows = data.networkTransactions.filter((t) => t.batchId === batch.id);
    batch.rowCount = rows.length;
    batch.newCount = rows.length;
    batch.matchedCount = rows.filter((t) => t.matchStatus === "matched").length;
    batch.unmatchedCount = rows.filter((t) => t.matchStatus !== "matched").length;
  }

  data.ledgerEntries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  data.auditLog.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  return data;
}

const CHUNK = 500;

async function insertAll<T extends { id: string }>(db: Db, table: Parameters<Db["insert"]>[0], rows: T[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    // Rows are keyed by their deterministic id, so loading twice is a no-op rather than a duplicate.
    await db
      .insert(table)
      .values(rows.slice(i, i + CHUNK) as never)
      .onConflictDoNothing();
  }
}

/** Loads the seed in dependency order. Loading twice changes nothing. */
export async function seedDatabase(db: Db, data: SeedData): Promise<void> {
  await insertAll(db, schema.users, data.users);
  await insertAll(db, schema.merchants, data.merchants);
  await insertAll(db, schema.offers, data.offers);
  await insertAll(db, schema.offerBoosts, data.offerBoosts);
  await insertAll(db, schema.activations, data.activations);
  await insertAll(db, schema.importBatches, data.importBatches);
  await insertAll(db, schema.networkTransactions, data.networkTransactions);
  await insertAll(db, schema.cashbacks, data.cashbacks);
  await insertAll(db, schema.claims, data.claims);
  await insertAll(db, schema.ledgerEntries, data.ledgerEntries);
  await insertAll(db, schema.payouts, data.payouts);
  await insertAll(db, schema.referrals, data.referrals);
  await insertAll(db, schema.auditLog, data.auditLog);
}
