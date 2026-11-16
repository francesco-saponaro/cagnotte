import { CLAIM_DECLINE_REASONS, hasRole, type ClaimDeclineReason, type ClaimStatus } from "@cagnotte/domain";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isApiError } from "../api/client";
import { useClaimCase, useMemberCashbacks, useMemberWallet, useMoveClaim, useTransactions, type ClaimMove } from "../api/ops-queries";
import type { ClaimRow } from "../api/types";
import { useSession } from "../app-context";
import { formatDate, formatEuros, inDays } from "../ui/format";
import { Button, Card, CardTitle, Failed, Loading, Money, Pill, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, font, radius, size, space } from "../ui/tokens";
import { DECLINE_WORDS } from "./claim-detail";
import { CLAIM_TONE } from "./claims";
import { titleWithoutMerchant } from "./offers";
import { NEXT_STEP } from "./support-queue";

/*
 * One claim as support works it: the order the member says they placed, the proof they pasted,
 * the pot and the cashbacks the member already has at that shop, and the unmatched sales the
 * network reported with the same order reference. The actions are the claim's state machine:
 * filed → take, acknowledge, decline; acknowledged → raise (linking a sale when one fits),
 * decline; raised → credit, decline. Credited and declined offer nothing more.
 */

/** The agent's choices at each step; the API's transition table has the same lines. */
export function movesFor(status: ClaimStatus, assigned: boolean): ("take" | "acknowledge" | "raise" | "credit" | "decline")[] {
  switch (status) {
    case "filed":
      return assigned ? ["acknowledge", "decline"] : ["take", "acknowledge", "decline"];
    case "acknowledged":
      return ["raise", "decline"];
    case "raised":
      return ["credit", "decline"];
    case "credited":
    case "declined":
      return [];
  }
}

export function ClaimCaseScreen({ id }: { id: string }) {
  const wide = useWide();
  const session = useSession();
  const claim = useClaimCase(id);
  const userId = claim.data?.userId ?? "";
  const wallet = useMemberWallet(userId);
  const cashbacks = useMemberCashbacks(userId);
  // The transactions queue is the manager's; an agent raises without a link and the manager can match by hand later.
  const manager = session.user ? hasRole({ id: session.user.id, role: session.user.role }, "manager") : false;
  const sales = useTransactions({ match: "unmatched", merchant: claim.data?.offer.merchantId, pageSize: 50 }, manager && Boolean(claim.data));
  const move = useMoveClaim(id, userId);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<ClaimDeclineReason | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (claim.isPending) {
    return (
      <Screen>
        <TitleRow title="Claim" back="/support" />
        <Card>
          <Loading rows={5} height={24} />
        </Card>
      </Screen>
    );
  }
  if (claim.isError) {
    return (
      <Screen>
        <TitleRow title="Claim" back="/support" />
        <Card>
          <Failed message={claim.error.message} onRetry={() => void claim.refetch()} />
        </Card>
      </Screen>
    );
  }

  const c = claim.data;
  const me = session.user?.id ?? "";
  const linked = sales.data?.items.find((s) => s.orderRef === c.orderRef) ?? null;
  const moves = movesFor(c.status, Boolean(c.assigneeId));
  const run = (m: ClaimMove) => {
    setProblem(null);
    move.mutate(m, {
      onSuccess: () => {
        setDeclining(false);
        setReason(null);
      },
      onError: (error) => setProblem(isApiError(error) ? error.message : "something went wrong"),
    });
  };
  const standing = c.status === "declined" && c.declineReason ? `Declined: ${DECLINE_WORDS[c.declineReason as ClaimDeclineReason] ?? c.declineReason}.` : c.status === "credited" ? "Credited: the cashback is in the member's available balance." : `This claim is ${NEXT_STEP[c.status]}${c.assigneeId ? (c.assigneeId === me ? ", by you" : "") : c.status === "filed" ? "; nobody has taken it" : ""}.`;
  const atThisShop = cashbacks.data?.items.filter((cb) => cb.offer.merchantId === c.offer.merchantId) ?? [];

  return (
    <Screen>
      <TitleRow title={`Claim ${c.orderRef}`} back="/support" line={`${c.member.displayName} · ${c.offer.merchant.name} · ${titleWithoutMerchant(c.offer.title, c.offer.merchant.name)}`} />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <View style={[styles.main, wide ? styles.mainWide : null]}>
          <Card>
            <View style={styles.head}>
              <Pill tone={CLAIM_TONE[c.status]}>{c.status}</Pill>
              <T variant="body" style={styles.standing}>
                {standing}
              </T>
            </View>
            <View style={styles.facts}>
              <Fact label="Order" value={`${c.orderRef}, ${formatEuros(c.orderCents)} on ${formatDate(c.orderedAt)}`} />
              <Fact label="Filed" value={`${formatDate(c.filedAt)} (${inDays(c.filedAt)})`} />
              <Fact label="Last change" value={formatDate(c.updatedAt)} />
              <Fact label="Network sale" value={c.networkTransactionId ? `linked, ${c.networkTransactionId}` : linked ? `${linked.network} reported ${linked.networkRef} for ${formatEuros(linked.orderCents)} with the same reference; nobody is matched to it` : manager ? "none reported with this reference" : "a manager can look for one in the transactions queue"} />
            </View>
            {moves.length > 0 ? (
              <View style={styles.actions}>
                {moves.includes("take") ? <Button label="Take it" kind="secondary" busy={move.isPending} onPress={() => run({ kind: "assign", assigneeId: me })} /> : null}
                {moves.includes("acknowledge") ? <Button label="Acknowledge" busy={move.isPending} onPress={() => run({ kind: "acknowledge" })} /> : null}
                {moves.includes("raise") ? <Button label="Raise with the network" busy={move.isPending} onPress={() => run(linked ? { kind: "raise", networkTransactionId: linked.id } : { kind: "raise" })} /> : null}
                {moves.includes("credit") ? <Button label="Credit the cashback" busy={move.isPending} onPress={() => run({ kind: "credit" })} /> : null}
                {moves.includes("decline") ? <Button label="Decline" kind="text" disabled={move.isPending} onPress={() => setDeclining((d) => !d)} /> : null}
              </View>
            ) : null}
            {declining && moves.includes("decline") ? (
              <View style={styles.decline}>
                <T variant="body" weight={500}>
                  Why the claim is declined
                </T>
                <View role="radiogroup" aria-label="Reason" style={styles.reasons}>
                  {CLAIM_DECLINE_REASONS.map((r) => {
                    const on = reason === r;
                    return (
                      <Pressable key={r} role="radio" aria-checked={on} aria-label={DECLINE_WORDS[r]} onPress={() => setReason(r)} style={[styles.reason, on ? styles.reasonOn : null]}>
                        <Text style={[styles.reasonText, font(on ? 500 : 400)]}>{DECLINE_WORDS[r]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Button label="Decline the claim" kind="secondary" disabled={!reason} busy={move.isPending} onPress={() => reason && run({ kind: "decline", reason })} style={styles.declineButton} />
              </View>
            ) : null}
            {problem ? (
              <View role="alert" style={styles.alert}>
                <T variant="body" style={{ color: colors.negative }}>
                  {problem}
                </T>
              </View>
            ) : null}
          </Card>
          <Card pad={false} style={styles.proofCard}>
            <CardTitle>What the member sent</CardTitle>
            <T variant="body" style={styles.proof}>
              {c.proofText}
            </T>
          </Card>
        </View>
        <View style={[styles.side, wide ? styles.sideWide : null]}>
          <Card pad={false}>
            <CardTitle>{c.member.displayName}'s pot</CardTitle>
            {wallet.isPending ? (
              <View style={styles.pad}>
                <Loading rows={2} height={20} />
              </View>
            ) : wallet.isError ? (
              <View style={styles.pad}>
                <Failed message={wallet.error.message} onRetry={() => void wallet.refetch()} />
              </View>
            ) : (
              <View style={styles.pad}>
                <View style={styles.bucket}>
                  <T variant="body" muted>
                    available
                  </T>
                  <Money variant="section" color={colors.hue}>
                    {formatEuros(wallet.data.balances.available)}
                  </Money>
                </View>
                <View style={styles.bucket}>
                  <T variant="body" muted>
                    pending
                  </T>
                  <Money>{formatEuros(wallet.data.balances.pending)}</Money>
                </View>
                <View style={styles.bucket}>
                  <T variant="body" muted>
                    paid out
                  </T>
                  <Money>{formatEuros(wallet.data.balances.paid)}</Money>
                </View>
              </View>
            )}
          </Card>
          <Card pad={false} style={styles.sideCard}>
            <CardTitle>At {c.offer.merchant.name}</CardTitle>
            {cashbacks.isPending ? (
              <View style={styles.pad}>
                <Loading rows={2} height={20} />
              </View>
            ) : atThisShop.length === 0 ? (
              <View style={styles.pad}>
                <T variant="body" muted>
                  No cashback at this shop yet, so this order would be the member's first there.
                </T>
              </View>
            ) : (
              atThisShop.slice(0, 5).map((cb, i) => (
                <View key={cb.id} style={[styles.cashback, i === 0 ? null : styles.cashbackRule]}>
                  <View style={styles.cashbackText}>
                    <T variant="body" numberOfLines={1}>
                      order of {formatEuros(cb.orderCents)}
                    </T>
                    <T variant="small" numberOfLines={1}>
                      {formatDate(cb.createdAt)}
                    </T>
                  </View>
                  <Money>{formatEuros(cb.amountCents)}</Money>
                  <Pill tone={cb.status === "validated" ? "positive" : cb.status === "pending" ? "neutral" : "negative"}>{cb.status}</Pill>
                </View>
              ))
            )}
          </Card>
        </View>
      </View>
    </Screen>
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

export type ClaimCase = ClaimRow;

const styles = StyleSheet.create({
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  main: { gap: space.pad },
  mainWide: { flex: 1, minWidth: 0 },
  side: { gap: space.pad },
  sideWide: { width: 360 },
  sideCard: {},
  proofCard: {},
  proof: { paddingHorizontal: space.card, paddingBottom: space.card },
  head: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  standing: { flex: 1, minWidth: 200 },
  facts: { marginTop: 16 },
  fact: { flexDirection: "row", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.rule },
  factLabel: { width: 128 },
  factValue: { flex: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  decline: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.rule },
  reasons: { marginTop: 10, gap: 6 },
  reason: { minHeight: space.control, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.control, backgroundColor: colors.raised, justifyContent: "center" },
  reasonOn: { backgroundColor: colors.active, borderWidth: 1, borderColor: colors.control },
  reasonText: { fontSize: size.body, lineHeight: 20, color: colors.text },
  declineButton: { alignSelf: "flex-start", marginTop: 12 },
  alert: { marginTop: 12 },
  pad: { paddingHorizontal: space.card, paddingBottom: space.card },
  bucket: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  cashback: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.card, paddingVertical: 10 },
  cashbackRule: { borderTopWidth: 1, borderTopColor: colors.rule },
  cashbackText: { flex: 1, minWidth: 0 },
});
