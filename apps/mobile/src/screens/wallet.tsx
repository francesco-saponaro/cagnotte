import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useCashbacks, useWallet } from "../api/queries";
import type { CashbackRow, WalletRow } from "../api/types";
import { BucketStrip } from "../ui/bucket-strip";
import { formatDate, formatEuros, formatSigned, inDays } from "../ui/format";
import { useNav } from "../ui/nav";
import { Card, CardTitle, Empty, Failed, LinkButton, Loading, Money, Pager, Pill, Segmented, T, type PillTone } from "../ui/primitives";
import { Screen, SectionTitle, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { MerchantMark } from "./offers";

/*
 * "How much is mine now, and how much is still on its way?" The available balance is the lead
 * figure; the strip under it is the pot's four buckets at their true proportions; the finding under
 * the title is the next cashback to validate. Cashbacks list below, paged and filtered on the server;
 * the latest ledger movements sit beside them.
 */

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "validated", label: "Validated" },
  { value: "refused", label: "Refused" },
  { value: "cancelled", label: "Cancelled" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

export const STATUS_TONE: Record<CashbackRow["status"], PillTone> = { pending: "neutral", validated: "positive", refused: "negative", cancelled: "negative" };

/** The pending cashback that validates soonest, for the line under the title. */
export function nextToValidate(cashbacks: CashbackRow[]): CashbackRow | null {
  const pending = cashbacks.filter((c) => c.status === "pending").sort((a, b) => a.expectedValidationAt.localeCompare(b.expectedValidationAt));
  return pending[0] ?? null;
}

export function findingLine(wallet: WalletRow | undefined, cashbacks: CashbackRow[] | undefined): string {
  if (!wallet) return "Your cashback, in the four places it can be.";
  const next = cashbacks ? nextToValidate(cashbacks) : null;
  if (wallet.balances.pending === 0) return "Nothing is on its way; activate an offer before your next purchase.";
  if (!next) return `${formatEuros(wallet.balances.pending)} is on its way.`;
  return `${formatEuros(wallet.balances.pending)} on its way; ${formatEuros(next.amountCents)} from ${next.offer.merchant.name} validates ${inDays(next.expectedValidationAt)}.`;
}

export function WalletScreen() {
  const wide = useWide();
  const wallet = useWallet();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const cashbacks = useCashbacks(status === "all" ? undefined : status, page);
  // The finding wants the pending ones whatever the filter shows; the unfiltered first page is what the screen opens on.
  const pendingForFinding = useCashbacks("pending", 1, 50);

  return (
    <Screen>
      <TitleRow title="Wallet" line={findingLine(wallet.data, pendingForFinding.data?.items)} />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <View style={wide ? styles.mainWide : null}>
          <Card>
            {wallet.isPending ? (
              <Loading rows={3} height={28} />
            ) : wallet.isError ? (
              <Failed message={wallet.error.message} onRetry={() => void wallet.refetch()} />
            ) : (
              <View>
                <T variant="section" role="heading" level={2}>
                  Available now
                </T>
                <Money variant="kpi" strong color={colors.hueInk} style={styles.balance}>
                  {formatEuros(wallet.data.balances.available)}
                </Money>
                <View style={styles.strip}>
                  <BucketStrip balances={wallet.data.balances} />
                </View>
                <View style={styles.actions}>
                  <LinkButton href="/wallet/payout" label="Use my pot" disabled={wallet.data.balances.available === 0} />
                  <LinkButton href="/claims/new" label="Something missing?" kind="secondary" />
                </View>
              </View>
            )}
          </Card>

          <SectionTitle right={<Segmented label="Status" options={STATUS_FILTERS} value={status} onChange={(v) => (setStatus(v), setPage(1))} scroll={!wide} />}>Cashbacks</SectionTitle>
          <Card pad={false} style={styles.list}>
            {cashbacks.isPending ? (
              <View style={styles.pad}>
                <Loading rows={4} height={24} />
              </View>
            ) : cashbacks.isError ? (
              <View style={styles.pad}>
                <Failed message={cashbacks.error.message} onRetry={() => void cashbacks.refetch()} />
              </View>
            ) : cashbacks.data.items.length === 0 ? (
              <View style={styles.pad}>
                <Empty>{status === "all" ? "No cashback yet. Activate an offer, buy, and it shows here within two days." : `No ${status} cashback.`}</Empty>
              </View>
            ) : (
              cashbacks.data.items.map((c, i) => <CashbackLine key={c.id} cashback={c} last={i === cashbacks.data.items.length - 1} />)
            )}
          </Card>
          {cashbacks.data ? <Pager page={cashbacks.data.page} pageSize={cashbacks.data.pageSize} total={cashbacks.data.total} count={cashbacks.data.items.length} onPage={setPage} /> : null}
        </View>

        <View style={wide ? styles.sideWide : styles.side}>
          <Card pad={false} style={styles.list}>
            <CardTitle>Movements</CardTitle>
            {wallet.data ? (
              wallet.data.ledger.items.length === 0 ? (
                <View style={styles.pad}>
                  <Empty>No movement yet.</Empty>
                </View>
              ) : (
                <View role="list" aria-label="Movements">
                  {wallet.data.ledger.items.slice(0, 8).map((entry, i, all) => (
                    <View key={entry.id} role="listitem" style={[styles.move, i === all.length - 1 ? null : styles.rule]}>
                      <View style={styles.moveText}>
                        <T variant="body">{KIND_LABEL[entry.kind]}</T>
                        <T variant="small">
                          {entry.bucket} · {formatDate(entry.createdAt)}
                        </T>
                      </View>
                      <Money style={entry.amountCents < 0 ? styles.negative : null}>{formatSigned(entry.amountCents)}</Money>
                    </View>
                  ))}
                </View>
              )
            ) : (
              <View style={styles.pad}>
                <Loading rows={4} />
              </View>
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}

export const KIND_LABEL: Record<CashbackRow["status"] | string, string> = {
  cashback_pending: "Cashback reported",
  cashback_validated: "Cashback validated",
  cashback_refused: "Cashback refused",
  cashback_adjusted: "Cashback adjusted",
  cashback_cancelled: "Cashback taken back",
  manual_credit: "Credited after a claim",
  referral_bonus: "Referral bonus",
  payout_reserved: "Payout requested",
  payout_sent: "Payout sent",
  payout_failed: "Payout returned",
};

function CashbackLine({ cashback, last }: { cashback: CashbackRow; last: boolean }) {
  const { Link } = useNav();
  const wide = useWide();
  const when =
    cashback.status === "pending"
      ? `validates ${inDays(cashback.expectedValidationAt)}`
      : cashback.status === "validated"
        ? `validated ${cashback.validatedAt ? formatDate(cashback.validatedAt) : ""}`
        : cashback.decisionReason
          ? cashback.decisionReason
          : `${cashback.status} ${cashback.decidedAt ? formatDate(cashback.decidedAt) : ""}`;
  return (
    <Link href={`/wallet/cashbacks/${cashback.id}`} aria-label={`${cashback.offer.merchant.name}, ${formatEuros(cashback.amountCents)}, ${cashback.status}`} style={[styles.line, last ? null : styles.rule]}>
      <View style={styles.lineInner}>
        <MerchantMark name={cashback.offer.merchant.name} />
        <View style={styles.lineText}>
          <T variant="body" weight={500} numberOfLines={1}>
            {cashback.offer.merchant.name}
          </T>
          <T variant="small" numberOfLines={1}>
            {wide ? `order of ${formatEuros(cashback.orderCents)} on ${formatDate(cashback.createdAt)} · ${when}` : `${formatDate(cashback.createdAt)} · ${when}`}
          </T>
        </View>
        <View style={styles.lineRight}>
          <Money variant="section" style={cashback.status === "refused" || cashback.status === "cancelled" ? styles.struck : null}>
            {formatEuros(cashback.amountCents)}
          </Money>
          <Pill tone={STATUS_TONE[cashback.status]}>{cashback.status}</Pill>
        </View>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  mainWide: { flex: 1, minWidth: 0 },
  side: {},
  sideWide: { width: 360 },
  balance: { marginTop: 4 },
  strip: { marginTop: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 24 },
  list: { overflow: "hidden" },
  pad: { padding: space.card },
  line: { minHeight: 72, justifyContent: "center", paddingHorizontal: space.card },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  lineInner: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  lineText: { flex: 1, minWidth: 0, marginLeft: 12 },
  lineRight: { marginLeft: 16, alignItems: "flex-end", gap: 4 },
  struck: { color: colors.muted, textDecorationLine: "line-through" },
  move: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: space.card, paddingVertical: 8 },
  moveText: { flex: 1, minWidth: 0, marginRight: 12 },
  negative: { color: colors.muted },
});
