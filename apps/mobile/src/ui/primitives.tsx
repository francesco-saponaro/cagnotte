import type { PropsWithChildren, ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { useNav } from "./nav";
import { colors, font, radius, size, space, tabular, type Weight } from "./tokens";

/*
 * The few pieces every screen is made of. Nothing here carries colour except the status pills and
 * the one hue on money that is available; emphasis is size and weight.
 */

type TextVariant = "title" | "section" | "kpi" | "body" | "small" | "label";

const VARIANT: Record<TextVariant, TextStyle> = {
  title: { fontSize: size.title, lineHeight: 30, color: colors.text },
  section: { fontSize: size.section, lineHeight: 22, color: colors.text },
  kpi: { fontSize: size.kpi, lineHeight: 36, color: colors.text },
  body: { fontSize: size.body, lineHeight: 20, color: colors.text },
  small: { fontSize: size.small, lineHeight: 18, color: colors.muted },
  label: { fontSize: size.body, lineHeight: 20, color: colors.muted },
};

const DEFAULT_WEIGHT: Record<TextVariant, Weight> = { title: 500, section: 500, kpi: 400, body: 400, small: 400, label: 400 };

export interface TProps extends PropsWithChildren {
  variant?: TextVariant;
  weight?: Weight;
  muted?: boolean;
  /** Tabular figures, for money and counts. */
  num?: boolean;
  align?: "left" | "right" | "center";
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  role?: "heading" | "none";
  level?: 1 | 2 | 3;
  testID?: string;
  /** `data-*` attributes on the web, for tests and the inspector. */
  dataSet?: Record<string, string>;
}

export function T({ variant = "body", weight, muted, num, align, style, children, numberOfLines, role, level, testID, dataSet }: TProps) {
  const extra: TextStyle = { ...(muted ? { color: colors.muted } : {}), ...(align ? { textAlign: align } : {}) };
  return (
    <Text
      style={[VARIANT[variant], font(weight ?? DEFAULT_WEIGHT[variant]), num ? tabular : null, extra, style]}
      {...(numberOfLines !== undefined ? { numberOfLines } : {})}
      {...(role === "heading" ? { role: "heading" as const, "aria-level": level ?? 2 } : {})}
      {...(testID ? { testID } : {})}
      {...(dataSet ? ({ dataSet } as object) : {})}
    >
      {children}
    </Text>
  );
}

/** Money in tabular figures; 700 only when `strong`, which the balance alone uses. */
export function Money({ children, strong, variant = "body", color, style }: PropsWithChildren<{ strong?: boolean; variant?: TextVariant; color?: string; style?: StyleProp<TextStyle> }>) {
  return (
    <T variant={variant} weight={strong ? 700 : DEFAULT_WEIGHT[variant]} num style={[color ? { color } : null, style]}>
      {children}
    </T>
  );
}

export type ButtonKind = "primary" | "secondary" | "text";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({ label, onPress, kind = "primary", disabled, busy, style, testID }: ButtonProps) {
  const off = disabled || busy;
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={off}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [styles.button, styles[`button_${kind}`], pressed && !off ? styles.buttonPressed : null, off ? styles.buttonOff : null, style]}
      {...(testID ? { testID } : {})}
    >
      {busy ? <ActivityIndicator size="small" color={kind === "primary" ? colors.onPrimary : colors.text} /> : null}
      <Text style={[styles.buttonLabel, font(500), kind === "primary" ? styles.buttonLabelPrimary : null, busy ? { marginLeft: 8 } : null]}>{label}</Text>
    </Pressable>
  );
}

/** A link dressed as a button, for an action that opens another screen. */
export function LinkButton({ href, label, kind = "primary", disabled, style }: { href: string; label: string; kind?: ButtonKind; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const { Link } = useNav();
  if (disabled) return <Button label={label} kind={kind} disabled style={style} />;
  return (
    <Link href={href} aria-label={label} style={[styles.button, styles[`button_${kind}`], style]}>
      <Text style={[styles.buttonLabel, font(500), kind === "primary" ? styles.buttonLabelPrimary : null]}>{label}</Text>
    </Link>
  );
}

export type PillTone = "positive" | "negative" | "warning" | "neutral" | "hue";

export function Pill({ children, tone = "neutral" }: PropsWithChildren<{ tone?: PillTone }>) {
  const c = colors.pill[tone];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.pillText, font(500), { color: c.ink }]}>{children}</Text>
    </View>
  );
}

export function Card({ children, style, pad = true }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; pad?: boolean }>) {
  return <View style={[styles.card, pad ? styles.cardPad : null, style]}>{children}</View>;
}

/** The heading of a card that holds a list, inside the card so two columns start level. */
export function CardTitle({ children, right }: PropsWithChildren<{ right?: ReactNode }>) {
  return (
    <View style={styles.cardTitle}>
      <T variant="section" role="heading" level={2}>
        {children}
      </T>
      {right}
    </View>
  );
}

/** A labelled field with its own error line; the label is tied to the input for screen readers. */
export interface FieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  hint?: string;
  error?: string | null;
  right?: ReactNode;
  testID?: string;
}

export function Field({ label, hint, error, right, testID, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <T variant="body" weight={500} style={styles.fieldLabel}>
        {label}
      </T>
      <View style={styles.fieldRow}>
        <TextInput
          {...input}
          aria-label={label}
          aria-invalid={Boolean(error)}
          placeholderTextColor={colors.faint}
          style={[styles.input, font(400), input.multiline ? styles.inputMultiline : null, error ? styles.inputError : null, right ? styles.inputWithRight : null]}
          {...(testID ? { testID } : {})}
        />
        {right}
      </View>
      {error ? (
        <T variant="small" style={styles.fieldError} role="none">
          {error}
        </T>
      ) : hint ? (
        <T variant="small">{hint}</T>
      ) : null}
    </View>
  );
}

/** A row of choices where one is on: the sort, a status filter, a payout method. `scroll` keeps a long row on one line that scrolls sideways. */
export function Segmented<V extends string>({ options, value, onChange, label, scroll }: { options: readonly { value: V; label: string }[]; value: V; onChange: (v: V) => void; label: string; scroll?: boolean }) {
  const row = (
    <View role="radiogroup" aria-label={label} style={[styles.segmented, scroll ? styles.segmentedScroll : null]}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable key={option.value} role="radio" aria-checked={on} aria-label={option.label} onPress={() => onChange(option.value)} style={[styles.segment, on ? styles.segmentOn : null]}>
            <Text style={[styles.segmentText, font(on ? 500 : 400), on ? styles.segmentTextOn : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  if (!scroll) return row;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segmentedScroller}>
      {row}
    </ScrollView>
  );
}

/** "1–20 of 89" with Previous and Next: every list pages on the server; `count` is the rows on this page. */
export function Pager({ page, pageSize, total, count, onPage }: { page: number; pageSize: number; total: number; count: number; onPage: (page: number) => void }) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = first + Math.max(0, count - 1);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <View style={styles.pager}>
      <T variant="small" num>
        {`${first}–${last} of ${total}`}
      </T>
      <View style={styles.pagerButtons}>
        <Button label="Previous" kind="secondary" disabled={page <= 1} onPress={() => onPage(page - 1)} />
        <Button label="Next" kind="secondary" disabled={page >= pages} onPress={() => onPage(page + 1)} style={{ marginLeft: 8 }} />
      </View>
    </View>
  );
}

/** One sentence in the frame where rows would be. */
export function Empty({ children }: PropsWithChildren) {
  return (
    <View style={styles.empty}>
      <T variant="body" muted>
        {children}
      </T>
    </View>
  );
}

/** The error of one block, with what failed and a way to try again. */
export function Failed({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.failed} role="alert">
      <T variant="body" style={{ flex: 1 }}>
        {message}
      </T>
      {onRetry ? <Button label="Retry" kind="text" onPress={onRetry} /> : null}
    </View>
  );
}

/** The final layout with grey bars where the values will land. */
export function Loading({ rows = 3, height = 20 }: { rows?: number; height?: number }) {
  return (
    <View aria-busy aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.bone, { height, width: i % 2 ? "60%" : "85%" }]} />
      ))}
    </View>
  );
}

export const Row = ({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) => <View style={[styles.row, style]}>{children}</View>;

const styles = StyleSheet.create({
  button: { height: space.control, minWidth: 44, paddingHorizontal: 14, borderRadius: radius.control, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  button_primary: { backgroundColor: colors.primary },
  button_secondary: { backgroundColor: colors.active },
  button_text: { backgroundColor: "transparent", paddingHorizontal: 8 },
  buttonPressed: { opacity: 0.8 },
  buttonOff: { opacity: 0.45 },
  buttonLabel: { fontSize: size.body, lineHeight: 20, color: colors.text },
  buttonLabelPrimary: { color: colors.onPrimary },
  pill: { alignSelf: "flex-start", height: 22, paddingHorizontal: 8, borderRadius: radius.chip, justifyContent: "center", flexShrink: 0 },
  pillText: { fontSize: size.pill, lineHeight: 16 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.border },
  cardPad: { padding: space.card },
  cardTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.card, paddingTop: 18, paddingBottom: 10 },
  field: { marginBottom: 16 },
  fieldLabel: { marginBottom: 8 },
  fieldRow: { flexDirection: "row", alignItems: "center" },
  input: { flex: 1, height: 40, borderWidth: 1, borderColor: colors.control, borderRadius: radius.control, paddingHorizontal: 12, fontSize: size.body, color: colors.text, backgroundColor: colors.surface },
  inputWithRight: { marginRight: 8 },
  inputMultiline: { height: 132, paddingTop: 10, textAlignVertical: "top" },
  inputError: { borderColor: colors.negative },
  fieldError: { color: colors.negative, marginTop: 6 },
  segmented: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  segmentedScroll: { flexWrap: "nowrap" },
  segmentedScroller: { flexGrow: 0 },
  segment: { height: 32, paddingHorizontal: 12, borderRadius: radius.control, justifyContent: "center", backgroundColor: colors.raised },
  segmentOn: { backgroundColor: colors.primary },
  segmentText: { fontSize: size.body, lineHeight: 20, color: colors.text },
  segmentTextOn: { color: colors.onPrimary },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 16 },
  pagerButtons: { flexDirection: "row" },
  empty: { paddingVertical: 20 },
  failed: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  bone: { height: 20, backgroundColor: colors.raised, borderRadius: 4, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center" },
});
