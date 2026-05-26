// Feature-discovery state. Dimming/intro pattern: a feature renders
// at 45% opacity until the user taps it once and reads the intro,
// then permanently lights up to 100% for that device.
//
// Backed by AsyncStorage keys `discovered:{featureId}`. Default state
// while AsyncStorage is being read is `true` (no dimming) so already-
// discovered users don't see a flash. First-install users with no
// key present flip to `false` once the read resolves.

import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useDiscovered(featureId: string): [boolean, () => void] {
  const [discovered, setDiscovered] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(`discovered:${featureId}`).then((val) => {
      if (val === null) setDiscovered(false);
      else setDiscovered(val === 'true');
    });
  }, [featureId]);

  const markDiscovered = async () => {
    await AsyncStorage.setItem(`discovered:${featureId}`, 'true');
    setDiscovered(true);
  };

  return [discovered, markDiscovered];
}
