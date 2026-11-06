import { useSyncExternalStore } from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

/**
 * To support static rendering, use a light color scheme during server
 * rendering and the initial client render. After hydration, use the
 * native color scheme.
 */
export function useColorScheme() {
  const colorScheme = useRNColorScheme();

  const hasHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (hasHydrated) {
    return colorScheme;
  }

  return "light";
}