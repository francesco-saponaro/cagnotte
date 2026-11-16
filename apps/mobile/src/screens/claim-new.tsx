import { fileClaimBody } from "@cagnotte/contracts";
import { parseEuros } from "@cagnotte/domain";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useActivations, useFileClaim } from "../api/queries";
import type { ActivationWithOfferRow } from "../api/types";
import { formatDate, formatRate } from "../ui/format";
import { check, errorsFrom, type FieldErrors } from "../ui/form";
import { useNav } from "../ui/nav";
import { Button, Card, Empty, Field, Loading, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, radius, space } from "../ui/tokens";
import { MerchantMark, titleWithoutMerchant } from "./offers";

/*
 * "Something missing?": a purchase that never showed as cashback. A claim stands on an activation
 * the member really made, so the offer is chosen among the ones they activated; the order details
 * are what support will check with the shop's network.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-02" at noon local time, or null; noon keeps the day whatever the zone. */
export function parseDay(text: string): Date | null {
  const m = DAY_RE.exec(text.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) return null;
  return date;
}

/**
 * The order day as the claim sends it: the end of that day, so a click made earlier the same day
 * counts as before the order (the member activated at seven, bought at five past), capped at now
 * so a claim filed today is never dated in the future.
 */
export function orderDayEnd(text: string, now: Date = new Date()): Date | null {
  const day = parseDay(text);
  if (!day) return null;
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
  return end.getTime() > now.getTime() ? now : end;
}

/** One line per offer, the latest activation of each. */
export function offersActivated(activations: ActivationWithOfferRow[]): ActivationWithOfferRow[] {
  const byOffer = new Map<string, ActivationWithOfferRow>();
  for (const a of activations) {
    const seen = byOffer.get(a.offerId);
    if (!seen || seen.activatedAt < a.activatedAt) byOffer.set(a.offerId, a);
  }
  return [...byOffer.values()].sort((a, b) => b.activatedAt.localeCompare(a.activatedAt));
}

export function NewClaimScreen() {
  const nav = useNav();
  const wide = useWide();
  const activations = useActivations();
  const file = useFileClaim();
  const [offerId, setOfferId] = useState<string | null>(null);
  const [orderRef, setOrderRef] = useState("");
  const [orderedAt, setOrderedAt] = useState("");
  const [amount, setAmount] = useState("");
  const [proofText, setProofText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const submit = () => {
    setFormError(null);
    const own: FieldErrors = {};
    if (!offerId) own.offerId = "choose the offer you activated before buying";
    const day = orderDayEnd(orderedAt);
    if (!day) own.orderedAt = "a date like 2026-11-02";
    const cents = parseEuros(amount);
    if (cents === null) own.orderCents = "enter the amount in euros, like 64,50";
    const checked = check(fileClaimBody, {
      offerId: offerId ?? "",
      orderRef,
      orderedAt: day ?? new Date(NaN),
      orderCents: cents ?? -1,
      proofText,
    });
    const merged = { ...checked.errors, ...own };
    setErrors(merged);
    if (!checked.ok || Object.keys(own).length > 0) return;
    file.mutate(
      { ...checked.data, orderedAt: checked.data.orderedAt.toISOString() },
      {
        onSuccess: (claim) => nav.replace(`/claims/${claim.id}`),
        onError: (error) => {
          const { form, fields } = errorsFrom(error, ["offerId", "orderRef", "orderedAt", "orderCents", "proofText"]);
          setErrors(fields);
          setFormError(form);
        },
      },
    );
  };

  const all = activations.data ? offersActivated(activations.data.items) : [];
  const choices = showAll ? all : all.slice(0, RECENT);

  return (
    <Screen>
      <TitleRow title="Something missing?" back="/wallet" line="A purchase you activated that never showed as cashback. Give the order details and support checks it with the shop." />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <Card style={wide ? styles.chooserWide : null}>
          <T variant="section" role="heading" level={2} style={styles.label}>
            The offer you activated
          </T>
          {activations.isPending ? (
            <Loading rows={2} height={24} />
          ) : choices.length === 0 ? (
            <Empty>You have not activated any offer yet, and a claim needs one: the cashback is for the purchase that followed an activation.</Empty>
          ) : (
            <View role="radiogroup" aria-label="The offer you activated" style={styles.choices}>
              {choices.map((a) => {
                const on = a.offerId === offerId;
                return (
                  <Pressable
                    key={a.id}
                    role="radio"
                    aria-checked={on}
                    aria-label={`${a.offer.merchant.name}, ${titleWithoutMerchant(a.offer.title, a.offer.merchant.name)}`}
                    onPress={() => setOfferId(a.offerId)}
                    style={[styles.choice, on ? styles.choiceOn : null]}
                  >
                    <MerchantMark name={a.offer.merchant.name} />
                    <View style={styles.choiceText}>
                      <T variant="body" weight={500} numberOfLines={1}>
                        {a.offer.merchant.name}
                      </T>
                      <T variant="small" numberOfLines={1}>
                        {titleWithoutMerchant(a.offer.title, a.offer.merchant.name)} · activated {formatDate(a.activatedAt)} at {formatRate({ ...a.offer, rateBps: a.rateBps })}
                      </T>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          {all.length > RECENT && !showAll ? <Button label={`Show ${all.length - RECENT} more`} kind="text" onPress={() => setShowAll(true)} style={styles.more} /> : null}
          {errors.offerId ? (
            <T variant="small" style={styles.error}>
              {errors.offerId}
            </T>
          ) : null}
        </Card>
        <Card style={wide ? styles.formWide : null}>
          <T variant="section" role="heading" level={2} style={styles.label}>
            The order
          </T>
          <View style={styles.fields}>
            <Field label="Order reference" value={orderRef} onChangeText={setOrderRef} placeholder="ORD-77213" hint="As written on the shop's confirmation." error={errors.orderRef ?? null} autoCapitalize="characters" />
            <Field
              label="Order date"
              value={orderedAt}
              onChangeText={setOrderedAt}
              placeholder="2026-11-02"
              hint="Year, month, day. Online orders can be claimed for three months."
              error={errors.orderedAt ?? null}
              inputMode="numeric"
            />
            <Field
              label="Order amount"
              value={amount}
              onChangeText={setAmount}
              placeholder="64,50"
              hint="What you paid, delivery excluded."
              error={errors.orderCents ?? null}
              inputMode="decimal"
              right={<T variant="body">€</T>}
            />
            <Field
              label="Order confirmation"
              value={proofText}
              onChangeText={setProofText}
              placeholder="Paste the confirmation email here"
              hint="The text of the confirmation, so support can match the order."
              error={errors.proofText ?? null}
              multiline
              numberOfLines={6}
            />
          </View>
          {formError ? (
            <View role="alert" style={styles.alert}>
              <T variant="body" style={{ color: colors.negative }}>
                {formError}
              </T>
            </View>
          ) : null}
          <Button label="File the claim" onPress={submit} busy={file.isPending} />
        </Card>
      </View>
    </Screen>
  );
}

/** How many activated offers show before "Show more": a claim is nearly always about a recent purchase. */
const RECENT = 8;

const styles = StyleSheet.create({
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  chooserWide: { flex: 1, minWidth: 0 },
  formWide: { width: 440 },
  label: { marginBottom: 12 },
  more: { alignSelf: "flex-start", marginTop: 8 },
  choices: { gap: 6 },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.control,
    backgroundColor: colors.raised,
  },
  choiceOn: {
    backgroundColor: colors.active,
    borderWidth: 1,
    borderColor: colors.text,
  },
  choiceText: { flex: 1, minWidth: 0, marginLeft: 12 },
  error: { color: colors.negative, marginTop: 6 },
  fields: {},
  alert: { marginBottom: 12 },
});
