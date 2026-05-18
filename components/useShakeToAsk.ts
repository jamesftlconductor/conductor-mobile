// Shake-to-ask hook. Subscribes to expo-sensors Accelerometer when
// AsyncStorage's `shakeEnabled` is true. On shake detection (magnitude
// > SHAKE_THRESHOLD, debounced via SHAKE_TIMEOUT) the supplied
// callback fires. Unsubscribes on unmount.
//
// Defensive native-module require: this hook runs in an OTA-shipped
// JS bundle that may be loaded on a binary built before expo-sensors
// was linked. A top-level `import { Accelerometer } from 'expo-sensors'`
// would throw at module-evaluation time on that binary, taking the
// whole app down. We defer the require until use and swallow failures.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';

const SHAKE_THRESHOLD = 2.5;
const SHAKE_TIMEOUT = 1000;
const SAMPLE_INTERVAL_MS = 100;

function loadAccelerometer(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-sensors');
    return mod?.Accelerometer || null;
  } catch {
    return null;
  }
}

export function useShakeToAsk(onShake: () => void) {
  const cbRef = useRef(onShake);
  cbRef.current = onShake;
  const lastShakeRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;

    (async () => {
      try {
        const enabled = await AsyncStorage.getItem('shakeEnabled');
        if (cancelled || enabled === 'false') return;
        const Accelerometer = loadAccelerometer();
        if (!Accelerometer) return; // module unavailable in this binary
        Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
        subscription = Accelerometer.addListener((data: { x: number; y: number; z: number }) => {
          const { x, y, z } = data;
          const magnitude = Math.sqrt(x * x + y * y + z * z);
          if (magnitude > SHAKE_THRESHOLD) {
            const now = Date.now();
            if (now - lastShakeRef.current > SHAKE_TIMEOUT) {
              lastShakeRef.current = now;
              try { cbRef.current(); } catch { /* swallow */ }
            }
          }
        });
      } catch {
        // Sensors unavailable — silently no-op.
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
}
