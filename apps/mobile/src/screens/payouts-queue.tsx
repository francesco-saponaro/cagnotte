import { failPayoutBody } from "@cagnotte/contracts";
import type { PayoutMethod, PayoutStatus } from "@cagnotte/domain";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMovePayout, usePayoutsQueue } from "../api/ops-queries";
import type { PayoutWithMemberRow } from "../api/types";
import { check, errorsFrom } from "../ui/form";
import { formatDate, formatEuros, inDays } from "../ui/format";
import { Button, Card, Empty, Failed, Field, Loading, Money, Pager, Pill, Segmented, T, type PillTone } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";

/*
 * "What money is waiting to leave?" The payouts the members requested, filtered on the server by
 * status, requested first. Each row carries the one move its state allows: Check a requested
 * payout, Send one being checked, or Fail either with a reason the member will read. Sent and
 * failed are final.
 */

const STATUS_FILTERS = [
  { value: "requested", label: "Requested" },
  { value: "checking", label: "Checking" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "all", label: "All" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

export const PAYOUT_TONE: Record<PayoutStatus, PillTone> = { requested: "warning", checking: "neutral", sent: "positive", failed: "negative" };
export const METHOD_LABEL: Record<PayoutMethod, string> = { transfer: "transfer", gift_card: "gift card", donation: "donation" };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The queue's total and the money on the page, for the line under the title. */
export function queueLine(status: StatusFilter, total: number | undefined, cents: number): string {
  if (total === undefined) return "The money members asked to take out, from request to the bank.";
  if (total === 0) return status === "requested" ? "Nothing requested; every payout has been checked." : status === "all" ? "No payout yet." : `No payout ${status}.`;
  const head = status === "all" ? `${plural(total, "payout")} in all` : `${plural(total, "payout")} ${status}`;
  return `${head}; ${formatEuros(cents)} on this page.`;
}

export function PayoutsQueueScreen() {
  const [status, setStatus] = useState<StatusFilter>("requested");
  const [page, setPage] = useState(1);
  const payouts = usePayoutsQueue(status === "all" ? undefined : status, page);
  const cents = payouts.data?.items.reduce((sum, p) => sum + p.amountCents, 0) ?? 0;
  return (
    <Screen>
      <TitleRow title="Payouts" line={queueLine(status, payouts.data?.total, cents)} />
      <Segmented
        options={STATUS_FILTERS}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        label="Status"
        scroll
      />
      <Card pad={false} style={styles.list}>
        {payouts.isPending ? (
          <View style={styles.pad}>
            <Loading rows={4} height={24} />
          </View>
        ) : payouts.isError ? (
          <View style={styles.pad}>
            <Failed message={payouts.error.message} onRetry={() => void payouts.refetch()} />
          </View>
        ) : payouts.data.items.length === 0 ? (
          <View style={styles.pad}>
            <Empty>No payout here. A member requests one from their wallet once their available balance covers the method's minimum.</Empty>
          </View>
        ) : (
          payouts.data.items.map((p, i) => <PayoutLine key={p.id} payout={p} last={i === payouts.data.items.length - 1} />)
        )}
      </Card>
      {payouts.data ? <Pager page={payouts.data.page} pageSize={payouts.data.pageSize} total={payouts.data.total} count={payouts.data.items.length} onPage={setPage} /> : null}
    </Screen>
  );
}

function PayoutLine({ payout, last }: { payout: PayoutWithMemberRow; last: boolean }) {
  const wide = useWide();
  const move = useMovePayout();
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = (m: Parameters<typeof move.mutate>[0]["move"]) => {
    setProblem(null);
    move.mutate(
      { id: payout.id, move: m },
      {
        onSuccess: () => {
          setFailing(false);
          setReason("");
        },
        onError: (error) => {
          const { form, fields } = errorsFrom(error, ["reason"]);
          setReasonError(fields["reason"] ?? null);
          setProblem(form);
        },
      },
    );
  };
  const fail = () => {
    const checked = check(failPayoutBody, { reason });
    setReasonError(checked.errors["reason"] ?? null);
    if (!checked.ok) return;
    run({ kind: "fail", reason: checked.data.reason });
  };
  const open = payout.status === "requested" || payout.status === "checking";
  const when = payout.status === "sent" && payout.sentAt ? `sent ${formatDate(payout.sentAt)}` : payout.status === "failed" ? `failed: ${payout.failedReason ?? "no reason given"}` : `requested ${inDays(payout.requestedAt)}`;

  return (
    <View style={[styles.line, last ? null : styles.rule]}>
      <View style={styles.lineInner}>
        <View style={styles.lineText}>
          <T variant="body" weight={500} numberOfLines={1}>
            {payout.member.displayName}
          </T>
          <T variant="small" numberOfLines={1}>
            {METHOD_LABEL[payout.method]} to {payout.destination} · {when}
          </T>
        </View>
        <View style={styles.lineRight}>
          <Money variant="section">{formatEuros(payout.amountCents)}</Money>
          <Pill tone={PAYOUT_TONE[payout.status]}>{payout.status}</Pill>
        </View>
        {open && wide ? <Actions payout={payout} busy={move.isPending} onCheck={() => run({ kind: "check" })} onSend={() => run({ kind: "send" })} onFail={() => setFailing((f) => !f)} /> : null}
      </View>
      {open && !wide ? (
        <View style={styles.actionsNarrow}>
          <Actions payout={payout} busy={move.isPending} onCheck={() => run({ kind: "check" })} onSend={() => run({ kind: "send" })} onFail={() => setFailing((f) => !f)} />
        </View>
      ) : null}
      {failing && open ? (
        <View style={styles.failForm}>
          <Field label="Why it failed" placeholder="What the bank or the brand said" value={reason} onChangeText={setReason} error={reasonError} />
          <Button label="Mark as failed" kind="secondary" busy={move.isPending} onPress={fail} style={styles.failButton} />
        </View>
      ) : null}
      {problem ? (
        <View role="alert" style={styles.alert}>
          <T variant="body" style={{ color: colors.negative }}>
            {problem}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function Actions({ payout, busy, onCheck, onSend, onFail }: { payout: PayoutWithMemberRow; busy: boolean; onCheck: () => void; onSend: () => void; onFail: () => void }) {
  return (
    <View style={styles.actions}>
      {payout.status === "requested" ? <Button label="Check" kind="secondary" busy={busy} onPress={onCheck} /> : null}
      {payout.status === "checking" ? <Button label="Send" busy={busy} onPress={onSend} /> : null}
      <Button label="Fail" kind="text" disabled={busy} onPress={onFail} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { overflow: "hidden", marginTop: 16 },
  pad: { padding: space.card },
  line: { paddingHorizontal: space.card, paddingVertical: 14 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  lineInner: { flexDirection: "row", alignItems: "center", minHeight: 44 },
  lineText: { flex: 1, minWidth: 0 },
  lineRight: { marginLeft: 16, alignItems: "flex-end", gap: 4, minWidth: 96 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 24, width: 150, justifyContent: "flex-end" },
  actionsNarrow: { flexDirection: "row", marginTop: 10 },
  failForm: { marginTop: 12, maxWidth: 480 },
  failButton: { alignSelf: "flex-start" },
  alert: { marginTop: 8 },
});
