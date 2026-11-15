import type { PropsWithChildren, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useNav } from "./nav";
import { T } from "./primitives";
import { colors, font, layout, size, space } from "./tokens";

/*
 * Every screen is a centred column on the ground with one title row: the screen's name as the h1,
 * one grey sentence under it (the finding, the scope), and at most one action on the right.
 */

export function useWide(): boolean {
  return useWindowDimensions().width >= layout.fold;
}

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  const wide = useWide();
  const body = <View style={[styles.column, wide ? styles.columnWide : styles.columnNarrow]}>{children}</View>;
  if (!scroll) return <View style={styles.canvas}>{body}</View>;
  return (
    <ScrollView style={styles.canvas} contentContainerStyle={styles.canvasContent} keyboardShouldPersistTaps="handled">
      {body}
    </ScrollView>
  );
}

export interface TitleRowProps {
  title: string;
  /** One sentence about the data, never about the interface. */
  line?: ReactNode;
  action?: ReactNode;
  /** Where "Back" goes; a plain back when true. */
  back?: string | true;
}

export function TitleRow({ title, line, action, back }: TitleRowProps) {
  const nav = useNav();
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleText}>
        {back ? (
          <Pressable role="link" aria-label="Back" onPress={() => (back === true ? nav.back() : nav.replace(back))} style={styles.back}>
            <Text style={[styles.backText, font(500)]}>‹ Back</Text>
          </Pressable>
        ) : null}
        <T variant="title" role="heading" level={1}>
          {title}
        </T>
        {line ? (
          <T variant="body" muted style={styles.line}>
            {line}
          </T>
        ) : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

/** A section's heading inside the column: 16px, with air above. */
export function SectionTitle({ children, right }: PropsWithChildren<{ right?: ReactNode }>) {
  const wide = useWide();
  return (
    <View style={[styles.sectionRow, right && !wide ? styles.sectionStack : null]}>
      <T variant="section" role="heading" level={2}>
        {children}
      </T>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: colors.ground },
  canvasContent: { flexGrow: 1, paddingBottom: 48 },
  column: { width: "100%", alignSelf: "center" },
  columnWide: { maxWidth: layout.column + 2 * space.pad, paddingHorizontal: space.pad },
  columnNarrow: { paddingHorizontal: 20 },
  titleRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 28, paddingBottom: 20, gap: 16 },
  titleText: { flex: 1, minWidth: 0 },
  line: { marginTop: 6 },
  action: { flexShrink: 0 },
  back: { alignSelf: "flex-start", marginBottom: 8, minHeight: 24, justifyContent: "center" },
  backText: { fontSize: size.body, lineHeight: 20, color: colors.muted },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 32, marginBottom: 12 },
  // On a phone a heading and its filter row stack, so neither is squeezed.
  sectionStack: { flexDirection: "column", alignItems: "stretch", gap: 10 },
});
