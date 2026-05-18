// Security state + biometric helpers. Centralizes:
//   - Face ID / Touch ID availability + enrollment checks
//   - authenticateAsync wrapper around LocalAuthentication
//   - Persisted settings (securityEnabled, lockAfterMinutes,
//     protectSensitive, screenshotProtection, clipboardClear)
//   - lastActiveAt timestamping for the "lock after N minutes"
//     timeout logic
//
// Imports expo-local-authentication via a dynamic require so JS-only
// OTA builds (before the native module ships) don't crash on import.
// All consumers should call isAvailable() first and degrade gracefully.

import AsyncStorage from '@react-native-async-storage/async-storage';

let LocalAuthentication: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  LocalAuthentication = require('expo-local-authentication');
} catch {
  // Native module not in the binary yet — every API below treats
  // this as "not available" and the app continues without biometrics.
  LocalAuthentication = null;
}

const KEY_ENABLED = 'security:enabled';
const KEY_LOCK_AFTER = 'security:lockAfterMinutes';
const KEY_PROTECT = 'security:protectSensitive';
const KEY_SCREENSHOT = 'security:screenshotProtection';
const KEY_CLIPBOARD_CLEAR = 'security:clipboardClear';
const KEY_LAST_ACTIVE = 'security:lastActiveAt';

export type LockAfterMinutes = 1 | 5 | 15 | 30 | 60 | 0; // 0 = never

export const DEFAULTS = {
  enabled: false,
  lockAfterMinutes: 5 as LockAfterMinutes,
  protectSensitive: true,
  screenshotProtection: false,
  clipboardClear: true,
};

export async function isAvailable(): Promise<boolean> {
  if (!LocalAuthentication) return false;
  try {
    return await LocalAuthentication.hasHardwareAsync();
  } catch {
    return false;
  }
}

export async function isEnrolled(): Promise<boolean> {
  if (!LocalAuthentication) return false;
  try {
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

export async function authenticateAsync(promptMessage = 'Authenticate to view sensitive information'): Promise<boolean> {
  if (!LocalAuthentication) return false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: false,
    });
    return !!result?.success;
  } catch {
    return false;
  }
}

// ---- settings storage ----

export async function getSettings() {
  try {
    const [en, lock, prot, scr, clip] = await Promise.all([
      AsyncStorage.getItem(KEY_ENABLED),
      AsyncStorage.getItem(KEY_LOCK_AFTER),
      AsyncStorage.getItem(KEY_PROTECT),
      AsyncStorage.getItem(KEY_SCREENSHOT),
      AsyncStorage.getItem(KEY_CLIPBOARD_CLEAR),
    ]);
    return {
      enabled: en === 'true',
      lockAfterMinutes: lock != null ? (parseInt(lock, 10) as LockAfterMinutes) : DEFAULTS.lockAfterMinutes,
      protectSensitive: prot != null ? prot === 'true' : DEFAULTS.protectSensitive,
      screenshotProtection: scr === 'true',
      clipboardClear: clip != null ? clip === 'true' : DEFAULTS.clipboardClear,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setEnabled(v: boolean) {
  await AsyncStorage.setItem(KEY_ENABLED, v ? 'true' : 'false');
}
export async function setLockAfterMinutes(m: LockAfterMinutes) {
  await AsyncStorage.setItem(KEY_LOCK_AFTER, String(m));
}
export async function setProtectSensitive(v: boolean) {
  await AsyncStorage.setItem(KEY_PROTECT, v ? 'true' : 'false');
}
export async function setScreenshotProtection(v: boolean) {
  await AsyncStorage.setItem(KEY_SCREENSHOT, v ? 'true' : 'false');
}
export async function setClipboardClear(v: boolean) {
  await AsyncStorage.setItem(KEY_CLIPBOARD_CLEAR, v ? 'true' : 'false');
}

// ---- activity tracking ----

export async function touchActive() {
  await AsyncStorage.setItem(KEY_LAST_ACTIVE, String(Date.now()));
}

// Returns true when the user must re-authenticate. A lockAfterMinutes
// of 0 means "Never" — auth is only required once per launch.
export async function isLockedOut(): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.enabled) return false;
  if (settings.lockAfterMinutes === 0) return false;
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_ACTIVE);
    if (!raw) return true;
    const last = parseInt(raw, 10);
    if (!Number.isFinite(last)) return true;
    const elapsedMin = (Date.now() - last) / 60000;
    return elapsedMin >= settings.lockAfterMinutes;
  } catch {
    return true;
  }
}
