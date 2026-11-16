import { Geist_400Regular, Geist_500Medium, Geist_700Bold, useFonts } from "@expo-google-fonts/geist";
import { Link, Slot, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppProviders, type AppDeps } from "@/app-context";
import { buildDeps } from "@/deps";
import type { Nav } from "@/ui/nav";
import { colors } from "@/ui/tokens";

/*
 * The root: fonts, the app's wiring, and the session read from storage before any screen decides
 * where to send the member. Navigation is the router behind the `Nav` interface the screens use.
 */

const nav: Nav = {
  push: (href) => router.push(href as never),
  replace: (href) => router.replace(href as never),
  back: () => (router.canGoBack() ? router.back() : router.replace("/offers" as never)),
  // The router's Link merges its props into the child; a child with an array of styles breaks that
  // merge on the web, so the style is flattened first.
  Link: ({ href, children, style, testID, ...rest }) => (
    <Link href={href as never} asChild>
      <Pressable role="link" aria-label={rest["aria-label"]} aria-current={rest["aria-current"]} style={StyleSheet.flatten(style)} {...(testID ? { testID } : {})}>
        {children}
      </Pressable>
    </Link>
  ),
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_700Bold });
  const deps = useMemo<AppDeps>(() => buildDeps(nav), []);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    void deps.session.load().finally(() => setSessionLoaded(true));
  }, [deps]);

  if (!(fontsLoaded || fontError) || !sessionLoaded) return <View style={styles.blank} />;

  return (
    <AppProviders {...deps}>
      <View style={styles.root}>
        <Slot />
      </View>
      <StatusBar style="dark" />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.ground },
  root: { flex: 1, backgroundColor: colors.ground },
});
