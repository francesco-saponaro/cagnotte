import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../app-context";
import { useNav } from "./nav";
import { useWide } from "./screen";
import { colors, font, layout, size, space } from "./tokens";
import { Wordmark } from "./wordmark";

/*
 * The frame around every signed-in screen. Wide: a 48px bar on the ground with the wordmark on the
 * column's left edge, the destinations as text links and the account at the right end. Phone: the
 * bar keeps the wordmark and the account, and the destinations become a bottom bar of four.
 */

export interface Destination {
  href: string;
  label: string;
  /** The route group this destination owns, to mark it active. */
  matches: (path: string) => boolean;
}

export const MEMBER_DESTINATIONS: Destination[] = [
  { href: "/offers", label: "Offers", matches: (p) => p.startsWith("/offers") },
  { href: "/wallet", label: "Wallet", matches: (p) => p.startsWith("/wallet") },
  { href: "/claims", label: "Claims", matches: (p) => p.startsWith("/claims") },
  { href: "/referrals", label: "Referrals", matches: (p) => p.startsWith("/referrals") },
];

export function Shell({ children, path, destinations = MEMBER_DESTINATIONS, onSignOut }: PropsWithChildren<{ path: string; destinations?: Destination[]; onSignOut: () => void }>) {
  const wide = useWide();
  const { Link } = useNav();
  const session = useSession();
  return (
    <View style={styles.frame}>
      <View style={styles.bar} role="banner">
        <View style={[styles.barInner, wide ? styles.barInnerWide : styles.barInnerNarrow]}>
          <Link href="/offers" aria-label="Cagnotte, home">
            <Wordmark />
          </Link>
          {wide ? (
            <View style={styles.links} role="navigation" aria-label="Main">
              {destinations.map((d) => {
                const active = d.matches(path);
                return (
                  <Link key={d.href} href={d.href} aria-label={d.label} style={[styles.link, active ? styles.linkActive : null]}>
                    <Text style={[styles.linkText, font(500), active ? styles.linkTextActive : null]}>{d.label}</Text>
                  </Link>
                );
              })}
            </View>
          ) : null}
          <View style={styles.account}>
            <Text style={[styles.who, font(400)]} numberOfLines={1}>
              {session.user?.displayName ?? ""}
            </Text>
            <Pressable role="button" aria-label="Sign out" onPress={onSignOut} style={styles.signOut}>
              <Text style={[styles.linkText, font(500)]}>Sign out</Text>
            </Pressable>
          </View>
        </View>
      </View>
      <View style={styles.body}>{children}</View>
      {wide ? null : (
        <View style={styles.tabs} role="navigation" aria-label="Main">
          {destinations.map((d) => {
            const active = d.matches(path);
            return (
              <Link key={d.href} href={d.href} aria-label={d.label} style={styles.tab}>
                <View style={[styles.tabDot, active ? styles.tabDotActive : null]} />
                <Text style={[styles.tabText, font(active ? 500 : 400), active ? styles.tabTextActive : null]}>{d.label}</Text>
              </Link>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.ground },
  bar: { height: space.nav, backgroundColor: colors.ground, borderBottomWidth: 1, borderBottomColor: colors.border },
  barInner: { flex: 1, flexDirection: "row", alignItems: "center", width: "100%", alignSelf: "center" },
  barInnerWide: { maxWidth: layout.column + 2 * space.pad, paddingHorizontal: space.pad },
  barInnerNarrow: { paddingHorizontal: 20 },
  links: { flexDirection: "row", marginLeft: 32, gap: 4 },
  link: { height: 32, paddingHorizontal: 12, borderRadius: 6, justifyContent: "center" },
  linkActive: { backgroundColor: colors.active },
  linkText: { fontSize: size.body, lineHeight: 20, color: colors.muted },
  linkTextActive: { color: colors.text },
  account: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 12 },
  who: { fontSize: size.body, lineHeight: 20, color: colors.muted, maxWidth: 160 },
  signOut: { height: 32, paddingHorizontal: 8, justifyContent: "center" },
  body: { flex: 1 },
  tabs: { height: 60, flexDirection: "row", backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  tabDot: { width: 20, height: 3, borderRadius: 2, backgroundColor: "transparent" },
  tabDotActive: { backgroundColor: colors.text },
  tabText: { fontSize: size.small, lineHeight: 16, color: colors.muted },
  tabTextActive: { color: colors.text },
});
