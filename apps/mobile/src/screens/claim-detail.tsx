import type { ClaimDeclineReason } from "@cagnotte/domain";
import { StyleSheet, View } from "react-native";
import { useClaim, useOffer } from "../api/queries";
import { formatDate, formatEuros } from "../ui/format";
import { Card, CardTitle, Failed, Loading, Pill, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { CLAIM_STANDING, CLAIM_TONE } from "./claims";

/*
 * One claim: where it stands, in the words of the step it is at, and the order details support is
 * working from. A declined claim says why, in plain words.
 */

export const DECLINE_WORDS: Record<ClaimDeclineReason, string> = {
  no_activation_before_order: "the offer was not activated before the order, so the shop could not attribute it",
  foreign_promo_code: "a promo code from elsewhere was used, which the shop does not pay cashback on",
  outside_claim_window: "the claim came in after the three months the shop allows",
  order_not_found_at_network: "the shop's network has no record of this order",
  order_returned: "the order was returned or cancelled",
};

export function ClaimDetailScreen({ id }: { id: string }) {
  const wide = useWide();
  const claim = useClaim(id);
  const offer = useOffer(claim.data?.offerId ?? "");

  if (claim.isPending) {
    return (
      <Screen>
        <TitleRow title="Claim" back="/claims" />
        <Card>
          <Loading rows={4} height={24} />
        </Card>
      </Screen>
    );
  }
  if (claim.isError) {
    return (
      <Screen>
        <TitleRow title="Claim" back="/claims" />
        <Card>
          <Failed message={claim.error.message} onRetry={() => void claim.refetch()} />
        </Card>
      </Screen>
    );
  }

  const c = claim.data;
  const reason = c.declineReason ? (DECLINE_WORDS[c.declineReason as ClaimDeclineReason] ?? c.declineReason) : null;
  return (
    <Screen>
      <TitleRow title={`Claim ${c.orderRef}`} back="/claims" line={offer.data ? `${offer.data.merchant.name} · ${offer.data.title}` : undefined} />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <Card style={wide ? styles.mainWide : null}>
          <View style={styles.head}>
            <Pill tone={CLAIM_TONE[c.status]}>{c.status}</Pill>
            <T variant="body" style={styles.standing}>
              {c.status === "declined" && reason ? `Declined: ${reason}.` : CLAIM_STANDING[c.status]}
            </T>
          </View>
          <View style={styles.facts}>
            <Fact label="Order" value={`${c.orderRef}, ${formatEuros(c.orderCents)} on ${formatDate(c.orderedAt)}`} />
            <Fact label="Filed" value={formatDate(c.filedAt)} />
            <Fact label="Last change" value={formatDate(c.updatedAt)} />
            {c.cashbackId ? <Fact label="Cashback" value="credited to your available balance" /> : null}
          </View>
        </Card>
        <Card pad={false} style={wide ? styles.sideWide : null}>
          <CardTitle>What you sent</CardTitle>
          <T variant="body" style={styles.proof}>
            {c.proofText}
          </T>
        </Card>
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

const styles = StyleSheet.create({
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  mainWide: { flex: 1, minWidth: 0 },
  sideWide: { width: 360 },
  proof: { paddingHorizontal: space.card, paddingBottom: space.card },
  head: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  standing: { flex: 1, minWidth: 200 },
  facts: { marginTop: 16 },
  fact: { flexDirection: "row", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.rule },
  factLabel: { width: 128 },
  factValue: { flex: 1 },
});
