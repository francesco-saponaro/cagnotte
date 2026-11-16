import { StyleSheet, View } from "react-native";
import { useMargin, useOverview, useReconciliation } from "../api/ops-queries";
import type { MarginReportRow, OverviewRow, ReconciliationRow } from "../api/types";
import { formatDate, formatEuros, formatSigned } from "../ui/format";
import { useNav } from "../ui/nav";
import { Card, CardTitle, Failed, Loading, Pill, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";

/*
 * "Is the book right, and what is waiting for a human?" What the operations manager reads in the
 * morning: the three queues, each one click away; the margin per shop, which is the whole
 * business in one row each (commission in from the network, cashback out to the members); the pot
 * across every member; and the reconciliation, which recomputes the book from the entries and says
 * whether every cashback and payout nets to what its status claims.
 */

const plural = (n: number, one: string, none = `no ${one}`) => (n === 0 ? none : `${n} ${one}${n === 1 ? "" : "s"}`);

/** The line under the title: the queues and the ledger's verdict in one sentence. */
export function queueLine(o: OverviewRow, r: ReconciliationRow): string {
  const queues = `${plural(o.unmatchedTransactions, "sale")} matched no click, ${plural(o.openClaims, "claim")} open, ${plural(o.payoutsWaiting, "payout")} waiting`;
  const failed = r.checks.filter((c) => !c.ok).length;
  const verdict = r.ok ? "the ledger reconciles" : failed > 0 ? `the ledger does not reconcile: ${plural(failed, "check")} failed` : "the ledger does not reconcile: entries are out of balance";
  return `${queues}; ${verdict}.`;
}

const DAY = 24 * 60 * 60 * 1000;

/** The margin card's sentence: the period in days, what came in, what went out, and the shops in the red. */
export function marginLine(m: MarginReportRow): string {
  const days = Math.round((new Date(m.to).getTime() - new Date(m.from).getTime()) / DAY);
  const red = m.lines.filter((l) => l.marginCents < 0).length;
  const tail = red === 0 ? "every shop earned more than it paid out" : red === 1 ? "one shop paid out more than it earned" : `${red} shops paid out more than they earned`;
  return `Over ${days} days the networks paid ${formatEuros(m.totals.commissionCents)} of commission on ${m.totals.transactions} sales and the members got ${formatEuros(m.totals.cashbackCents)}; ${tail}.`;
}

export function DashboardScreen() {
  const wide = useWide();
  const overview = useOverview();
  const margin = useMargin();
  const reconciliation = useReconciliation();
  const line = overview.data && reconciliation.data ? queueLine(overview.data, reconciliation.data) : "The queues, the margin per shop and the proof that the ledger adds up.";

  return (
    <Screen>
      <TitleRow title="Dashboard" line={line} />
      <Queues overview={overview} />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <View style={[styles.main, wide ? styles.mainWide : null]}>
          <Card pad={false}>
            {margin.isPending ? (
              <View style={styles.pad}>
                <Loading rows={5} height={24} />
              </View>
            ) : margin.isError ? (
              <View style={styles.pad}>
                <Failed message={margin.error.message} onRetry={() => void margin.refetch()} />
              </View>
            ) : (
              <Margin report={margin.data} />
            )}
          </Card>
        </View>
        <View style={[styles.side, wide ? styles.sideWide : null]}>
          <Card pad={false}>
            <CardTitle>The pot, every member together</CardTitle>
            {overview.isPending ? (
              <View style={styles.pad}>
                <Loading rows={3} height={24} />
              </View>
            ) : overview.isError ? (
              <View style={styles.pad}>
                <Failed message={overview.error.message} onRetry={() => void overview.refetch()} />
              </View>
            ) : (
              <Pot overview={overview.data} />
            )}
          </Card>
          <Card pad={false} style={styles.stack}>
            <CardTitle right={reconciliation.data ? <Pill tone={reconciliation.data.ok ? "positive" : "negative"}>{reconciliation.data.ok ? "reconciles" : "does not reconcile"}</Pill> : undefined}>Reconciliation</CardTitle>
            {reconciliation.isPending ? (
              <View style={styles.pad}>
                <Loading rows={3} height={24} />
              </View>
            ) : reconciliation.isError ? (
              <View style={styles.pad}>
                <Failed message={reconciliation.error.message} onRetry={() => void reconciliation.refetch()} />
              </View>
            ) : (
              <Reconciliation report={reconciliation.data} />
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}

const QUEUES: { key: keyof Pick<OverviewRow, "unmatchedTransactions" | "openClaims" | "payoutsWaiting">; label: string; href: string }[] = [
  { key: "unmatchedTransactions", label: "Sales with no click", href: "/transactions" },
  { key: "openClaims", label: "Claims open", href: "/support" },
  { key: "payoutsWaiting", label: "Payouts waiting", href: "/payouts" },
];

/** The three queues as figures in one divided container; each is the link to the queue itself. */
function Queues({ overview }: { overview: ReturnType<typeof useOverview> }) {
  const { Link } = useNav();
  const wide = useWide();
  return (
    <Card pad={false} style={[styles.queues, wide ? styles.queuesWide : null]}>
      {QUEUES.map((q, i) => {
        const value = overview.data ? overview.data[q.key] : null;
        return (
          <Link key={q.key} href={q.href} aria-label={`${q.label}: ${value ?? "loading"}`} style={[styles.queue, i > 0 ? (wide ? styles.queueDividedWide : styles.queueDivided) : null]}>
            <T variant="small">{q.label}</T>
            {value === null ? <View style={styles.bone} /> : (
              <T variant="kpi" num>
                {value}
              </T>
            )}
          </Link>
        );
      })}
    </Card>
  );
}

/**
 * The margin by shop: each row's bar is as long as the shop's commission against the largest, and
 * the part the members got is filled in the one hue; what is left is the margin, in grey. A shop
 * that paid out more than its commission shows a bar wholly in the hue and a signed negative margin.
 */
function Margin({ report }: { report: MarginReportRow }) {
  const wide = useWide();
  const lines = [...report.lines].sort((a, b) => b.commissionCents - a.commissionCents).slice(0, 12);
  const largest = Math.max(1, ...lines.map((l) => l.commissionCents));
  // The totals are the sums of the lines as shown, never the report's own figure typed beside them.
  const totals = lines.reduce((t, l) => ({ transactions: t.transactions + l.transactions, commissionCents: t.commissionCents + l.commissionCents, cashbackCents: t.cashbackCents + l.cashbackCents, marginCents: t.marginCents + l.marginCents }), { transactions: 0, commissionCents: 0, cashbackCents: 0, marginCents: 0 });
  const period = `${formatDate(report.from)} to ${formatDate(report.to)}`;
  return (
    <View>
      <CardTitle right={wide ? <T variant="small">{period}</T> : undefined}>Margin by shop</CardTitle>
      <T variant="body" muted style={styles.marginLine}>
        {marginLine(report)}
        {wide ? "" : ` ${period}.`}
      </T>
      {wide ? (
        <View style={[styles.marginRow, styles.marginHeader]}>
          <T variant="small" style={styles.marginName}>
            Shop
          </T>
          <View style={styles.marginBarCell} />
          <T variant="small" align="right" style={styles.marginFigure}>
            Commission
          </T>
          <T variant="small" align="right" style={styles.marginFigure}>
            Cashback
          </T>
          <T variant="small" align="right" style={styles.marginFigure}>
            Margin
          </T>
        </View>
      ) : null}
      {lines.length === 0 ? (
        <View style={styles.pad}>
          <T variant="body" muted>
            No sale reported in this period.
          </T>
        </View>
      ) : (
        lines.map((l) => {
          const paid = l.commissionCents <= 0 ? 1 : Math.min(1, l.cashbackCents / l.commissionCents);
          const label = `${l.merchantName}: ${formatEuros(l.commissionCents)} commission, ${formatEuros(l.cashbackCents)} cashback, ${l.marginCents < 0 ? "−" : ""}${formatEuros(Math.abs(l.marginCents))} margin on ${l.transactions} sales`;
          const bar = (
            <View role="img" aria-label={label} style={[styles.bar, { width: `${Math.round((l.commissionCents / largest) * 100)}%` }]}>
              <View style={[styles.barPaid, { flex: paid }]} />
              <View style={[styles.barMargin, { flex: 1 - paid }]} />
            </View>
          );
          const marginText = (
            <T variant="body" num align="right" style={[styles.marginFigure, l.marginCents < 0 ? styles.negative : null]}>
              {l.marginCents < 0 ? formatSigned(l.marginCents) : formatEuros(l.marginCents)}
            </T>
          );
          if (!wide) {
            return (
              <View key={l.merchantId} style={styles.marginPhoneRow}>
                <View style={styles.marginPhoneTop}>
                  <T variant="body" weight={500} numberOfLines={1} style={styles.marginName}>
                    {l.merchantName}
                  </T>
                  {marginText}
                </View>
                <T variant="small" num numberOfLines={1}>
                  {formatEuros(l.commissionCents)} commission · {formatEuros(l.cashbackCents)} cashback · {l.transactions} sales
                </T>
                <View style={styles.marginPhoneBar}>{bar}</View>
              </View>
            );
          }
          return (
            <View key={l.merchantId} style={styles.marginRow}>
              <T variant="body" weight={500} numberOfLines={1} style={styles.marginName}>
                {l.merchantName}
              </T>
              <View style={styles.marginBarCell}>{bar}</View>
              <T variant="body" num align="right" style={styles.marginFigure}>
                {formatEuros(l.commissionCents)}
              </T>
              <T variant="body" num align="right" style={styles.marginFigure}>
                {formatEuros(l.cashbackCents)}
              </T>
              {marginText}
            </View>
          );
        })
      )}
      {lines.length > 0 ? (
        <View style={[styles.marginRow, styles.marginTotals, wide ? null : styles.marginTotalsPhone]}>
          <T variant="body" weight={500} style={styles.marginName}>
            {lines.length === report.lines.length ? `All shops, ${totals.transactions} sales` : `Top ${lines.length} shops, ${totals.transactions} sales`}
          </T>
          {wide ? <View style={styles.marginBarCell} /> : null}
          <T variant="body" weight={500} num align="right" style={styles.marginFigure}>
            {formatEuros(totals.commissionCents)}
          </T>
          <T variant="body" weight={500} num align="right" style={styles.marginFigure}>
            {formatEuros(totals.cashbackCents)}
          </T>
          <T variant="body" weight={500} num align="right" style={[styles.marginFigure, totals.marginCents < 0 ? styles.negative : null]}>
            {totals.marginCents < 0 ? formatSigned(totals.marginCents) : formatEuros(totals.marginCents)}
          </T>
        </View>
      ) : null}
      {wide ? null : (
        <View style={styles.legend}>
          <View style={[styles.swatch, { backgroundColor: colors.hue }]} />
          <T variant="small">cashback paid out</T>
          <View style={[styles.swatch, { backgroundColor: colors.paid, marginLeft: 12 }]} />
          <T variant="small">margin kept</T>
        </View>
      )}
    </View>
  );
}

function Pot({ overview: o }: { overview: OverviewRow }) {
  const rows: { label: string; value: string }[] = [
    { label: "Pending, not yet confirmed by the shops", value: `${formatEuros(o.pendingCashbacks.cents)} in ${o.pendingCashbacks.count} cashbacks` },
    { label: "Validated, all time", value: formatEuros(o.validatedCents) },
    { label: "Validated in the last 30 days", value: formatEuros(o.validatedLast30DaysCents) },
    { label: "Members", value: String(o.members) },
    { label: "Live offers", value: String(o.liveOffers) },
  ];
  return (
    <View style={styles.potRows}>
      {rows.map((r, i) => (
        <View key={r.label} style={[styles.potRow, i > 0 ? styles.rule : null]}>
          <T variant="small" style={styles.potLabel}>
            {r.label}
          </T>
          <T variant="body" num align="right">
            {r.value}
          </T>
        </View>
      ))}
    </View>
  );
}

function Reconciliation({ report: r }: { report: ReconciliationRow }) {
  const counts: { label: string; value: number }[] = [
    { label: "Cashbacks out of balance", value: r.cashbacksOutOfBalance.length },
    { label: "Payouts out of balance", value: r.payoutsOutOfBalance.length },
    { label: "Negative balances", value: r.negativeBalances.length },
  ];
  return (
    <View style={styles.potRows}>
      {r.checks.map((c, i) => (
        <View key={c.name} style={[styles.check, i > 0 ? styles.rule : null]}>
          <View style={styles.checkHead}>
            <T variant="body" style={styles.checkName}>
              {c.name}
            </T>
            <Pill tone={c.ok ? "positive" : "negative"}>{c.ok ? "ok" : "off"}</Pill>
          </View>
          <T variant="small" num>
            expected {formatEuros(c.expected)}{c.ok ? "" : `, found ${formatEuros(c.actual)}`}
          </T>
        </View>
      ))}
      {counts.map((c) => (
        <View key={c.label} style={[styles.potRow, styles.rule]}>
          <T variant="small" style={styles.potLabel}>
            {c.label}
          </T>
          <T variant="body" num align="right" style={c.value > 0 ? styles.negative : null}>
            {c.value}
          </T>
        </View>
      ))}
      <View style={[styles.potRow, styles.rule]}>
        <T variant="small" style={styles.potLabel}>
          Computed
        </T>
        <T variant="small" num align="right">
          {formatDate(r.at)}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  queues: { flexDirection: "column", marginBottom: space.pad, overflow: "hidden" },
  queuesWide: { flexDirection: "row" },
  queue: { flex: 1, paddingHorizontal: space.card, paddingVertical: 16, gap: 4, minHeight: 84, justifyContent: "center" },
  queueDivided: { borderTopWidth: 1, borderTopColor: colors.rule },
  queueDividedWide: { borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: colors.rule },
  bone: { height: 36, width: 48, backgroundColor: colors.raised, borderRadius: 4 },
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  main: {},
  mainWide: { flex: 1, minWidth: 0 },
  side: {},
  sideWide: { width: 384 },
  stack: { marginTop: space.pad },
  pad: { padding: space.card },
  marginLine: { paddingHorizontal: space.card, paddingBottom: 12 },
  marginRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.card, minHeight: 44, borderTopWidth: 1, borderTopColor: colors.rule },
  marginHeader: { minHeight: 36 },
  marginName: { width: 170 },
  marginBarCell: { flex: 1, minWidth: 0, paddingHorizontal: 16 },
  marginFigure: { width: 108 },
  bar: { flexDirection: "row", height: 10, borderRadius: 3, overflow: "hidden", minWidth: 3 },
  barPaid: { backgroundColor: colors.hue, minWidth: 0 },
  barMargin: { backgroundColor: colors.paid, minWidth: 0 },
  marginTotals: { minHeight: 48, paddingBottom: 4 },
  marginTotalsPhone: { paddingTop: 10, flexWrap: "wrap", gap: 8, justifyContent: "flex-end" },
  marginPhoneRow: { paddingHorizontal: space.card, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.rule, gap: 4 },
  marginPhoneTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  marginPhoneBar: { marginTop: 4 },
  negative: { color: colors.negative },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.card, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.rule },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  potRows: { paddingHorizontal: space.card, paddingBottom: 8 },
  potRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, minHeight: 40, paddingVertical: 8 },
  potLabel: { flex: 1, minWidth: 0 },
  rule: { borderTopWidth: 1, borderTopColor: colors.rule },
  check: { paddingVertical: 10, gap: 4 },
  checkHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  checkName: { flex: 1, minWidth: 0 },
});
