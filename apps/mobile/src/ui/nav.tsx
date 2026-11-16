import { createContext, useContext, type ComponentType, type PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/*
 * Navigation as the screens see it: push a path, go back, or render a link. The root layout
 * provides the router's implementation; the tests provide one that records where the screen wanted
 * to go. Screens never import the router themselves.
 */

export interface LinkProps extends PropsWithChildren {
  href: string;
  style?: StyleProp<ViewStyle>;
  "aria-label"?: string;
  /** "page" on the destination the screen is under. */
  "aria-current"?: "page" | undefined;
  testID?: string;
}

export interface Nav {
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  Link: ComponentType<LinkProps>;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ nav, children }: PropsWithChildren<{ nav: Nav }>) {
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav needs a NavProvider above it");
  return nav;
}
