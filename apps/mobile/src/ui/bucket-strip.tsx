import { StyleSheet, View, useWindowDimensions } from "react-native";
import type { LedgerBucket } from "@cagnotte/domain";
import { formatEuros } from "./format";
import { T } from "./primitives";
import { colors } from "./tokens";

/*
 * The pot drawn as its four buckets: one bar split at the true proportions of pending, available,
 * reserved and paid out. Available carries the one hue, because it is the money that is really the
 * member's; the rest is grey. A balance is the sum of ledger entries, so the strip is the ledger
 * seen from above.
 */

export type Balances = Record<LedgerBucket, number>;

export const BUCKETS: { key: LedgerBucket; label: string; color: string }[] = [
  { key: "pending", label: "pending", color: colors.pending },
  { key: "available", label: "available", color: colors.hue },
  { key: "reserved", label: "reserved", color: colors.reserved },
  { key: "paid", label: "paid out", color: colors.paid },
];

export function bucketLabel(balances: Balances): string {
  return `Your pot: ${BUCKETS.map((b) => `${formatEuros(balances[b.key])} ${b.label}`).join(", ")}`;
}

export function BucketStrip({ balances, compact = false }: { balances: Balances; compact?: boolean }) {
  const total = BUCKETS.reduce((sum, b) => sum + Math.max(0, balances[b.key]), 0);
  // On a phone the four figures sit two by two, so the legend never wraps three and one.
  const twoByTwo = useWindowDimensions().width < 560;
  return (
    <View>
      <View role="img" aria-label={bucketLabel(balances)} style={[styles.bar, compact ? styles.barCompact : null]}>
        {total === 0 ? (
          <View style={[styles.segment, { flex: 1, backgroundColor: colors.raised }]} />
        ) : (
          BUCKETS.map((b) => {
            const cents = Math.max(0, balances[b.key]);
            if (cents === 0) return null;
            return <View key={b.key} style={[styles.segment, { flex: cents, backgroundColor: b.color }]} />;
          })
        )}
      </View>
      {compact ? null : (
        <View style={styles.legend}>
          {BUCKETS.map((b) => (
            <View key={b.key} style={[styles.legendItem, twoByTwo ? styles.legendItemHalf : null]}>
              <View style={[styles.swatch, { backgroundColor: b.color }]} />
              <View>
                <T variant="small">{b.label}</T>
                <T variant="body" num style={balances[b.key] === 0 ? styles.zero : null} dataSet={{ bucket: b.key }}>
                  {formatEuros(balances[b.key])}
                </T>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", height: 14, borderRadius: 4, overflow: "hidden", gap: 2 },
  barCompact: { height: 8 },
  segment: { minWidth: 3 },
  legend: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, columnGap: 24, rowGap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendItemHalf: { width: "44%" },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  zero: { color: colors.muted },
});
