import { Platform, type TextStyle } from "react-native";

/*
 * The app's look, in one place. No colour in the chrome: the ground is a blue-grey one step off
 * white, cards are white, text is ink, the one hue marks the money that is available, and status is
 * a pale pill. Figures are tabular everywhere so columns of money line up digit for digit.
 */

export const colors = {
  ground: "#f2f4f7",
  surface: "#ffffff",
  raised: "#eef0f3",
  active: "#e4e7eb",
  border: "#e3e6ea",
  rule: "#eef0f3",
  control: "#cfd4da",
  text: "#0a0a0a",
  muted: "#5f6368",
  faint: "#6b6b6b",
  primary: "#141414",
  onPrimary: "#ffffff",
  /** The one hue: the available money in the pot. */
  hue: "#1d5fbf",
  hueInk: "#143f80",
  /** The other buckets of the pot, drawn without colour. */
  pending: "#9aa3ad",
  reserved: "#4b5563",
  paid: "#d6dae0",
  positive: "#247b50",
  negative: "#c4242a",
  pill: {
    positive: { bg: "#dcfae5", ink: "#04250e" },
    negative: { bg: "#ffedea", ink: "#831c1e" },
    warning: { bg: "#fffbeb", ink: "#92400e" },
    neutral: { bg: "#eceef1", ink: "#3d3d3d" },
    hue: { bg: "#e3ecfa", ink: "#143f80" },
  },
} as const;

export const radius = { card: 8, control: 6, chip: 4 } as const;

export const space = { gap: 12, pad: 24, card: 20, row: 44, control: 36, nav: 48 } as const;

export const size = { title: 24, section: 16, kpi: 30, body: 14, small: 13, pill: 12 } as const;

/** The column at desktop width and where the shell folds to the phone layout. */
export const layout = { column: 1088, fold: 900 } as const;

export type Weight = 400 | 500 | 700;

/** Geist, one file per weight, loaded by name on every platform by the root layout. */
export const FAMILY: Record<Weight, string> = { 400: "Geist_400Regular", 500: "Geist_500Medium", 700: "Geist_700Bold" };

/** The one typeface at a weight. The web build also states the weight for the fallback faces. */
export function font(weight: Weight = 400): TextStyle {
  if (Platform.OS === "web") return { fontFamily: `${FAMILY[weight]}, Inter, system-ui, sans-serif`, fontWeight: String(weight) as TextStyle["fontWeight"] };
  return { fontFamily: FAMILY[weight] };
}

export const tabular: TextStyle = { fontVariant: ["tabular-nums"] };
