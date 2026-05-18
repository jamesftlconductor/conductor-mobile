// Theme system — dark/light + accent color, with system-follow option.
// Persisted to AsyncStorage so the chosen theme survives reloads.
//
// Usage:
//   import { useTheme } from '@/app/theme';
//   const { theme, accentColor, isDark } = useTheme();
//
// Wrap the entire app in <ThemeProvider> at the root (app/_layout.tsx).

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

export const THEMES = {
  dark: {
    background: '#0f0f0f',
    surface: '#1a1a1a',
    card: '#1f1f1f',
    text: '#f5f0eb',
    muted: '#5a5855',
    border: 'rgba(255,255,255,0.08)',
    inputBackground: 'rgba(255,255,255,0.06)',
  },
  light: {
    background: '#faf8f5',
    surface: '#f0ede8',
    card: '#e8e4de',
    text: '#1a1714',
    muted: '#8a8480',
    border: 'rgba(0,0,0,0.08)',
    inputBackground: 'rgba(0,0,0,0.04)',
  },
} as const;

export const ACCENTS = {
  brass:  { dark: '#b8960c', light: '#c47a15', name: 'Brass' },
  amber:  { dark: '#d4820a', light: '#c96a10', name: 'Amber' },
  copper: { dark: '#b85c2c', light: '#a34f22', name: 'Copper' },
  forest: { dark: '#4a7c59', light: '#2d6a4f', name: 'Forest' },
  navy:   { dark: '#4a6fa5', light: '#1e3a5f', name: 'Navy' },
} as const;

export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentKey = keyof typeof ACCENTS;

type ThemeShape = {
  background: string;
  surface: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  inputBackground: string;
};

interface ThemeContextType {
  themeMode: ThemeMode;
  accentKey: AccentKey;
  theme: ThemeShape;
  accentColor: string;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setAccentKey: (key: AccentKey) => void;
}

const defaultContext: ThemeContextType = {
  themeMode: 'dark',
  accentKey: 'brass',
  theme: THEMES.dark,
  accentColor: ACCENTS.brass.dark,
  isDark: true,
  setThemeMode: () => {},
  setAccentKey: () => {},
};

export const ThemeContext = createContext<ThemeContextType>(defaultContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [accentKey, setAccentKeyState] = useState<AccentKey>('brass');

  useEffect(() => {
    // Defensive read — wrap in try/catch so an AsyncStorage failure
    // can't crash the root layout. Defaults stay as 'dark' + 'brass'.
    (async () => {
      try {
        const pairs = await AsyncStorage.multiGet(['conductorTheme', 'conductorAccent']);
        const tm = pairs[0][1];
        const ak = pairs[1][1];
        if (tm === 'dark' || tm === 'light' || tm === 'system') {
          setThemeModeState(tm);
        }
        if (ak && (ak in ACCENTS)) {
          setAccentKeyState(ak as AccentKey);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const isDark = themeMode === 'system' ? systemScheme === 'dark' : themeMode === 'dark';
  const theme = isDark ? THEMES.dark : THEMES.light;
  const accentColor = ACCENTS[accentKey][isDark ? 'dark' : 'light'];

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem('conductorTheme', mode).catch(() => {});
  };
  const setAccentKey = (key: AccentKey) => {
    setAccentKeyState(key);
    AsyncStorage.setItem('conductorAccent', key).catch(() => {});
  };

  return (
    <ThemeContext.Provider
      value={{ themeMode, accentKey, theme, accentColor, isDark, setThemeMode, setAccentKey }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
