import { StyleSheet, Text, View } from "react-native";
import { colors, font } from "./tokens";

/** The product's mark: a pot with a coin dropping in, drawn in ink, and its name. */
export function Wordmark({ size = "small" }: { size?: "small" | "large" }) {
  const large = size === "large";
  const s = large ? 28 : 20;
  return (
    <View style={styles.row} aria-label="Cagnotte" role="img">
      <View style={{ width: s, height: s, alignItems: "center", justifyContent: "flex-end" }}>
        <View style={{ width: s * 0.5, height: s * 0.14, borderRadius: s, backgroundColor: colors.text, marginBottom: s * 0.1 }} />
        <View style={{ width: s, height: s * 0.62, borderBottomLeftRadius: s * 0.3, borderBottomRightRadius: s * 0.3, borderTopLeftRadius: s * 0.08, borderTopRightRadius: s * 0.08, backgroundColor: colors.text }} />
      </View>
      <Text style={[styles.name, font(500), { fontSize: large ? 26 : 18, lineHeight: large ? 32 : 24, marginLeft: large ? 12 : 8 }]}>Cagnotte</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  name: { color: colors.text },
});
