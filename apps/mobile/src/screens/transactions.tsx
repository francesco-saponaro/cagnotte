import type { MatchStatus, Network, NetworkStatus } from "@cagnotte/domain";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTransactions } from "../api/ops-queries";
import type { TransactionRow } from "../api/types";
import { formatDay, formatEuros } from "../ui/format";
import { useNav } from "../ui/nav";
import { Card, Empty, Failed, Loading, Money, Pager, Pill, Segmented, T, type PillTone } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { MerchantMark } from "./offers";

/*
 * "Which reported sales have no member yet?" The networks' transactions, filtered on the server
 * by match status and network, unmatched first because those are the ones that wait for a human:
 * a claim from the member, or a match by hand from here.
 */

const MATCH_FILTERS = [
  { value: "unmatched", label: "Unmatched" },
  { value: "matched", label: "Matched" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All" },
] as const;

const NETWORK_FILTERS = [
  { value: "all", label: "All networks" },
  { value: "linkpool", label: "linkpool" },
  { value: "affinet", label: "affinet" },
] as const;

type MatchFilter = (typeof MATCH_FILTERS)[number]["value"];
type NetworkFilter = (typeof NETWORK_FILTERS)[number]["value"];

export const MATCH_TONE: Record<MatchStatus, PillTone> = { unmatched: "warning", matched: "positive", ignored: "neutral" };
export const NETWORK_STATUS_TONE: Record<NetworkStatus, PillTone> = { pending: "neutral", approved: "positive", declined: "negative" };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The total of the current filter in words, for the line under the title. */
export function queueLine(match: MatchFilter, total: number | undefined): string {
  if (total === undefined) return "What the networks reported, and which click each sale belongs to.";
  switch (match) {
    case "unmatched":
      return total === 0 ? "Every reported sale has a member or a reason; nothing waits." : `${plural(total, "sale")} matched no click; each waits for a claim or a match by hand.`;
    case "matched":
      return `${plural(total, "sale")} matched to a click and booked.`;
    case "ignored":
      return `${plural(total, "sale")} set aside with a reason; a claim or a match by hand can still take one up.`;
    case "all":
      return `${plural(total, "sale")} reported by the networks.`;
  }
}

export function TransactionsScreen() {
  const wide = useWide();
  const [match, setMatch] = useState<MatchFilter>("unmatched");
  const [network, setNetwork] = useState<NetworkFilter>("all");
  const [page, setPage] = useState(1);
  const transactions = useTransactions({ match: match === "all" ? undefined : match, network: network === "all" ? undefined : (network as Network), page, pageSize: 20 });

  return (
    <Screen>
      <TitleRow title="Transactions" line={queueLine(match, transactions.data?.total)} />
      <View style={[styles.filters, wide ? styles.filtersWide : null]}>
        <Segmented label="Match" options={MATCH_FILTERS} value={match} onChange={(v) => (setMatch(v), setPage(1))} scroll={!wide} />
        <Segmented label="Network" options={NETWORK_FILTERS} value={network} onChange={(v) => (setNetwork(v), setPage(1))} scroll={!wide} />
      </View>
      <Card pad={false} style={styles.list}>
        {transactions.isPending ? (
          <View style={styles.pad}>
            <Loading rows={5} height={24} />
          </View>
        ) : transactions.isError ? (
          <View style={styles.pad}>
            <Failed message={transactions.error.message} onRetry={() => void transactions.refetch()} />
          </View>
        ) : transactions.data.items.length === 0 ? (
          <View style={styles.pad}>
            <Empty>{match === "unmatched" ? "Nothing waits here. The next import may bring more." : `No ${match === "all" ? "" : `${match} `}sale${network === "all" ? "" : ` from ${network}`}.`}</Empty>
          </View>
        ) : (
          transactions.data.items.map((t, i) => <TransactionLine key={t.id} transaction={t} last={i === transactions.data.items.length - 1} />)
        )}
      </Card>
      {transactions.data ? <Pager page={transactions.data.page} pageSize={transactions.data.pageSize} total={transactions.data.total} count={transactions.data.items.length} onPage={setPage} /> : null}
    </Screen>
  );
}

/** One reported sale as a row; the batch screen lists its sales with the same row. */
export function TransactionLine({ transaction: t, last }: { transaction: TransactionRow; last: boolean }) {
  const { Link } = useNav();
  const wide = useWide();
  return (
    <Link href={`/transactions/${t.id}`} aria-label={`${t.merchant.name}, ${t.orderRef}, ${t.matchStatus}`} style={[styles.line, last ? null : styles.rule]}>
      <View style={styles.lineInner}>
        <MerchantMark name={t.merchant.name} />
        <View style={styles.lineText}>
          <T variant="body" weight={500} numberOfLines={1}>
            {t.merchant.name} · {t.orderRef}
          </T>
          <T variant="small" numberOfLines={1}>
            {t.network} {t.networkRef} · ordered {formatDay(t.orderedAt)}
            {wide ? "" : ` · ${formatEuros(t.commissionCents)} commission`}
          </T>
        </View>
        {wide ? (
          <View style={styles.lineMiddle}>
            <Pill tone={NETWORK_STATUS_TONE[t.networkStatus]}>{t.networkStatus}</Pill>
          </View>
        ) : null}
        <View style={styles.lineFigures}>
          <Money variant="section">{formatEuros(t.orderCents)}</Money>
          {wide ? (
            <T variant="small" num align="right">
              {formatEuros(t.commissionCents)} commission
            </T>
          ) : null}
        </View>
        <View style={styles.lineRight}>
          <Pill tone={MATCH_TONE[t.matchStatus]}>{t.matchStatus}</Pill>
        </View>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 10, marginBottom: 16 },
  filtersWide: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  list: { overflow: "hidden" },
  pad: { padding: space.card },
  line: { minHeight: 64, justifyContent: "center", paddingHorizontal: space.card },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  lineInner: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  lineText: { flex: 1, minWidth: 0, marginLeft: 12 },
  lineMiddle: { width: 100, marginLeft: 16 },
  lineFigures: { marginLeft: 16, alignItems: "flex-end", minWidth: 96 },
  lineRight: { marginLeft: 16, minWidth: 88, alignItems: "flex-end" },
});
