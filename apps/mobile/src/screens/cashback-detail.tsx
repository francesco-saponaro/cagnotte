import { StyleSheet, View } from "react-native";
import { useCashback } from "../api/queries";
import type { CashbackDetailRow } from "../api/types";
import { formatDate, formatEuros, formatRate, formatSigned, inDays } from "../ui/format";
import { Card, Failed, Loading, Money, Pill, T } from "../ui/primitives";
import { Screen, SectionTitle, TitleRow } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { KIND_LABEL, STATUS_TONE } from "./wallet";

/*
 * "Where is this money and when does it move?" One cashback: how it was computed from the order
 * and the rate locked on the click, where it stands, and every ledger entry it wrote, as moves
 * between the pot's buckets.
 */

export function CashbackDetailScreen({ id }: { id: string }) {
  const cashback = useCashback(id);

  if (cashback.isPending) {
    return (
      <Screen>
        <TitleRow title="Cashback" back="/wallet" />
        <Card>
          <Loading rows={4} height={24} />
        </Card>
      </Screen>
    );
  }
  if (cashback.isError) {
    return (
      <Screen>
        <TitleRow title="Cashback" back="/wallet" />
        <Card>
          <Failed message={cashback.error.message} onRetry={() => void cashback.refetch()} />
        </Card>
      </Screen>
    );
  }

  const c = cashback.data;
  return (
    <Screen>
      <TitleRow title={`${formatEuros(c.amountCents)} from ${c.offer.merchant.name}`} back="/wallet" line={standing(c)} />
      <Card>
        <View style={styles.head}>
          <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>
          {c.marginClamped ? <Pill tone="warning">held to the shop's commission</Pill> : null}
        </View>
        <T variant="body" style={styles.how}>
          {howComputed(c)}
        </T>
        <View style={styles.facts}>
          <Fact label="Offer" value={c.offer.title} />
          <Fact label="Order" value={`${formatEuros(c.orderCents)} on ${formatDate(c.createdAt)}`} />
          <Fact label="Expected validation" value={c.status === "pending" ? `${formatDate(c.expectedValidationAt)}, ${inDays(c.expectedValidationAt)}` : formatDate(c.expectedValidationAt)} />
          {c.validatedAt ? <Fact label="Validated" value={formatDate(c.validatedAt)} /> : null}
          {c.decidedAt && c.status !== "validated" ? <Fact label="Decided" value={`${formatDate(c.decidedAt)}${c.decidedBy ? ` by the ${c.decidedBy === "network" ? "shop's network" : c.decidedBy}` : ""}`} /> : null}
          {c.decisionReason ? <Fact label="Reason" value={c.decisionReason} /> : null}
        </View>
      </Card>
      <SectionTitle>Moves</SectionTitle>
      <Card pad={false}>
        <View role="list" aria-label="Moves">
          {c.entries.map((entry, i) => (
            <View key={entry.id} role="listitem" style={[styles.move, i === c.entries.length - 1 ? null : styles.rule]}>
              <View style={styles.moveText}>
                <T variant="body">{KIND_LABEL[entry.kind]}</T>
                <T variant="small">{formatDate(entry.createdAt)}</T>
              </View>
              <Money style={entry.amountCents < 0 ? styles.negative : null}>{`${entry.bucket} ${formatSigned(entry.amountCents)}`}</Money>
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}

function standing(c: CashbackDetailRow): string {
  switch (c.status) {
    case "pending":
      return `Reported by the shop, waiting for the return period to end; it validates ${inDays(c.expectedValidationAt)}.`;
    case "validated":
      return "Confirmed by the shop and in your available balance.";
    case "refused":
      return "The shop did not confirm this order, so nothing was paid.";
    case "cancelled":
      return "Taken back after the order was returned or cancelled.";
  }
}

function howComputed(c: CashbackDetailRow): string {
  if (c.offer.rateKind === "fixed") return `${formatEuros(c.amountCents)} fixed on an order of ${formatEuros(c.orderCents)}.`;
  const rate = formatRate({ rateKind: "percent", rateBps: c.rateBps, fixedCents: 0 });
  return `${rate} of ${formatEuros(c.orderCents)}, the rate locked when you activated, makes ${formatEuros(c.amountCents)}.`;
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
  head: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  how: { marginTop: 16 },
  facts: { marginTop: 16 },
  fact: { flexDirection: "row", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.rule },
  factLabel: { width: 160 },
  factValue: { flex: 1 },
  move: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: space.card, paddingVertical: 8 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  moveText: { flex: 1, minWidth: 0, marginRight: 12 },
  negative: { color: colors.muted },
});
