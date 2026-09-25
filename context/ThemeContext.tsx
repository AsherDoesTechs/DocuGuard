import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { Appearance, AppearancePreferences, ColorSchemeName } from "react-native";
import * as SecureStore from "expo-secure-store";
import { LightColors, DarkColors, ColorScheme, ThemeMode } from "@/constants/colors";

interface ThemeContextType {
  colors: ColorScheme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  isDark: boolean;
  toggleTheme: () => Promise<void>;
}

const THEME_STORAGE_KEY = "docuguard.theme.mode";

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [colors, setColors] = useState<ColorScheme>(LightColors);
  const [mounted, setMounted] = useState(false);

  const isDark = themeMode === "dark" || (themeMode === "system" && Appearance.getColorScheme() === "dark");

  const applyTheme = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    const effectiveDark = mode === "dark" || (mode === "system" && Appearance.getColorScheme() === "dark");
    setColors(effectiveDark ? DarkColors : LightColors);
  }, []);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const stored = await SecureStore.getItemAsync(THEME_STORAGE_KEY);
        if (stored) {
          applyTheme(stored as ThemeMode);
        } else {
          applyTheme("system");
        }
      } catch {
        applyTheme("system");
      } finally {
        setMounted(true);
      }
    };
    loadTheme();
  }, [applyTheme]);

  useEffect(() => {
    if (themeMode === "system") {
      const subscription = Appearance.addChangeListener(({ colorScheme }) => {
        const effectiveDark = colorScheme === "dark";
        setColors(effectiveDark ? DarkColors : LightColors);
      });
      return () => subscription?.remove();
    }
  }, [themeMode]);

  const setThemeMode = async (mode: ThemeMode) => {
    try {
      await SecureStore.setItemAsync(THEME_STORAGE_KEY, mode);
      applyTheme(mode);
    } catch (error) {
      console.warn("Failed to save theme preference:", error);
    }
  };

  const toggleTheme = async () => {
    const newMode: ThemeMode = isDark ? "light" : "dark";
    await setThemeMode(newMode);
  };

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ colors, themeMode, setThemeMode, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export function useColors(): ColorScheme {
  const { colors } = useTheme();
  return colors;
}

export function useThemeMode(): ThemeMode {
  const { themeMode, setThemeMode } = useTheme();
  return { themeMode, setThemeMode };
}

export function useIsDark(): boolean {
  const { isDark } = useTheme();
  return isDark;
}