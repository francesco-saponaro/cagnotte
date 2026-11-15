import type { PropsWithChildren } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { colors, font, size } from "./tokens";

/*
 * A link out of the app: the merchant's tracking URL. On the web it is a real anchor that opens in a
 * new tab with `rel="noopener noreferrer"`, so the merchant's page gets no handle on ours; on a phone
 * it hands the URL to the system.
 */

export function ExternalLink({ href, label, children, style }: PropsWithChildren<{ href: string; label: string; style?: StyleProp<TextStyle> }>) {
  if (Platform.OS === "web") {
    const webProps = { href, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } as Record<string, unknown>;
    return (
      <Text role="link" aria-label={label} style={[styles.text, font(500), style]} {...webProps}>
        {children}
      </Text>
    );
  }
  return (
    <Pressable role="link" aria-label={label} onPress={() => void Linking.openURL(href)}>
      <Text style={[styles.text, font(500), style]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: size.body, lineHeight: 20, color: colors.hueInk },
});
