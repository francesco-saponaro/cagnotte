import { addBoostBody } from "@cagnotte/contracts";
import type { OfferStatus } from "@cagnotte/domain";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useMoveOffer } from "../api/ops-queries";
import { useOffer } from "../api/queries";
import type { BoostRow, OfferDetailRow } from "../api/types";
import { formatDate, formatEuros, formatRate } from "../ui/format";
import { check, errorsFrom, type FieldErrors } from "../ui/form";
import { Button, Card, CardTitle, Empty, Failed, Field, Loading, Pill, T } from "../ui/primitives";
import { Screen, TitleRow, useWide } from "../ui/screen";
import { colors, space } from "../ui/tokens";
import { OFFER_TONE } from "./catalogue";
import { parseDay } from "./claim-new";
import { OfferForm, parsePercent, valuesOf } from "./offer-form";

/*
 * One offer as the manager works it: where it stands and the moves its state allows, the rate in
 * force this minute and the boost behind it, the fields to edit, and the boosts with their
 * windows. A move the state machine forbids or a boost that overlaps comes back as the API's own
 * sentence; nothing here decides what is allowed.
 */

/** The moves the offer state machine allows from each state, as the buttons to show. */
export const MOVES: Record<OfferStatus, { kind: "publish" | "pause" | "resume" | "end"; label: string }[]> = {
  draft: [{ kind: "publish", label: "Publish" }],
  live: [
    { kind: "pause", label: "Pause" },
    { kind: "end", label: "End" },
  ],
  paused: [
    { kind: "resume", label: "Resume" },
    { kind: "end", label: "End" },
  ],
  ended: [],
};

const STANDING: Record<OfferStatus, string> = {
  draft: "A draft: members cannot see it until it is published.",
  live: "Live: members can activate it.",
  paused: "Paused: hidden from members; the cashbacks already booked are unaffected.",
  ended: "Ended: it cannot come back; create a new offer instead.",
};

/** "9 % in force now, boosted from 6 % until 20 nov. 2026" or "6 % in force now, the base rate". */
export function inForceLine(o: OfferDetailRow, now = new Date()): string {
  if (o.rateKind === "fixed") return `${formatEuros(o.fixedCents)} on each qualifying order.`;
  const base = formatRate(o);
  const inForce = formatRate({ ...o, rateBps: o.rateInForce.rateBps });
  if (!o.rateInForce.boosted) return `${inForce} in force now, the base rate.`;
  const boost = o.boosts.find((b) => b.rateBps === o.rateInForce.rateBps && new Date(b.startsAt).getTime() <= now.getTime() && new Date(b.endsAt).getTime() > now.getTime());
  return `${inForce} in force now, boosted from ${base}${boost ? ` until ${formatDate(boost.endsAt)}` : ""}.`;
}

export function OfferEditScreen({ id }: { id: string }) {
  const wide = useWide();
  const offer = useOffer(id);
  const move = useMoveOffer(id);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (offer.isPending) {
    return (
      <Screen>
        <TitleRow title="Offer" back="/catalogue" />
        <Card>
          <Loading rows={4} height={24} />
        </Card>
      </Screen>
    );
  }
  if (offer.isError) {
    return (
      <Screen>
        <TitleRow title="Offer" back="/catalogue" />
        <Card>
          <Failed message={offer.error.message} onRetry={() => void offer.refetch()} />
        </Card>
      </Screen>
    );
  }

  const o = offer.data;
  const moves = MOVES[o.status];
  const doMove = (kind: (typeof moves)[number]["kind"]) => {
    setMoveError(null);
    move.mutate({ kind }, { onError: (error) => setMoveError(errorsFrom(error, []).form) });
  };

  return (
    <Screen>
      <TitleRow title={`${o.merchant.name}: ${o.title.replace(new RegExp(`^${o.merchant.name}:\\s*`), "")}`} back="/catalogue" line={inForceLine(o)} />
      <Card style={styles.head}>
        <View style={styles.standing}>
          <Pill tone={OFFER_TONE[o.status]}>{o.status}</Pill>
          <T variant="body" style={styles.standingText}>
            {STANDING[o.status]}
          </T>
        </View>
        {moves.length > 0 ? (
          <View style={styles.moves}>
            {moves.map((m, i) => (
              <Button key={m.kind} label={m.label} kind={i === 0 ? "primary" : "secondary"} onPress={() => doMove(m.kind)} busy={move.isPending && move.variables?.kind === m.kind} />
            ))}
          </View>
        ) : null}
        {moveError ? (
          <View role="alert" style={styles.alert}>
            <T variant="body" style={{ color: colors.negative }}>
              {moveError}
            </T>
          </View>
        ) : null}
      </Card>
      <View style={[styles.grid, wide ? styles.gridWide : null]}>
        <Card style={wide ? styles.formWide : null}>
          <T variant="section" role="heading" level={2} style={styles.sectionTitle}>
            The offer
          </T>
          <OfferForm
            key={o.updatedAt}
            mode="edit"
            initial={valuesOf(o)}
            submitLabel="Save the offer"
            busy={move.isPending && move.variables?.kind === "update"}
            onSubmit={async (wire) => {
              setSaved(false);
              const { merchantId: _merchantId, ...body } = wire;
              await move.mutateAsync({ kind: "update", body });
              setSaved(true);
            }}
          />
          {saved ? (
            <T variant="small" style={styles.saved}>
              Saved.
            </T>
          ) : null}
        </Card>
        <View style={wide ? styles.sideWide : null}>
          <Boosts offer={o} onAdd={(body) => move.mutateAsync({ kind: "boost", body }).then(() => undefined)} busy={move.isPending && move.variables?.kind === "boost"} />
        </View>
      </View>
    </Screen>
  );
}

function Boosts({ offer, onAdd, busy }: { offer: OfferDetailRow; onAdd: (body: { rateBps: number; startsAt: string; endsAt: string }) => Promise<void>; busy: boolean }) {
  const [rate, setRate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const boosts = [...offer.boosts].sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const submit = async () => {
    setFormError(null);
    const own: FieldErrors = {};
    const bps = parsePercent(rate);
    if (bps === null) own["rateBps"] = "a percentage like 9 or 12,5";
    const starts = parseDay(startsAt);
    if (!starts) own["startsAt"] = "a date like 2026-12-01";
    const ends = parseDay(endsAt);
    if (!ends) own["endsAt"] = "a date like 2026-12-08";
    const checked = check(addBoostBody, { rateBps: bps ?? -1, startsAt: starts ?? new Date(NaN), endsAt: ends ?? new Date(NaN) });
    const merged = { ...checked.errors, ...own };
    setErrors(merged);
    if (!checked.ok || Object.keys(own).length > 0) return;
    try {
      await onAdd({ rateBps: checked.data.rateBps, startsAt: checked.data.startsAt.toISOString(), endsAt: checked.data.endsAt.toISOString() });
      setRate("");
      setStartsAt("");
      setEndsAt("");
    } catch (error) {
      const { form, fields } = errorsFrom(error, ["rateBps", "startsAt", "endsAt"]);
      setErrors(fields);
      setFormError(form);
    }
  };

  return (
    <Card pad={false}>
      <CardTitle>Boosts</CardTitle>
      {offer.rateKind === "fixed" ? (
        <View style={styles.boostsPad}>
          <Empty>A fixed-amount offer has no rate to boost.</Empty>
        </View>
      ) : (
        <>
          {boosts.length === 0 ? (
            <View style={styles.boostsPad}>
              <Empty>No boost yet. A boost raises the rate for a window; windows cannot overlap, and a click during one locks the boosted rate.</Empty>
            </View>
          ) : (
            boosts.map((b, i) => <BoostLine key={b.id} boost={b} last={i === boosts.length - 1} />)
          )}
          <View style={styles.boostForm}>
            <T variant="body" weight={500} style={styles.boostFormTitle}>
              Add a boost
            </T>
            <Field label="Boost rate" value={rate} onChangeText={setRate} error={errors["rateBps"]} placeholder="9" keyboardType="decimal-pad" hint={`Above the base rate of ${formatRate(offer)}.`} right={<T variant="body">%</T>} />
            <Field label="Boost starts" value={startsAt} onChangeText={setStartsAt} error={errors["startsAt"]} placeholder="2026-12-01" autoCapitalize="none" />
            <Field label="Boost ends" value={endsAt} onChangeText={setEndsAt} error={errors["endsAt"]} placeholder="2026-12-08" autoCapitalize="none" hint="The day it ends, excluded: two boosts can touch." />
            {formError ? (
              <View role="alert" style={styles.alert}>
                <T variant="body" style={{ color: colors.negative }}>
                  {formError}
                </T>
              </View>
            ) : null}
            <Button label="Add the boost" kind="secondary" onPress={() => void submit()} busy={busy} style={styles.boostSubmit} />
          </View>
        </>
      )}
    </Card>
  );
}

function BoostLine({ boost, last }: { boost: BoostRow; last: boolean }) {
  const now = Date.now();
  const on = new Date(boost.startsAt).getTime() <= now && new Date(boost.endsAt).getTime() > now;
  const past = new Date(boost.endsAt).getTime() <= now;
  return (
    <View style={[styles.boostLine, last ? null : styles.rule]}>
      <View style={styles.boostText}>
        <T variant="body" weight={500} num>
          {formatRate({ rateKind: "percent", rateBps: boost.rateBps, fixedCents: 0 })} from {formatDate(boost.startsAt)} to {formatDate(boost.endsAt)}
        </T>
        <T variant="small">{on ? "on now" : past ? "over" : "coming"}</T>
      </View>
      {on ? <Pill tone="hue">in force</Pill> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { marginBottom: space.pad },
  standing: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  standingText: { flex: 1, minWidth: 200 },
  moves: { flexDirection: "row", gap: 8, marginTop: 16 },
  alert: { marginTop: 12 },
  grid: { gap: space.pad },
  gridWide: { flexDirection: "row", alignItems: "flex-start" },
  formWide: { flex: 1, minWidth: 0 },
  sideWide: { width: 380 },
  sectionTitle: { marginBottom: 16 },
  saved: { marginTop: 10, color: colors.positive },
  boostsPad: { paddingHorizontal: space.card, paddingBottom: 8 },
  boostLine: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.card, paddingVertical: 12 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.rule },
  boostText: { flex: 1, minWidth: 0 },
  boostForm: { padding: space.card, borderTopWidth: 1, borderTopColor: colors.rule },
  boostFormTitle: { marginBottom: 12 },
  boostSubmit: { alignSelf: "flex-start" },
});
