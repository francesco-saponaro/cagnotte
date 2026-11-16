import { createOfferBody, updateOfferBody } from "@cagnotte/contracts";
import { parseEuros, percentToBps } from "@cagnotte/domain";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { CreateOfferWire } from "../api/ops-queries";
import type { MerchantRow, OfferRow } from "../api/types";
import { formatEuros, isoDay } from "../ui/format";
import { check, errorsFrom, type FieldErrors } from "../ui/form";
import { Button, Field, Segmented, T } from "../ui/primitives";
import { colors, radius } from "../ui/tokens";
import { parseDay } from "./claim-new";
import { MerchantMark } from "./offers";

/*
 * One form for a new offer and for editing one. The manager writes rates as percentages and
 * amounts in euros; the form turns them into basis points and cents, checks the shape with the
 * API's own schema before sending, and shows the API's words when a rule refuses after. On a new
 * offer the merchant is chosen here; an existing offer keeps its merchant.
 */

const KINDS = [
  { value: "online", label: "Online" },
  { value: "voucher", label: "Voucher" },
] as const;

const RATE_KINDS = [
  { value: "percent", label: "A percentage" },
  { value: "fixed", label: "A fixed amount" },
] as const;

const YES_NO = [
  { value: "no", label: "Everyone" },
  { value: "yes", label: "New customers only" },
] as const;

export interface OfferValues {
  merchantId: string | null;
  kind: "online" | "voucher";
  title: string;
  description: string;
  rateKind: "percent" | "fixed";
  rate: string;
  minSpend: string;
  newCustomersOnly: boolean;
  cap: string;
  validationDays: string;
  startsAt: string;
  endsAt: string;
}

/** "6", "2,5" or "2.5" → basis points; null when it is not a percentage with two decimals at most. */
export function parsePercent(text: string): number | null {
  const cleaned = text.trim().replace(/\s*%$/, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const percent = Number(cleaned);
  if (percent > 100) return null;
  return percentToBps(percent);
}

/** The form as the manager sees an existing offer: cents back to euros, basis points back to a percentage. */
export function valuesOf(offer: OfferRow): OfferValues {
  return {
    merchantId: offer.merchantId,
    kind: offer.kind,
    title: offer.title,
    description: offer.description,
    rateKind: offer.rateKind,
    rate: offer.rateKind === "fixed" ? euros(offer.fixedCents) : String(offer.rateBps / 100).replace(".", ","),
    minSpend: offer.minSpendCents > 0 ? euros(offer.minSpendCents) : "",
    newCustomersOnly: offer.newCustomersOnly,
    cap: offer.capCents === null ? "" : euros(offer.capCents),
    validationDays: String(offer.validationDays),
    startsAt: isoDay(new Date(offer.startsAt)),
    endsAt: offer.endsAt ? isoDay(new Date(offer.endsAt)) : "",
  };
}

/** The figure as the manager would type it: "12,50" from 1250 cents, without the currency or the thousands spaces. */
const euros = (cents: number) => formatEuros(cents).replace(/\s*€$/u, "").replace(/\s/gu, "");

export const EMPTY_VALUES: OfferValues = { merchantId: null, kind: "online", title: "", description: "", rateKind: "percent", rate: "", minSpend: "", newCustomersOnly: false, cap: "", validationDays: "", startsAt: "", endsAt: "" };

export type Read = { ok: true; wire: CreateOfferWire; errors: FieldErrors } | { ok: false; wire: null; errors: FieldErrors };

/** The manager's words into the API's body, with one message per field that could not be read. */
export function readValues(values: OfferValues, mode: "create" | "edit"): Read {
  const own: FieldErrors = {};
  const bps = values.rateKind === "percent" ? parsePercent(values.rate) : 0;
  const fixed = values.rateKind === "fixed" ? parseEuros(values.rate) : 0;
  if (values.rateKind === "percent" && (bps === null || bps === 0)) own.rate = "a percentage like 6 or 2,5";
  if (values.rateKind === "fixed" && (fixed === null || fixed === 0)) own.rate = "an amount in euros, like 5 or 7,50";
  const minSpend = values.minSpend.trim() ? parseEuros(values.minSpend) : 0;
  if (minSpend === null) own.minSpend = "an amount in euros, or nothing";
  const cap = values.cap.trim() ? parseEuros(values.cap) : null;
  if (values.cap.trim() && cap === null) own.cap = "an amount in euros, or nothing";
  const days = /^\d+$/.test(values.validationDays.trim()) ? Number(values.validationDays.trim()) : NaN;
  if (!Number.isInteger(days)) own.validationDays = "a number of days, like 30";
  const starts = parseDay(values.startsAt);
  if (!starts) own.startsAt = "a date like 2026-12-01";
  const ends = values.endsAt.trim() ? parseDay(values.endsAt) : null;
  if (values.endsAt.trim() && !ends) own.endsAt = "a date like 2026-12-31, or nothing";
  if (mode === "create" && !values.merchantId) own.merchantId = "choose the shop";

  const candidate = {
    merchantId: values.merchantId ?? "",
    kind: values.kind,
    title: values.title,
    description: values.description,
    rateKind: values.rateKind,
    rateBps: bps ?? -1,
    fixedCents: fixed ?? -1,
    minSpendCents: minSpend ?? -1,
    newCustomersOnly: values.newCustomersOnly,
    capCents: cap,
    validationDays: Number.isInteger(days) ? days : -1,
    startsAt: starts ?? new Date(NaN),
    endsAt: ends,
  };
  const checked = mode === "create" ? check(createOfferBody, candidate) : check(updateOfferBody, candidate);
  const errors = { ...checked.errors, ...own };
  if (!checked.ok || Object.keys(own).length > 0) return { ok: false, wire: null, errors };
  const data = checked.data;
  return {
    ok: true,
    wire: { ...candidate, ...data, startsAt: (data.startsAt ?? candidate.startsAt).toISOString(), endsAt: data.endsAt ? data.endsAt.toISOString() : null },
    errors: {},
  };
}

const FIELDS = ["merchantId", "kind", "title", "description", "rateKind", "rateBps", "fixedCents", "minSpendCents", "newCustomersOnly", "capCents", "validationDays", "startsAt", "endsAt"];

/** The API's field names back onto the form's. */
const toFormField: Record<string, keyof OfferValues> = { rateBps: "rate", fixedCents: "rate", minSpendCents: "minSpend", capCents: "cap" };

export interface OfferFormProps {
  mode: "create" | "edit";
  initial?: OfferValues;
  /** The shops to choose from, on a new offer. */
  merchants?: MerchantRow[] | undefined;
  submitLabel: string;
  /** Sends the body; a thrown `ApiError` is shown by the form. */
  onSubmit: (wire: CreateOfferWire) => Promise<void>;
  busy?: boolean;
}

export function OfferForm({ mode, initial = EMPTY_VALUES, merchants, submitLabel, onSubmit, busy }: OfferFormProps) {
  const [values, setValues] = useState<OfferValues>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof OfferValues>(key: K) => (value: OfferValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const submit = async () => {
    setFormError(null);
    const read = readValues(values, mode);
    setErrors(read.errors);
    if (!read.ok) return;
    try {
      await onSubmit(read.wire);
    } catch (error) {
      const { form, fields } = errorsFrom(error, FIELDS);
      const mapped: FieldErrors = {};
      for (const [field, message] of Object.entries(fields)) mapped[toFormField[field] ?? field] = message;
      setErrors(mapped);
      setFormError(form);
    }
  };

  return (
    <View>
      {mode === "create" ? (
        <View style={styles.block}>
          <T variant="body" weight={500} style={styles.label}>
            The shop
          </T>
          {merchants && merchants.length > 0 ? (
            <View role="radiogroup" aria-label="The shop" style={styles.choices}>
              {merchants.map((m) => {
                const on = m.id === values.merchantId;
                return (
                  <Pressable key={m.id} role="radio" aria-checked={on} aria-label={m.name} onPress={() => set("merchantId")(m.id)} style={[styles.choice, on ? styles.choiceOn : null]}>
                    <MerchantMark name={m.name} />
                    <View style={styles.choiceText}>
                      <T variant="body" weight={500} numberOfLines={1}>
                        {m.name}
                      </T>
                      <T variant="small" numberOfLines={1}>
                        {m.category} · {m.network} · {m.attributionDays}-day window
                      </T>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <T variant="small">No shop yet; a shop is created with its network and advertiser reference before its first offer.</T>
          )}
          {errors["merchantId"] ? (
            <T variant="small" style={styles.error}>
              {errors["merchantId"]}
            </T>
          ) : null}
        </View>
      ) : null}

      <View style={styles.block}>
        <T variant="body" weight={500} style={styles.label}>
          Kind
        </T>
        <Segmented label="Kind" options={KINDS} value={values.kind} onChange={set("kind")} />
        <T variant="small" style={styles.hint}>
          An online offer tracks the click; a voucher is a code shown to the member.
        </T>
      </View>

      <Field label="Title" value={values.title} onChangeText={set("title")} error={errors["title"]} placeholder="Maison Vernet: 6 % back on everything" />
      <Field label="Description" value={values.description} onChangeText={set("description")} error={errors["description"]} multiline placeholder="What the member gets, and on what." />

      <View style={styles.block}>
        <T variant="body" weight={500} style={styles.label}>
          The cashback
        </T>
        <Segmented label="Rate kind" options={RATE_KINDS} value={values.rateKind} onChange={set("rateKind")} />
      </View>
      <Field
        label="Rate"
        value={values.rate}
        onChangeText={set("rate")}
        error={errors["rate"]}
        hint={values.rateKind === "percent" ? "Of the order, delivery excluded: 6 or 2,5." : "In euros on each qualifying order: 5 or 7,50."}
        placeholder={values.rateKind === "percent" ? "6" : "5,00"}
        keyboardType="decimal-pad"
        right={<T variant="body">{values.rateKind === "percent" ? "%" : "€"}</T>}
      />
      <Field label="Minimum spend" value={values.minSpend} onChangeText={set("minSpend")} error={errors["minSpend"]} hint="In euros; nothing means no minimum." placeholder="0" keyboardType="decimal-pad" right={<T variant="body">€</T>} />
      <Field label="Cap" value={values.cap} onChangeText={set("cap")} error={errors["cap"]} hint="The most one order can earn, in euros; nothing means no cap." placeholder="" keyboardType="decimal-pad" right={<T variant="body">€</T>} />
      <View style={styles.block}>
        <T variant="body" weight={500} style={styles.label}>
          Who it is for
        </T>
        <Segmented label="Who it is for" options={YES_NO} value={values.newCustomersOnly ? "yes" : "no"} onChange={(v) => set("newCustomersOnly")(v === "yes")} />
      </View>
      <Field label="Validation days" value={values.validationDays} onChangeText={set("validationDays")} error={errors["validationDays"]} hint="How long after the order the shop confirms it: the return period." placeholder="30" keyboardType="number-pad" />
      <Field label="Starts" value={values.startsAt} onChangeText={set("startsAt")} error={errors["startsAt"]} placeholder="2026-12-01" autoCapitalize="none" />
      <Field label="Ends" value={values.endsAt} onChangeText={set("endsAt")} error={errors["endsAt"]} hint="Nothing means it runs until it is ended by hand." placeholder="" autoCapitalize="none" />

      {formError ? (
        <View role="alert" style={styles.alert}>
          <T variant="body" style={{ color: colors.negative }}>
            {formError}
          </T>
        </View>
      ) : null}
      <Button label={submitLabel} onPress={() => void submit()} busy={busy} style={styles.submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: 16 },
  label: { marginBottom: 8 },
  hint: { marginTop: 6 },
  choices: { gap: 6 },
  choice: { flexDirection: "row", alignItems: "center", padding: 10, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.text, backgroundColor: colors.raised },
  choiceText: { flex: 1, minWidth: 0, marginLeft: 12 },
  error: { color: colors.negative, marginTop: 6 },
  alert: { marginBottom: 12 },
  submit: { alignSelf: "flex-start" },
});
