import { requestPayoutBody } from "@cagnotte/contracts";
import { PAYOUT_MINIMUM_CENTS, TRANSFER_STEP_CENTS, parseEuros, type PayoutMethod } from "@cagnotte/domain";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { usePayouts, useRequestPayout, useWallet } from "../api/queries";
import type { PayoutRow } from "../api/types";
import { formatDate, formatEuros } from "../ui/format";
import { check, errorsFrom, type FieldErrors } from "../ui/form";
import { Button, Card, CardTitle, Empty, Field, Loading, Money, Pill, Segmented, T, type PillTone } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";

/*
 * "Use my pot": a transfer, a gift card or a donation out of the available balance. The form reads
 * the amount the French way, refuses what the API's schema would refuse, and lets the API's own
 * rules (the minimum, the step, the balance) come back in its words. A bank account never travels
 * whole: the IBAN is masked before it is sent.
 */

const METHODS: { value: PayoutMethod; label: string }[] = [
  { value: "transfer", label: "Transfer" },
  { value: "gift_card", label: "Gift card" },
  { value: "donation", label: "Donation" },
];

const DESTINATION: Record<PayoutMethod, { label: string; hint: string; placeholder: string }> = {
  transfer: { label: "IBAN", hint: "Only the first and last four characters are kept.", placeholder: "FR76 …" },
  gift_card: { label: "Brand", hint: "The shop whose gift card you want.", placeholder: "Maison Vernet" },
  donation: { label: "Charity", hint: "The charity to give it to.", placeholder: "Restos du Cœur" },
};

const VERB: Record<PayoutMethod, string> = { transfer: "Request the transfer", gift_card: "Request the gift card", donation: "Give it" };

export const PAYOUT_TONE: Record<PayoutRow["status"], PillTone> = { requested: "neutral", checking: "neutral", sent: "positive", failed: "negative" };

export function minimumLine(method: PayoutMethod): string {
  const minimum = formatEuros(PAYOUT_MINIMUM_CENTS[method]);
  return method === "transfer" ? `at least ${minimum}, in steps of ${formatEuros(TRANSFER_STEP_CENTS)}` : `at least ${minimum}`;
}

/** "FR76 3000 6000 0112 3456 7890 189" → "FR76 •••• 0189": enough to recognise, never enough to use. */
export function maskIban(iban: string): string {
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  if (compact.length <= 8) return compact;
  return `${compact.slice(0, 4)} •••• ${compact.slice(-4)}`;
}

export function PayoutScreen() {
  const wide = useWide();
  const wallet = useWallet();
  const payouts = usePayouts();
  const request = useRequestPayout();
  const [method, setMethod] = useState<PayoutMethod>("transfer");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<PayoutRow | null>(null);

  const submit = () => {
    setFormError(null);
    const cents = parseEuros(amount);
    if (cents === null) {
      setErrors({ amountCents: "enter an amount in euros, like 20 or 24,50" });
      return;
    }
    const checked = check(requestPayoutBody, { method, amountCents: cents, destination: method === "transfer" ? maskIban(destination) : destination.trim() });
    setErrors(checked.errors);
    if (!checked.ok) return;
    request.mutate(checked.data, {
      onSuccess: (payout) => {
        setDone(payout);
        setAmount("");
        setDestination("");
      },
      onError: (error) => {
        const { form, fields } = errorsFrom(error, ["method", "amountCents", "destination"]);
        setErrors(fields);
        setFormError(form);
      },
    });
  };

  const available = wallet.data?.balances.available;

  return (
    <Screen>
      <TitleRow title="Use my pot" back="/wallet" line={available === undefined ? "Pay your available balance out." : `${formatEuros(available)} available to pay out; what is pending stays in the pot until the shops confirm it.`} />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <Card style={wide ? styles.formWide : null}>
          {done ? (
            <View>
              <T variant="section" role="heading" level={2}>
                Requested
              </T>
              <T variant="body" style={styles.doneText}>
                {formatEuros(done.amountCents)} is reserved for your {METHODS.find((m) => m.value === done.method)?.label.toLowerCase()} to {done.destination}. It leaves the pot once it is sent, usually within three working days; if it comes back, the amount returns to your available balance.
              </T>
              <Button label="Request another" kind="secondary" onPress={() => setDone(null)} style={styles.again} />
            </View>
          ) : (
            <View>
              <T variant="body" weight={500} style={styles.fieldLabel}>
                Method
              </T>
              <Segmented
                label="Method"
                options={METHODS}
                value={method}
                onChange={(m) => {
                  setMethod(m);
                  setErrors({});
                  setFormError(null);
                }}
              />
              <T variant="small" style={styles.minimum}>
                {minimumLine(method)}
              </T>
              <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" inputMode="decimal" placeholder="20" error={errors.amountCents ?? null} right={<T variant="body">€</T>} />
              <Field label={DESTINATION[method].label} value={destination} onChangeText={setDestination} placeholder={DESTINATION[method].placeholder} hint={DESTINATION[method].hint} error={errors.destination ?? null} autoCapitalize={method === "transfer" ? "characters" : "words"} />
              {formError ? (
                <View role="alert" style={styles.alert}>
                  <T variant="body" style={{ color: colors.negative }}>
                    {formError}
                  </T>
                </View>
              ) : null}
              <Button label={VERB[method]} onPress={submit} busy={request.isPending} disabled={available === 0} />
            </View>
          )}
        </Card>
        <View style={wide ? styles.sideWide : null}>
          <Card pad={false}>
            <CardTitle right={payouts.data && payouts.data.total > 5 ? <T variant="small">{`latest 5 of ${payouts.data.total}`}</T> : undefined}>Earlier payouts</CardTitle>
            {payouts.isPending ? (
              <View style={styles.pad}>
                <Loading rows={3} />
              </View>
            ) : payouts.isError || payouts.data.items.length === 0 ? (
              <View style={styles.pad}>
                <Empty>No payout yet.</Empty>
              </View>
            ) : (
              payouts.data.items.slice(0, 5).map((p, i, all) => (
                <View key={p.id} style={[styles.payout, i === all.length - 1 ? null : styles.rule]}>
                  <View style={styles.payoutText}>
                    <T variant="body" numberOfLines={1}>
                      {p.destination}
                    </T>
                    <T variant="small">
                      {METHODS.find((m) => m.value === p.method)?.label} · {formatDate(p.requestedAt)}
                      {p.failedReason ? ` · ${p.failedReason.replace(/_/g, " ")}` : ""}
                    </T>
                  </View>
                  <View style={styles.payoutRight}>
                    <Money>{formatEuros(p.amountCents)}</Money>
                    <Pill tone={PAYOUT_TONE[p.status]}>{p.status}</Pill>
                  </View>
                </View>
              ))
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  formWide: { flex: 1 },
  sideWide: { width: 360 },
  fieldLabel: { marginBottom: 8 },
  minimum: { marginTop: 8, marginBottom: 16 },
  alert: { marginBottom: 12 },
  doneText: { marginTop: 8 },
  again: { marginTop: 16, alignSelf: "flex-start" },
  pad: { padding: space.card },
  payout: { flexDirection: "row", alignItems: "center", minHeight: 60, paddingHorizontal: space.card, paddingVertical: 10 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  payoutText: { flex: 1, minWidth: 0, marginRight: 12 },
  payoutRight: { alignItems: "flex-end", gap: 4 },
});
