// Dynamic monthly icon system — preference + suggestion plumbing.
//
// Actually switching the OS-level app icon requires a native module
// (expo-dynamic-app-icon or equivalent) plus a fresh EAS build with
// CFBundleAlternateIcons declared in Info.plist. Until that lands,
// acceptIconChange only stores the user's selection in AsyncStorage
// so the rest of the UI (selector grid, launch-time suggestion, the
// brief's iconNote) reads consistently. The actual setIcon call is
// gated behind a runtime require so we can add it later without
// changing this file's contract.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const MONTH_ICONS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export type MonthIcon = (typeof MONTH_ICONS)[number];
export type IconKey = MonthIcon | 'founding';

// Final approved monthly icon colors — each month's app-icon background plus
// the logo (C-mark) tint that sits on it. The selector grid + suggestion sheet
// render these as live previews even before the final PNG assets land; the
// OS-level icon swap still requires a native build (see acceptIconChange).
export const MONTH_ICON_COLORS: Record<MonthIcon, { background: string; logoColor: string }> = {
  january:   { background: '#F8F8F8', logoColor: '#C0C0C0' }, // white / silver
  february:  { background: '#FFE4E8', logoColor: '#CC0000' }, // light pink / cherry red
  march:     { background: '#1A5C2A', logoColor: '#4CBB17' }, // forest / kelly green
  april:     { background: '#7B9BB8', logoColor: '#FFD700' }, // blue-grey / lightning yellow
  may:       { background: '#F2D7F5', logoColor: '#7CB99A' }, // lavender / sage
  june:      { background: '#FFFAF0', logoColor: '#DAA520' }, // warm white / deep gold
  july:      { background: '#0A1F5C', logoColor: '#CC0000' }, // navy / red
  august:    { background: '#E8572A', logoColor: '#00CED1' }, // coral / electric teal
  september: { background: '#2D5A27', logoColor: '#F5F5DC' }, // field green / cream
  october:   { background: '#2D1B69', logoColor: '#FF6B00' }, // deep purple / orange
  november:  { background: '#8B4513', logoColor: '#DAA520' }, // terracotta / amber
  december:  { background: '#CC0000', logoColor: '#2D8B2D' }, // red / green
};

// Founding edition isn't a month — give it the house brand pairing.
export const FOUNDING_ICON_COLORS = { background: '#0f0f0f', logoColor: '#b8960c' };

// Resolve the {background, logoColor} pair for any icon key.
export function iconColors(key: IconKey): { background: string; logoColor: string } {
  return key === 'founding' ? FOUNDING_ICON_COLORS : MONTH_ICON_COLORS[key];
}

// Background-only map kept for existing consumers (swatch backgrounds, the
// suggestion sheet). Derived from MONTH_ICON_COLORS so there's one source of truth.
export const ICON_COLORS: Record<IconKey, string> = {
  january:   MONTH_ICON_COLORS.january.background,
  february:  MONTH_ICON_COLORS.february.background,
  march:     MONTH_ICON_COLORS.march.background,
  april:     MONTH_ICON_COLORS.april.background,
  may:       MONTH_ICON_COLORS.may.background,
  june:      MONTH_ICON_COLORS.june.background,
  july:      MONTH_ICON_COLORS.july.background,
  august:    MONTH_ICON_COLORS.august.background,
  september: MONTH_ICON_COLORS.september.background,
  october:   MONTH_ICON_COLORS.october.background,
  november:  MONTH_ICON_COLORS.november.background,
  december:  MONTH_ICON_COLORS.december.background,
  founding:  FOUNDING_ICON_COLORS.background,
};

// Short tag that surfaces alongside the icon — used by both the
// Settings row ("December — Christmas") and the brief's iconNote.
export const ICON_TAGLINES: Record<IconKey, string> = {
  january:   'New year, clean slate',
  february:  'Peak season',
  march:     'Things are changing',
  april:     'Spring',
  may:       'South Florida energy',
  june:      'Watching the Atlantic',
  july:      'Maximum heat',
  august:    'Storm season peak',
  september: 'Routines reasserting',
  october:   'Boat Show month',
  november:  'Household gathering',
  december:  'Christmas',
  founding:  'Founding household',
};

export function getCurrentMonthIcon(): MonthIcon {
  return MONTH_ICONS[new Date().getMonth()];
}

export function getCurrentMonthName(): string {
  return MONTH_NAMES[new Date().getMonth()];
}

export async function getCurrentIcon(): Promise<IconKey> {
  try {
    const stored = await AsyncStorage.getItem('currentIcon');
    if (stored && (MONTH_ICONS as readonly string[]).includes(stored)) return stored as MonthIcon;
    if (stored === 'founding') return 'founding';
  } catch { /* ignore */ }
  return getCurrentMonthIcon();
}

export async function shouldSuggestIconUpdate(): Promise<MonthIcon | null> {
  const expected = getCurrentMonthIcon();
  try {
    const lastIconMonth = await AsyncStorage.getItem('lastIconMonth');
    const declined = await AsyncStorage.getItem(`iconDeclined_${expected}`);
    if (lastIconMonth === expected) return null;
    if (declined === 'true') return null;
  } catch {
    return null;
  }
  return expected;
}

export async function acceptIconChange(iconName: IconKey): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      ['lastIconMonth', iconName],
      ['currentIcon', iconName],
    ]);
  } catch { /* ignore */ }

  // Defensive native-module require — when expo-dynamic-app-icon or
  // similar lands in a future EAS build, this branch fires the real
  // setAlternateIconName call. Wrapped so the OTA bundle doesn't
  // crash on devices that don't have the native module yet.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dyn = require('expo-dynamic-app-icon');
    if (dyn?.setAppIcon) {
      await dyn.setAppIcon(iconName);
    }
  } catch {
    // Module not installed — preference is stored, OS icon stays put.
  }
}

export async function declineIconChange(iconName: IconKey): Promise<void> {
  try {
    await AsyncStorage.setItem(`iconDeclined_${iconName}`, 'true');
  } catch { /* ignore */ }
}

export async function getAutoUpdateEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem('iconAutoUpdate');
    return v !== 'false'; // default true
  } catch {
    return true;
  }
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem('iconAutoUpdate', enabled ? 'true' : 'false');
  } catch { /* ignore */ }
}
