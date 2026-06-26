// Shake-to-ask hook. Subscribes to expo-sensors Accelerometer when
// AsyncStorage's `shakeEnabled` is true. On shake detection (magnitude
// > SHAKE_THRESHOLD, debounced via SHAKE_TIMEOUT) the supplied
// callback fires. Unsubscribes on unmount.
//
// IMPORTANT: the accelerometer only listens while the app is FOREGROUND and
// ACTIVE, and only after a short settle delay following each foreground
// transition. Unlocking or picking up the phone produces a sharp jolt that
// easily clears SHAKE_THRESHOLD — if we listened through the lock/unlock
// transition that motion would spuriously fire the callback (e.g. the
// Conductor sheet popping open on unlock). Pausing on background + delaying
// re-subscription on foreground makes the sheet open ONLY on a deliberate
// shake while the user is actively using the app.
//
// Defensive native-module require: this hook runs in an OTA-shipped
// JS bundle that may be loaded on a binary built before expo-sensors
// was linked. A top-level `import { Accelerometer } from 'expo-sensors'`
// would throw at module-evaluation time on that binary, taking the
// whole app down. We defer the require until use and swallow failures.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

const SHAKE_THRESHOLD = 2.5;
const SHAKE_TIMEOUT = 1000;
const SAMPLE_INTERVAL_MS = 100;
// Grace period after the app becomes active before the accelerometer starts
// listening — long enough that the unlock/pickup motion has settled.
const FOREGROUND_SETTLE_MS = 1500;

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
    let enabled = false;
    let Accelerometer: any = null;
    let subscription: { remove: () => void } | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    function unsubscribe() {
      subscription?.remove();
      subscription = null;
    }

    function subscribe() {
      if (cancelled || !enabled || subscription || !Accelerometer) return;
      // Arm the debounce so even the first post-settle sample can't fire
      // immediately — a deliberate shake will still clear it a beat later.
      lastShakeRef.current = Date.now();
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
    }

    function scheduleSubscribe() {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(subscribe, FOREGROUND_SETTLE_MS);
    }

    (async () => {
      try {
        const v = await AsyncStorage.getItem('shakeEnabled');
        if (cancelled || v === 'false') return;
        enabled = true;
        Accelerometer = loadAccelerometer();
        if (!Accelerometer) return; // module unavailable in this binary
        // Only start listening if we're already foreground/active; otherwise
        // the AppState listener below will arm it when we next become active.
        if (AppState.currentState === 'active') scheduleSubscribe();
      } catch {
        // Sensors unavailable — silently no-op.
      }
    })();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // Foreground: wait out the unlock/pickup motion before listening.
        scheduleSubscribe();
      } else {
        // Background/inactive (locking, app switcher): stop listening so the
        // lock/unlock transition motion never reaches the callback.
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        unsubscribe();
      }
    });

    return () => {
      cancelled = true;
      if (settleTimer) clearTimeout(settleTimer);
      unsubscribe();
      appStateSub.remove();
    };
  }, []);
}
