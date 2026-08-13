// lib/theme.tsx
//
// Light/dark theming.
//
// Three modes, not two: "system" is the default and follows the OS, and it
// matters that it's a distinct stored value rather than a snapshot of whatever
// the OS said at first launch. Someone whose phone switches at sunset expects
// the app to switch with it.
//
// Stylesheets are built by a factory rather than at module scope, because
// StyleSheet.create runs once when a file is first imported and would freeze
// whichever palette happened to be current. `useThemedStyles` rebuilds them
// when — and only when — the palette actually changes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { type ColorScheme, type Palette, palettes } from "@/constants/theme";

const STORAGE_KEY = "sweep.theme";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeValue {
  /** What the user picked. */
  mode: ThemeMode;
  /** What that resolves to right now, once "system" is applied. */
  scheme: ColorScheme;
  colors: Palette;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  // Load the stored preference once. Until it arrives the app renders in the
  // system scheme, which is the right guess and also the default.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        if (stored === "light" || stored === "dark" || stored === "system") {
          setModeState(stored);
        }
      })
      .catch(() => {
        // A failed read just means the default. Not worth surfacing.
      });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    // Applied immediately and persisted in the background: the toggle should
    // never feel like it's waiting on disk.
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: ColorScheme = mode === "system" ? (system === "light" ? "light" : "dark") : mode;

  const value = useMemo<ThemeValue>(
    () => ({ mode, scheme, colors: palettes[scheme], setMode }),
    [mode, scheme, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return value;
}

/**
 * Build a screen's stylesheet against the current palette.
 *
 * Pass the module-level factory, not an inline arrow — an inline one is a new
 * function every render, and the memo would never hit.
 *
 *   const styles = useThemedStyles(makeStyles);
 */
export function useThemedStyles<T>(factory: (colors: Palette) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
