import { StyleSheet, View } from "react-native";
import { useImport, useTransactions } from "../api/ops-queries";
import type { ImportBatchRow } from "../api/types";
import { formatDate } from "../ui/format";
import { Card, CardTitle, Empty, Failed, Loading, Pill, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { BATCH_TONE } from "./imports";
import { TransactionLine } from "./transactions";

/*
 * One file: what it did, as six counts in one divided strip; the lines it could not read, each
 * with its line number so the file can be fixed; and the sales it reported, each a link to its
 * own screen. A failed batch shows the one reason nothing was booked.
 */

export function ImportBatchScreen({ id }: { id: string }) {
  const wide = useWide();
  const batch = useImport(id);
  const transactions = useTransactions({ batch: id, pageSize: 50 });

  if (batch.isPending) {
    return (
      <Screen>
        <TitleRow title="Import" back="/imports" />
        <Card>
          <Loading rows={4} height={24} />
        </Card>
      </Screen>
    );
  }
  if (batch.isError) {
    return (
      <Screen>
        <TitleRow title="Import" back="/imports" />
        <Card>
          <Failed message={batch.error.message} onRetry={() => void batch.refetch()} />
        </Card>
      </Screen>
    );
  }

  const b = batch.data;
  return (
    <Screen>
      <TitleRow title={b.filename} back="/imports" line={outcome(b)} />
      <Card pad={false}>
        <View style={styles.head}>
          <Pill tone={BATCH_TONE[b.status]}>{b.status}</Pill>
          <T variant="small">
            {b.network} · received {formatDate(b.createdAt)}
            {b.processedAt ? ` · processed ${formatDate(b.processedAt)}` : ""}
          </T>
        </View>
        <View style={[styles.strip, wide ? null : styles.stripNarrow]} role="list" aria-label="Counts">
          <Cell label="Rows" value={b.rowCount} wide={wide} first />
          <Cell label="New" value={b.newCount} wide={wide} />
          <Cell label="Updated" value={b.updatedCount} wide={wide} />
          <Cell label="Matched" value={b.matchedCount} wide={wide} />
          <Cell label="Unmatched" value={b.unmatchedCount} wide={wide} />
          <Cell label="Errors" value={b.errorCount} wide={wide} />
        </View>
      </Card>

      {b.errors.length > 0 ? (
        <Card pad={false} style={styles.block}>
          <CardTitle>{b.status === "failed" ? "Why it failed" : "Lines to fix"}</CardTitle>
          <View role="list" aria-label="Errors">
            {b.errors.map((e, i) => (
              <View key={`${e.line}-${i}`} role="listitem" style={[styles.error, i === b.errors.length - 1 ? styles.errorLast : styles.rule]}>
                <T variant="body">{e.line > 0 ? `line ${e.line}: ${e.message}` : e.message}</T>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Card pad={false} style={styles.block}>
        <CardTitle>Sales in this file</CardTitle>
        {transactions.isPending ? (
          <View style={styles.pad}>
            <Loading rows={4} height={24} />
          </View>
        ) : transactions.isError ? (
          <View style={styles.pad}>
            <Failed message={transactions.error.message} onRetry={() => void transactions.refetch()} />
          </View>
        ) : transactions.data.items.length === 0 ? (
          <View style={styles.pad}>
            <Empty>{b.status === "failed" ? "Nothing was booked from this file." : "No new sale in this file; every row was about an order already known, or could not be read."}</Empty>
          </View>
        ) : (
          transactions.data.items.map((t, i) => <TransactionLine key={t.id} transaction={t} last={i === transactions.data.items.length - 1} />)
        )}
      </Card>
    </Screen>
  );
}

function outcome(b: ImportBatchRow): string {
  if (b.status === "failed") return "The file could not be processed; nothing was booked.";
  if (b.status === "received") return "Still being processed.";
  const booked = b.matchedCount === 0 ? "no cashback booked" : `${b.matchedCount} cashback${b.matchedCount === 1 ? "" : "s"} booked`;
  const waiting = b.unmatchedCount === 0 ? "nothing left unmatched" : `${b.unmatchedCount} sale${b.unmatchedCount === 1 ? "" : "s"} waiting for a member`;
  const lines = b.errorCount > 0 ? `, ${b.errorCount} line${b.errorCount === 1 ? "" : "s"} to fix in the file` : ", every line read";
  return `${booked}, ${waiting}${lines}.`.replace(/^./, (c) => c.toUpperCase());
}

function Cell({ label, value, wide, first }: { label: string; value: number; wide: boolean; first?: boolean }) {
  return (
    <View role="listitem" aria-label={label} style={[styles.cell, wide ? styles.cellWide : styles.cellNarrow, first || !wide ? null : styles.cellRule]}>
      <T variant="small">{label}</T>
      <T variant="kpi" num style={styles.cellValue}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", paddingHorizontal: space.card, paddingTop: space.card, paddingBottom: 16 },
  strip: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.rule },
  stripNarrow: { flexWrap: "wrap" },
  cell: { paddingHorizontal: space.card, paddingVertical: 14 },
  cellWide: { flex: 1 },
  cellNarrow: { width: "33.333%", borderBottomWidth: 1, borderBottomColor: colors.rule },
  cellRule: { borderLeftWidth: 1, borderLeftColor: colors.rule },
  cellValue: { marginTop: 2 },
  block: { marginTop: space.pad },
  pad: { padding: space.card },
  error: { paddingHorizontal: space.card, paddingVertical: 10 },
  errorLast: { paddingBottom: 16 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
});
