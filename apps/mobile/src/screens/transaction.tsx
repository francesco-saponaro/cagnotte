import { decisionBody, ignoreTransactionBody } from "@cagnotte/contracts";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useDecideCashback, useMoveTransaction } from "../api/ops-queries";
import type { CashbackRow, ProposalRow, TransactionDetailRow } from "../api/types";
import { formatDate, formatEuros, formatRate } from "../ui/format";
import { check, errorsFrom, type FieldErrors } from "../ui/form";
import { Button, Card, CardTitle, Failed, Field, Loading, Money, Pill, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { useTransaction } from "../api/ops-queries";
import { STATUS_TONE } from "./wallet";
import { MATCH_TONE, NETWORK_STATUS_TONE } from "./transactions";

/*
 * One reported sale: what the network said, which click it belongs to or why none was found,
 * the cashback it booked and the manager's two hand tools. Matching by hand offers only the
 * clicks the rules allow; a decision on the cashback goes through the same booking step as the
 * network's word, with a reason that lands in the audit log.
 */

export const NO_MATCH_WORDS: Record<NonNullable<TransactionDetailRow["noMatchReason"]>, string> = {
  no_sub_id: "the network reported no click reference, so the sale names nobody",
  unknown_sub_id: "the click reference names no activation we issued",
  other_merchant: "the click reference names a click at another shop",
  after_order: "the click happened after the order",
  outside_window: "the click is older than the shop's attribution window",
  click_already_used: "that click already earned a cashback; a member activates before each purchase",
};

const NETWORK_WORDS: Record<TransactionDetailRow["networkStatus"], string> = {
  pending: "the shop has not confirmed the order yet",
  approved: "the shop confirmed the order",
  declined: "the shop declined the order",
};

export function standing(t: TransactionDetailRow): string {
  if (t.matchStatus === "matched") return `Matched to ${t.activation?.member.displayName ?? "a member"}'s click; ${NETWORK_WORDS[t.networkStatus]}.`;
  const why = t.noMatchReason ? NO_MATCH_WORDS[t.noMatchReason] : null;
  if (t.matchStatus === "ignored") return `Set aside: ${t.ignoreReason ?? "no reason recorded"}.${why ? ` The automatic match did not happen because ${why}.` : ""}`;
  return why ? `No member yet: ${why}.` : "No member yet.";
}

export function howComputed(c: CashbackRow): string {
  if (c.offer.rateKind === "fixed") return `${formatEuros(c.amountCents)} fixed on an order of ${formatEuros(c.orderCents)}.`;
  const rate = formatRate({ rateKind: "percent", rateBps: c.rateBps, fixedCents: 0 });
  return `${rate} of ${formatEuros(c.orderCents)}, the rate locked on the click, makes ${formatEuros(c.amountCents)}${c.marginClamped ? ", held to the shop's commission" : ""}.`;
}

export function TransactionScreen({ id }: { id: string }) {
  const wide = useWide();
  const transaction = useTransaction(id);
  const move = useMoveTransaction(id);
  const [moveError, setMoveError] = useState<string | null>(null);

  if (transaction.isPending) {
    return (
      <Screen>
        <TitleRow title="Transaction" back="/transactions" />
        <Card>
          <Loading rows={4} height={24} />
        </Card>
      </Screen>
    );
  }
  if (transaction.isError) {
    return (
      <Screen>
        <TitleRow title="Transaction" back="/transactions" />
        <Card>
          <Failed message={transaction.error.message} onRetry={() => void transaction.refetch()} />
        </Card>
      </Screen>
    );
  }

  const t = transaction.data;
  const matchTo = (candidate: ProposalRow) => {
    setMoveError(null);
    move.mutate({ kind: "match", activationId: candidate.id }, { onError: (error) => setMoveError(errorsFrom(error, []).form) });
  };

  return (
    <Screen>
      <TitleRow title={`${t.orderRef} at ${t.merchant.name}`} back="/transactions" line={standing(t)} />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <View style={wide ? styles.mainWide : null}>
          <Card>
            <View style={styles.head}>
              <Pill tone={MATCH_TONE[t.matchStatus]}>{t.matchStatus}</Pill>
              <Pill tone={NETWORK_STATUS_TONE[t.networkStatus]}>{t.networkStatus}</Pill>
            </View>
            <View style={styles.facts}>
              <Fact label="Network" value={`${t.network}, reference ${t.networkRef}`} />
              <Fact label="Shop" value={`${t.merchant.name} (${t.merchant.advertiserRef}), ${t.merchant.attributionDays}-day attribution window`} />
              <Fact label="Order" value={`${t.orderRef}, ${formatEuros(t.orderCents)} on ${formatDate(t.orderedAt)}`} />
              <Fact label="Commission" value={formatEuros(t.commissionCents)} />
              <Fact label="Click reference" value={t.subId ?? "none reported"} />
              <Fact label="Reported" value={formatDate(t.reportedAt)} />
            </View>
          </Card>

          {t.activation ? (
            <Card style={styles.block}>
              <T variant="section" role="heading" level={2}>
                The click
              </T>
              <View style={styles.facts}>
                <Fact label="Member" value={t.activation.member.displayName} />
                <Fact label="Offer" value={t.activation.offer.title} />
                <Fact label="Activated" value={`${formatDate(t.activation.activatedAt)} at ${formatRate({ rateKind: "percent", rateBps: t.activation.rateBps, fixedCents: 0 })}${t.activation.boosted ? ", boosted" : ""}`} />
              </View>
            </Card>
          ) : null}

          {t.cashback ? <CashbackBlock cashback={{ ...t.cashback, offer: t.activation?.offer ?? { ...t.cashback, merchant: t.merchant } } as CashbackRow} /> : null}
        </View>

        {t.matchStatus !== "matched" ? (
          <View style={wide ? styles.sideWide : null}>
            <Card pad={false}>
              <CardTitle>Clicks that qualify</CardTitle>
              {t.candidates.length === 0 ? (
                <View style={styles.padText}>
                  <T variant="body" muted>
                    No click at this shop inside the attribution window before the order. The member can still file a claim with the order details.
                  </T>
                </View>
              ) : (
                <View role="list" aria-label="Clicks that qualify">
                  {t.candidates.map((c, i) => (
                    <View key={c.id} role="listitem" style={[styles.candidate, i === t.candidates.length - 1 ? null : styles.rule]}>
                      <View style={styles.candidateText}>
                        <T variant="body" weight={500} numberOfLines={1}>
                          {c.member.displayName}
                        </T>
                        <T variant="small" numberOfLines={2}>
                          {c.offer.title} · {formatDate(c.activatedAt)} at {formatRate({ rateKind: "percent", rateBps: c.rateBps, fixedCents: 0 })}
                          {c.boosted ? ", boosted" : ""}
                        </T>
                      </View>
                      <Button label={`Match to ${c.member.displayName}'s click`} kind="secondary" onPress={() => matchTo(c)} busy={move.isPending && move.variables?.kind === "match" && move.variables.activationId === c.id} />
                    </View>
                  ))}
                </View>
              )}
              {moveError ? (
                <View role="alert" style={styles.alertPad}>
                  <T variant="body" style={{ color: colors.negative }}>
                    {moveError}
                  </T>
                </View>
              ) : null}
            </Card>
            {t.matchStatus === "unmatched" ? <IgnoreForm onIgnore={(reason, onError) => move.mutate({ kind: "ignore", reason }, { onError })} busy={move.isPending && move.variables?.kind === "ignore"} /> : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function IgnoreForm({ onIgnore, busy }: { onIgnore: (reason: string, onError: (error: unknown) => void) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const submit = () => {
    setFormError(null);
    const checked = check(ignoreTransactionBody, { reason });
    setErrors(checked.errors);
    if (!checked.ok) return;
    onIgnore(checked.data.reason, (error) => {
      const { form, fields } = errorsFrom(error, ["reason"]);
      setErrors(fields);
      setFormError(form);
    });
  };
  return (
    <Card style={styles.block}>
      <T variant="section" role="heading" level={2}>
        Set it aside
      </T>
      <T variant="small" style={styles.blockLine}>
        For a sale that should not pay: a test order, a shop's own purchase, a duplicate the network reports under two references. A claim can still take it up later.
      </T>
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder="test order by the shop" error={errors["reason"]} />
      {formError ? (
        <View role="alert" style={styles.alert}>
          <T variant="body" style={{ color: colors.negative }}>
            {formError}
          </T>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button label="Ignore this sale" kind="secondary" onPress={submit} busy={busy} />
      </View>
    </Card>
  );
}

/** The cashback the sale booked, with the manager's decisions on it: validate or refuse while pending, cancel once validated. */
function CashbackBlock({ cashback: c }: { cashback: CashbackRow }) {
  const decide = useDecideCashback(c.id);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const kinds: ("validate" | "refuse" | "cancel")[] = c.status === "pending" ? ["validate", "refuse"] : c.status === "validated" ? ["cancel"] : [];
  const LABEL = { validate: "Validate", refuse: "Refuse", cancel: "Cancel the cashback" } as const;

  const submit = (kind: "validate" | "refuse" | "cancel") => {
    setFormError(null);
    const checked = check(decisionBody, { reason });
    setErrors(checked.errors);
    if (!checked.ok) return;
    decide.mutate(
      { kind, reason: checked.data.reason },
      {
        onSuccess: () => setReason(""),
        onError: (error) => {
          const { form, fields } = errorsFrom(error, ["reason"]);
          setErrors(fields);
          setFormError(form);
        },
      },
    );
  };

  return (
    <Card style={styles.block}>
      <View style={styles.cashbackHead}>
        <T variant="section" role="heading" level={2}>
          The cashback
        </T>
        <Money variant="section">{formatEuros(c.amountCents)}</Money>
      </View>
      <View style={styles.head}>
        <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>
        {c.decidedBy && c.decidedBy !== "network" ? <Pill tone="neutral">decided by a {c.decidedBy === "claim" ? "claim" : "manager"}</Pill> : null}
      </View>
      <T variant="body" style={styles.how}>
        {howComputed(c)}
      </T>
      <View style={styles.facts}>
        <Fact label="Expected validation" value={formatDate(c.expectedValidationAt)} />
        {c.validatedAt ? <Fact label="Validated" value={formatDate(c.validatedAt)} /> : null}
        {c.decisionReason ? <Fact label="Reason" value={c.decisionReason} /> : null}
      </View>
      {kinds.length > 0 ? (
        <View style={styles.decision}>
          <T variant="small" style={styles.blockLine}>
            {c.status === "pending" ? "A decision here is final: a later file from the network leaves it alone. It pays the referral bonus like the network's approval would." : "Taking it back books the amount out of the member's available balance, while it is still there."}
          </T>
          <Field label="Decision reason" value={reason} onChangeText={setReason} placeholder="shop confirmed by email" error={errors["reason"]} />
          {formError ? (
            <View role="alert" style={styles.alert}>
              <T variant="body" style={{ color: colors.negative }}>
                {formError}
              </T>
            </View>
          ) : null}
          <View style={styles.actions}>
            {kinds.map((kind) => (
              <Button key={kind} label={LABEL[kind]} kind={kind === "validate" ? "primary" : "secondary"} onPress={() => submit(kind)} busy={decide.isPending && decide.variables?.kind === kind} />
            ))}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <T variant="body" muted style={styles.factLabel}>
        {label}
      </T>
      <T variant="body" style={styles.factValue}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  mainWide: { flex: 1, minWidth: 0 },
  sideWide: { width: 400 },
  block: { marginTop: space.pad },
  blockLine: { marginTop: 6, marginBottom: 16 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cashbackHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  how: { marginTop: 12 },
  facts: { marginTop: 12 },
  fact: { flexDirection: "row", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.rule },
  factLabel: { width: 150 },
  factValue: { flex: 1 },
  decision: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.rule },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  alert: { marginBottom: 12 },
  alertPad: { paddingHorizontal: space.card, paddingBottom: space.card },
  pad: { padding: space.card },
  padText: { paddingHorizontal: space.card, paddingBottom: space.card },
  candidate: { paddingHorizontal: space.card, paddingVertical: 14, gap: 10 },
  candidateText: { minWidth: 0 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
});
