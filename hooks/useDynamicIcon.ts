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

// Background colors mirror assets/icons/ICON_SPECS.md so the
// placeholder swatches in the selector + suggestion sheet read
// correctly even before final PNG assets land.
export const ICON_COLORS: Record<IconKey, string> = {
  january:   '#0D1B2A',
  february:  '#2D1B2E',
  march:     '#0D2137',
  april:     '#1A2E1A',
  may:       '#1A4A4A',
  june:      '#1C1C1C',
  july:      '#8B2500',
  august:    '#0A1628',
  september: '#2D1F00',
  october:   '#0A1628',
  november:  '#2D1800',
  december:  '#1A3D2B',
  founding:  '#0f0f0f',
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
