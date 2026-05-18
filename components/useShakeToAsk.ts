// Shake-to-ask hook. Subscribes to expo-sensors Accelerometer when
// AsyncStorage's `shakeEnabled` is true. On shake detection (magnitude
// > SHAKE_THRESHOLD, debounced via SHAKE_TIMEOUT) the supplied
// callback fires. Unsubscribes on unmount.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Accelerometer, type Subscription } from 'expo-sensors';
import { useEffect, useRef } from 'react';

const SHAKE_THRESHOLD = 2.5;
const SHAKE_TIMEOUT = 1000;
const SAMPLE_INTERVAL_MS = 100;

export function useShakeToAsk(onShake: () => void) {
  const cbRef = useRef(onShake);
  cbRef.current = onShake;
  const lastShakeRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let subscription: Subscription | null = null;

    (async () => {
      try {
        const enabled = await AsyncStorage.getItem('shakeEnabled');
        if (cancelled || enabled === 'false') return;
        Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
        subscription = Accelerometer.addListener(({ x, y, z }) => {
          const magnitude = Math.sqrt(x * x + y * y + z * z);
          if (magnitude > SHAKE_THRESHOLD) {
            const now = Date.now();
            if (now - lastShakeRef.current > SHAKE_TIMEOUT) {
              lastShakeRef.current = now;
              cbRef.current();
            }
          }
        });
      } catch {
        // Sensors unavailable on simulator — silently no-op.
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
}
