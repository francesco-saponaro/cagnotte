import { StyleSheet, View } from "react-native";
import { isApiError } from "../api/client";
import { useActivate, useActivations, useOffer } from "../api/queries";
import type { OfferDetailRow } from "../api/types";
import { ExternalLink } from "../ui/external-link";
import { formatDate, formatEuros, formatRate } from "../ui/format";
import { Button, Card, CardTitle, Failed, Loading, Money, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { MerchantMark } from "./offers";

/*
 * "What rate do I get right now, under what conditions, and when does it pay?" The big figure is
 * the rate in force this minute; activating snapshots it on the click, and the link out carries the
 * subId the network will report back.
 */

export function OfferDetailScreen({ id }: { id: string }) {
  const offer = useOffer(id);
  const activate = useActivate(id);
  const activations = useActivations();
  const wide = useWide();
  const mine = (activations.data?.items ?? []).filter((a) => a.offerId === id).sort((a, b) => b.activatedAt.localeCompare(a.activatedAt));

  if (offer.isPending) {
    return (
      <Screen>
        <TitleRow title="Offer" back="/offers" />
        <Card>
          <Loading rows={4} height={24} />
        </Card>
      </Screen>
    );
  }
  if (offer.isError) {
    return (
      <Screen>
        <TitleRow title="Offer" back="/offers" />
        <Card>
          <Failed message={isApiError(offer.error) && offer.error.status === 404 ? "This offer is no longer live." : offer.error.message} onRetry={() => void offer.refetch()} />
        </Card>
      </Screen>
    );
  }

  const o = offer.data;
  const base = formatRate(o);
  const inForce = o.rateKind === "fixed" ? formatEuros(o.fixedCents) : formatRate({ ...o, rateBps: o.rateInForce.rateBps });
  const boost = o.rateInForce.boosted ? o.boosts.find((b) => b.rateBps === o.rateInForce.rateBps && new Date(b.startsAt).getTime() <= Date.now() && new Date(b.endsAt).getTime() > Date.now()) : undefined;
  const activation = activate.data;

  return (
    <Screen>
      <TitleRow title={o.title} back="/offers" line={`${o.merchant.name} · ${o.merchant.category} · ${o.kind === "voucher" ? "voucher to use in store" : "online purchase"}`} />
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <Card style={[styles.main, wide ? styles.mainWide : null]}>
          <View style={styles.rateRow}>
            <MerchantMark name={o.merchant.name} />
            <View style={styles.rateText}>
              <Money variant="kpi" strong>
                {inForce}
              </Money>
              <T variant="body" muted>
                {boost ? `back right now, boosted from ${base} until ${formatDate(boost.endsAt)}` : o.rateKind === "fixed" ? "back on each qualifying order" : "back on what you spend, delivery excluded"}
              </T>
            </View>
          </View>
          {o.description ? (
            <T variant="body" style={styles.description}>
              {o.description}
            </T>
          ) : null}
          <View style={styles.conditions}>
            <Condition label="Pays" value={`about ${o.validationDays} days after the order, once the shop confirms it`} />
            <Condition label="Minimum order" value={o.minSpendCents > 0 ? formatEuros(o.minSpendCents) : "none"} />
            <Condition label="Cap per order" value={o.capCents ? formatEuros(o.capCents) : "none"} />
            <Condition label="Who" value={o.newCustomersOnly ? `new customers of ${o.merchant.name} only` : "every member"} />
            {o.endsAt ? <Condition label="Until" value={formatDate(o.endsAt)} /> : null}
          </View>
        </Card>
        <View style={wide ? styles.sideWide : null}>
          <Card style={styles.side}>
            {activation ? (
              <View>
                <T variant="section" role="heading" level={2}>
                  Activated at {formatRate({ ...o, rateBps: activation.rateBps })}
                </T>
                <T variant="body" muted style={styles.sideText}>
                  This rate is locked for this click. Buy in the same visit; a new purchase later needs a new activation.
                </T>
                <ExternalLink href={activation.trackingUrl} label={`Continue to ${o.merchant.name}`} style={styles.continue}>
                  Continue to {o.merchant.name} ›
                </ExternalLink>
              </View>
            ) : (
              <View>
                <T variant="section" role="heading" level={2}>
                  Before you buy
                </T>
                <T variant="body" muted style={styles.sideText}>
                  Activating records the click and the rate in force, then takes you to {o.merchant.name}. The cashback shows in your pot once the shop reports the order, usually within two days.
                </T>
                {activate.isError ? (
                  <View role="alert" style={styles.alert}>
                    <T variant="body" style={{ color: colors.negative }}>
                      {activate.error.message}
                    </T>
                  </View>
                ) : null}
                <Button label="Activate and shop" onPress={() => activate.mutate()} busy={activate.isPending} />
              </View>
            )}
          </Card>
          <Card pad={false} style={styles.mine}>
            <CardTitle right={mine.length > 0 ? <T variant="small">{`${mine.length} click${mine.length === 1 ? "" : "s"}`}</T> : undefined}>Your activations</CardTitle>
            {mine.length === 0 ? (
              <T variant="body" muted style={styles.mineEmpty}>
                {activations.isPending ? "Loading…" : "You have not activated this offer yet. A purchase only earns cashback after an activation, so activate before each order."}
              </T>
            ) : (
              <View role="list" aria-label="Your activations">
                {mine.slice(0, 5).map((a, i, all) => (
                  <View key={a.id} role="listitem" style={[styles.mineRow, i === all.length - 1 ? null : styles.rule]}>
                    <View style={styles.mineText}>
                      <T variant="body">{formatDate(a.activatedAt)}</T>
                      <T variant="small">{a.boosted ? "during a boost" : "at the base rate"} · cashback on the order that followed this click</T>
                    </View>
                    <Money variant="body">{formatRate({ ...o, rateBps: a.rateBps })}</Money>
                  </View>
                ))}
              </View>
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}

function Condition({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.condition}>
      <T variant="body" muted style={styles.conditionLabel}>
        {label}
      </T>
      <T variant="body" style={styles.conditionValue}>
        {value}
      </T>
    </View>
  );
}

export type { OfferDetailRow };

const styles = StyleSheet.create({
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  main: {},
  mainWide: { flex: 1 },
  side: {},
  sideWide: { width: 360 },
  rateRow: { flexDirection: "row", alignItems: "center" },
  rateText: { marginLeft: 14, flex: 1 },
  description: { marginTop: 20 },
  conditions: { marginTop: 20 },
  condition: { flexDirection: "row", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.rule },
  conditionLabel: { width: 128 },
  conditionValue: { flex: 1 },
  sideText: { marginTop: 8, marginBottom: 16 },
  continue: { fontSize: 16, lineHeight: 22 },
  alert: { marginBottom: 12 },
  mine: { marginTop: space.pad },
  mineEmpty: { paddingHorizontal: space.card, paddingBottom: space.card },
  mineRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, paddingHorizontal: space.card, paddingVertical: 8 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  mineText: { flex: 1, minWidth: 0, marginRight: 12 },
});
