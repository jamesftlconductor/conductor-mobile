// One-time tutorial tips ("Got it" tooltips). Shown at most once, ever.
//
// Combines two guards so a dismissed tip can never reappear:
//   1. An in-memory session Set — prevents a re-show within the same session
//      even if the host effect (e.g. generateBrief) re-runs before the async
//      AsyncStorage write has landed (the race the earlier fix missed).
//   2. AsyncStorage persistence — prevents a re-show across app launches/days.
//
// markTipShown() is called the moment a tip is shown (not only when "Got it"
// is tapped), so ignoring a tip still retires it.

import AsyncStorage from '@react-native-async-storage/async-storage';

const shownThisSession = new Set<string>();

export async function tipSeen(key: string): Promise<boolean> {
  if (shownThisSession.has(key)) return true;
  try {
    return (await AsyncStorage.getItem(key)) != null;
  } catch {
    return false;
  }
}

export function markTipShown(key: string): void {
  shownThisSession.add(key);
  AsyncStorage.setItem(key, 'done').catch(() => {});
}
