// Feature-discovery state. Dimming/intro pattern: a feature renders
// at 45% opacity until the user taps it once and reads the intro,
// then permanently lights up to 100% for that device — across every
// brief mode (Takeoff / Clearance / Overwatch) and across restarts.
//
// Backed by AsyncStorage keys `discovered:{featureId}`, fronted by a
// module-level Map cache shared by every hook instance for the same
// featureId. Listeners receive the new boolean so every live instance
// rerenders in lockstep when one marks discovered.
//
// Persistence rule: markDiscovered writes to disk FIRST, then updates
// the cache + notifies. If the write throws it's logged, not
// swallowed, and the cache is left untouched — so a failed write can
// never masquerade as a success (discovered in memory, null on disk).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// featureId → discovered. Absent key = not yet resolved from disk.
const cache = new Map<string, boolean>();
const listeners = new Map<string, Set<(v: boolean) => void>>();

const KNOWN_FEATURE_IDS = ['pulse', 'signals', 'minimap', 'feedback'];

function subscribe(featureId: string, cb: (v: boolean) => void) {
  let set = listeners.get(featureId);
  if (!set) { set = new Set(); listeners.set(featureId, set); }
  set.add(cb);
  return () => { listeners.get(featureId)?.delete(cb); };
}

function emit(featureId: string, v: boolean) {
  const set = listeners.get(featureId);
  if (set) for (const fn of set) { try { fn(v); } catch { /* ignore */ } }
}

// Fill an unresolved cache slot from a raw stored value. Never
// downgrades: once a slot is `true` (disk OR mark), a later `false`
// read can't revert it.
function fillFromDisk(featureId: string, raw: string | null) {
  if (cache.get(featureId) === true) return; // mark already won
  const v = raw === 'true';
  cache.set(featureId, v);
  emit(featureId, v);
}

// Eager preload — one multiGet at module load so the cache is
// populated before first render in the common case.
(async function preload() {
  try {
    const keys = KNOWN_FEATURE_IDS.map((id) => `discovered:${id}`);
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) fillFromDisk(k.slice('discovered:'.length), v);
  } catch { /* hooks fall back to per-instance lazy read */ }
})();

export function useDiscovered(featureId: string): [boolean, () => void] {
  // Seed from the cache when resolved; otherwise default to `true`
  // (no-dim) for the one render before the disk read lands so an
  // already-discovered feature never flashes dim.
  const [discovered, setDiscovered] = useState<boolean>(
    cache.has(featureId) ? (cache.get(featureId) as boolean) : true
  );

  useEffect(() => {
    let cancelled = false;
    const unsub = subscribe(featureId, (v) => { if (!cancelled) setDiscovered(v); });

    if (cache.has(featureId)) {
      setDiscovered(cache.get(featureId) as boolean);
    } else {
      AsyncStorage.getItem(`discovered:${featureId}`).then((val) => {
        if (cancelled) return;
        fillFromDisk(featureId, val); // never downgrades a mark
        if (cache.has(featureId)) setDiscovered(cache.get(featureId) as boolean);
      }).catch(() => { /* keep optimistic true on read failure */ });
    }

    return () => { cancelled = true; unsub(); };
  }, [featureId]);

  const markDiscovered = async () => {
    try {
      await AsyncStorage.setItem(`discovered:${featureId}`, 'true');
      cache.set(featureId, true);
      emit(featureId, true); // updates this instance + every other live one
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[useDiscovered] write failed', featureId, e);
    }
  };

  return [discovered, markDiscovered];
}
