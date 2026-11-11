import { formatEuros } from "@cagnotte/domain";
import { StyleSheet, Text, View } from "react-native";

/** A placeholder until the screens land: proves the app builds and reaches the domain package. */
export default function Index() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Cagnotte</Text>
      <Text style={styles.text}>The app is on its way. Your pot would show as {formatEuros(0)}.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#ffffff" },
  title: { fontSize: 28, fontWeight: "600", color: "#111111" },
  text: { marginTop: 12, fontSize: 16, color: "#444444", textAlign: "center" },
});
