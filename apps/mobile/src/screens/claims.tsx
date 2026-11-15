import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useClaims } from "../api/queries";
import type { ClaimRow } from "../api/types";
import { formatDate, formatEuros } from "../ui/format";
import { useNav } from "../ui/nav";
import { Card, Empty, Failed, LinkButton, Loading, Money, Pager, Pill, T, type PillTone } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { MerchantMark } from "./offers";

/*
 * "What happened to my missing cashback?" One row per claim with where it stands; filing a new one
 * is the one action.
 */

export const CLAIM_TONE: Record<ClaimRow["status"], PillTone> = { filed: "neutral", acknowledged: "neutral", raised: "warning", credited: "positive", declined: "negative" };

export const CLAIM_STANDING: Record<ClaimRow["status"], string> = {
  filed: "Filed; support will pick it up.",
  acknowledged: "Support has it and is checking the order.",
  raised: "Raised with the shop's network, which can take a few weeks.",
  credited: "Credited: the cashback is in your available balance.",
  declined: "Declined.",
};

export function ClaimsScreen() {
  const [page, setPage] = useState(1);
  const claims = useClaims(page);
  const total = claims.data?.total;
  return (
    <Screen>
      <TitleRow
        title="Claims"
        line={total === undefined ? "A claim is for a purchase whose cashback never showed." : total === 0 ? "Nothing missing so far." : `${total} claim${total === 1 ? "" : "s"}; a credited one pays straight into your available balance.`}
        action={<LinkButton href="/claims/new" label="File a claim" />}
      />
      <Card pad={false} style={styles.list}>
        {claims.isPending ? (
          <View style={styles.pad}>
            <Loading rows={3} height={24} />
          </View>
        ) : claims.isError ? (
          <View style={styles.pad}>
            <Failed message={claims.error.message} onRetry={() => void claims.refetch()} />
          </View>
        ) : claims.data.items.length === 0 ? (
          <View style={styles.pad}>
            <Empty>No claim yet. If a purchase you activated never showed as cashback within a week, file one with the order details.</Empty>
          </View>
        ) : (
          claims.data.items.map((c, i) => <ClaimLine key={c.id} claim={c} last={i === claims.data.items.length - 1} />)
        )}
      </Card>
      {claims.data ? <Pager page={claims.data.page} pageSize={claims.data.pageSize} total={claims.data.total} count={claims.data.items.length} onPage={setPage} /> : null}
    </Screen>
  );
}

function ClaimLine({ claim, last }: { claim: ClaimRow; last: boolean }) {
  const { Link } = useNav();
  const wide = useWide();
  return (
    <Link href={`/claims/${claim.id}`} aria-label={`${claim.offer.merchant.name}, ${claim.orderRef}, ${claim.status}`} style={[styles.line, last ? null : styles.rule]}>
      <View style={styles.lineInner}>
        <MerchantMark name={claim.offer.merchant.name} />
        <View style={styles.lineText}>
          <T variant="body" weight={500} numberOfLines={1}>
            {claim.offer.merchant.name} · {claim.orderRef}
          </T>
          <T variant="small" numberOfLines={1}>
            ordered {formatDate(claim.orderedAt)} · filed {formatDate(claim.filedAt)}
          </T>
        </View>
        {wide ? (
          <View style={styles.lineMiddle}>
            <T variant="body">{CLAIM_STANDING[claim.status]}</T>
          </View>
        ) : null}
        <View style={styles.lineRight}>
          <Money variant="section">{formatEuros(claim.orderCents)}</Money>
          <Pill tone={CLAIM_TONE[claim.status]}>{claim.status}</Pill>
        </View>
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  list: { overflow: "hidden" },
  pad: { padding: space.card },
  line: { minHeight: 72, justifyContent: "center", paddingHorizontal: space.card },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  lineInner: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  lineText: { flex: 1, minWidth: 0, marginLeft: 12 },
  lineMiddle: { width: 320, marginLeft: 16 },
  lineRight: { marginLeft: 16, alignItems: "flex-end", gap: 4, minWidth: 96 },
});
