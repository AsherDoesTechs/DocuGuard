import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { Appearance, ColorSchemeName } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  LightColors,
  DarkColors,
  ColorScheme,
  ThemeMode,
} from "@/constants/colors";

interface ThemeContextType {
  colors: ColorScheme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  isDark: boolean;
  toggleTheme: () => Promise<void>;
  mounted: boolean;
}

const THEME_STORAGE_KEY = "docuguard.theme.mode";

const ThemeContext = createContext<ThemeContextType | null>(null);

function isValidThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [systemColorScheme, setSystemColorScheme] =
    useState<ColorSchemeName | null>(Appearance.getColorScheme() ?? null);
  const [mounted, setMounted] = useState(false);

  // Keep track of Android/iOS system appearance changes.
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemColorScheme(colorScheme);
    });

    return () => subscription.remove();
  }, []);

  // Restore the user's saved preference when the provider mounts.
  useEffect(() => {
    let active = true;

    const loadTheme = async () => {
      try {
        const stored = await SecureStore.getItemAsync(THEME_STORAGE_KEY);

        if (active && isValidThemeMode(stored)) {
          setThemeModeState(stored);
        }
      } catch (error) {
        console.warn("Failed to load theme preference:", error);
      } finally {
        if (active) {
          setMounted(true);
        }
      }
    };

    void loadTheme();

    return () => {
      active = false;
    };
  }, []);

  // Resolve the selected mode into the actual color palette.
  const isDark =
    themeMode === "dark" ||
    (themeMode === "system" && systemColorScheme === "dark");

  const colors: ColorScheme = isDark ? DarkColors : LightColors;

  // Update the UI immediately, then persist the preference.
  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);

    try {
      await SecureStore.setItemAsync(THEME_STORAGE_KEY, mode);
    } catch (error) {
      console.warn("Failed to save theme preference:", error);
    }
  }, []);

  const toggleTheme = useCallback(async () => {
    const nextMode: ThemeMode = isDark ? "light" : "dark";
    await setThemeMode(nextMode);
  }, [isDark, setThemeMode]);

  const contextValue = useMemo(
    () => ({
      colors,
      themeMode,
      setThemeMode,
      isDark,
      toggleTheme,
      mounted,
    }),
    [colors, themeMode, setThemeMode, isDark, toggleTheme, mounted],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}

export function useColors(): ColorScheme {
  const { colors, mounted } = useTheme();

  if (!mounted) {
    return LightColors;
  }

  return colors;
}

export function useThemeMode(): {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
} {
  const { themeMode, setThemeMode } = useTheme();

  return { themeMode, setThemeMode };
}

export function useIsDark(): boolean {
  const { isDark, mounted } = useTheme();

  if (!mounted) {
    return false;
  }

  return isDark;
}
