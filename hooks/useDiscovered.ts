// Feature-discovery state. Dimming/intro pattern: a feature renders
// at 45% opacity until the user taps it once and reads the intro,
// then permanently lights up to 100% for that device.
//
// Backed by AsyncStorage keys `discovered:{featureId}`, fronted by a
// module-level cache so every hook instance for the same featureId
// shares one source of truth. This is what makes the discovered
// state survive a remount mid-session — e.g. when the Ground screen
// re-renders as it crosses from Takeoff into Clearance mode, the
// cache already holds `true` so the feature never flickers back to
// dim. markDiscovered updates the cache synchronously (so all live
// instances rerender immediately) and persists to AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// featureId → discovered. undefined = not yet loaded from disk.
const cache: Record<string, boolean | undefined> = {};
const listeners: Record<string, Set<() => void>> = {};

function notify(featureId: string) {
  const set = listeners[featureId];
  if (set) for (const l of set) { try { l(); } catch { /* ignore */ } }
}

function subscribe(featureId: string, cb: () => void) {
  (listeners[featureId] ||= new Set()).add(cb);
  return () => { listeners[featureId]?.delete(cb); };
}

export function useDiscovered(featureId: string): [boolean, () => void] {
  // Seed from the cache when present so a remount doesn't flash. Only
  // fall back to `true` (no-dim) before the very first disk read for
  // this featureId completes.
  const [discovered, setDiscovered] = useState<boolean>(
    cache[featureId] !== undefined ? (cache[featureId] as boolean) : true
  );

  useEffect(() => {
    let cancelled = false;
    const unsub = subscribe(featureId, () => {
      if (!cancelled && cache[featureId] !== undefined) {
        setDiscovered(cache[featureId] as boolean);
      }
    });

    if (cache[featureId] !== undefined) {
      // Already resolved this session — adopt it immediately.
      setDiscovered(cache[featureId] as boolean);
    } else {
      AsyncStorage.getItem(`discovered:${featureId}`).then((val) => {
        if (cancelled) return;
        const resolved = val === null ? false : val === 'true';
        cache[featureId] = resolved;
        setDiscovered(resolved);
        notify(featureId);
      }).catch(() => { /* keep optimistic true on read failure */ });
    }

    return () => { cancelled = true; unsub(); };
  }, [featureId]);

  const markDiscovered = () => {
    cache[featureId] = true;
    setDiscovered(true);
    notify(featureId);
    AsyncStorage.setItem(`discovered:${featureId}`, 'true').catch(() => {});
  };

  return [discovered, markDiscovered];
}
