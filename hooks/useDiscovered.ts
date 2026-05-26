// Feature-discovery state. Dimming/intro pattern: a feature renders
// at 45% opacity until the user taps it once and reads the intro,
// then permanently lights up to 100% for that device.
//
// Backed by AsyncStorage keys `discovered:{featureId}`. Default state
// while AsyncStorage is being read is `true` (no dimming) so a slow
// disk read doesn't flash dimmed-then-bright on every cold start for
// users who already discovered everything. First-install users
// (no key present) will see a brief flash of "discovered" then flip
// to "undiscovered" once the read resolves — acceptable because the
// AsyncStorage read finishes in ~10ms on a real device.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export function useDiscovered(featureId: string): [boolean, () => Promise<void>] {
  const [discovered, setDiscovered] = useState(true);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(`discovered:${featureId}`)
      .then((val) => {
        if (cancelled) return;
        setDiscovered(val === 'true');
      })
      .catch(() => { /* default to discovered on read failure */ });
    return () => { cancelled = true; };
  }, [featureId]);

  const markDiscovered = async () => {
    try { await AsyncStorage.setItem(`discovered:${featureId}`, 'true'); } catch { /* ignore */ }
    setDiscovered(true);
  };

  return [discovered, markDiscovered];
}
