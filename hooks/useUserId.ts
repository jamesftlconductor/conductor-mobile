// Single source of truth for the current user's userId. Replaces the
// hardcoded `const USER_ID = 'james_totalhome_gmail_com'` that
// previously lived at the top of every screen + hook.
//
// Architecture:
//   - On module load, async-reads AsyncStorage and seeds the cache.
//     Until that read completes, the hook returns null.
//   - useUserId() — reactive hook for components; rerenders when the
//     value changes (e.g. after deep-link onboarding completes).
//   - getUserId() — async getter for non-component code paths
//     (event handlers that already await something).
//   - setUserId() — called by the deep-link handler in _layout.tsx
//     after /api/success returns with the resolved userId.
//   - useUserIdLoaded() — true once the initial AsyncStorage read
//     has finished. Lets the boot guard wait before deciding to
//     redirect to /onboarding so legitimate users aren't bounced
//     during the first 50ms of launch.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

const USER_ID_KEY = 'conductor:userId';
const HOUSEHOLD_ID_KEY = 'conductor:householdId';

let cached: string | null = null;
let cachedHousehold: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

async function initialLoad() {
  try {
    const [v, h] = await Promise.all([
      AsyncStorage.getItem(USER_ID_KEY),
      AsyncStorage.getItem(HOUSEHOLD_ID_KEY),
    ]);
    cached = typeof v === 'string' && v.length > 0 ? v : null;
    cachedHousehold = typeof h === 'string' && h.length > 0 ? h : null;
  } catch {
    cached = null;
    cachedHousehold = null;
  }
  loaded = true;
  emit();
}
initialLoad();

export async function getUserId(): Promise<string | null> {
  if (loaded) return cached;
  try {
    const v = await AsyncStorage.getItem(USER_ID_KEY);
    cached = typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    cached = null;
  }
  loaded = true;
  return cached;
}

export async function setUserId(userId: string): Promise<void> {
  try { await AsyncStorage.setItem(USER_ID_KEY, userId); } catch { /* ignore */ }
  cached = userId;
  loaded = true;
  emit();
}

export async function setHouseholdId(householdId: string): Promise<void> {
  try { await AsyncStorage.setItem(HOUSEHOLD_ID_KEY, householdId); } catch { /* ignore */ }
  cachedHousehold = householdId;
  emit();
}

export async function getHouseholdId(): Promise<string | null> {
  if (loaded) return cachedHousehold;
  try {
    const v = await AsyncStorage.getItem(HOUSEHOLD_ID_KEY);
    cachedHousehold = typeof v === 'string' && v.length > 0 ? v : null;
    return cachedHousehold;
  } catch { return null; }
}

export function useHouseholdId(): string | null {
  return useSyncExternalStore(subscribe, () => cachedHousehold, () => cachedHousehold);
}

export async function clearUserId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_ID_KEY);
    await AsyncStorage.removeItem(HOUSEHOLD_ID_KEY);
  } catch { /* ignore */ }
  cached = null;
  cachedHousehold = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): string | null { return cached; }
function getLoadedSnapshot(): boolean { return loaded; }

export function useUserId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useUserIdLoaded(): boolean {
  return useSyncExternalStore(subscribe, getLoadedSnapshot, getLoadedSnapshot);
}
