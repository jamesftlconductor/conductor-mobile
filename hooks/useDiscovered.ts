// Feature-discovery state. Dimming/intro pattern: a feature renders
// at 45% opacity until the user taps it once and reads the intro,
// then permanently lights up to 100% for that device — across every
// brief mode (Takeoff / Clearance / Overwatch) and across restarts.
//
// Backed by AsyncStorage keys `discovered:{featureId}`, fronted by a
// module-level cache shared by every hook instance for the same
// featureId.
//
// Two correctness rules learned the hard way (features kept reverting
// to dim in Clearance after a cold restart):
//
//   1. EAGER PRELOAD. We multiGet every known discovery key once at
//      module load so the cache is populated before the first render
//      in the common case. No per-instance lazy read racing the user.
//
//   2. THE READ NEVER DOWNGRADES. A disk read may resolve AFTER the
//      user has already tapped (markDiscovered sets the cache to true
//      and queues the write). If the read then wrote its stale `false`
//      back, the surface would flip from bright to dim. So the read
//      only ever FILLS an undefined cache slot, and never replaces a
//      `true` with `false`. markDiscovered (true) always wins.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// featureId → discovered. undefined = not yet resolved from disk.
const cache: Record<string, boolean | undefined> = {};
const listeners: Record<string, Set<() => void>> = {};

// Every featureId the app dims. Listed so the eager preload can
// multiGet them in one round trip at startup. A featureId not in this
// list still works (falls back to the per-instance lazy read) — the
// list is purely a preload optimization.
const KNOWN_FEATURE_IDS = ['pulse', 'signals', 'minimap', 'feedback'];

function notify(featureId: string) {
  const set = listeners[featureId];
  if (set) for (const l of set) { try { l(); } catch { /* ignore */ } }
}

function subscribe(featureId: string, cb: () => void) {
  (listeners[featureId] ||= new Set()).add(cb);
  return () => { listeners[featureId]?.delete(cb); };
}

// Fill an undefined cache slot from a raw stored value. Never
// downgrades: once a slot is `true` (either from disk or from a
// mark), a later `false` read can't revert it.
function fillFromDisk(featureId: string, raw: string | null) {
  if (cache[featureId] === true) return; // mark already won — never downgrade
  cache[featureId] = raw === 'true';
  notify(featureId);
}

// Eager preload — one multiGet at module load. Populates the cache
// before any component reads it in the common case, closing the
// lazy-read race window.
(async function preload() {
  try {
    const keys = KNOWN_FEATURE_IDS.map((id) => `discovered:${id}`);
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) {
      const id = k.slice('discovered:'.length);
      fillFromDisk(id, v);
    }
  } catch { /* hooks fall back to per-instance lazy read */ }
})();

export function useDiscovered(featureId: string): [boolean, () => void] {
  // Seed from the cache when resolved; otherwise default to `true`
  // (no-dim) for the one render before the disk read lands, so an
  // already-discovered feature never flashes dim.
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
      // Resolved already (preload or a prior instance / mark).
      setDiscovered(cache[featureId] as boolean);
    } else {
      AsyncStorage.getItem(`discovered:${featureId}`).then((val) => {
        if (cancelled) return;
        fillFromDisk(featureId, val); // never downgrades a mark
        if (cache[featureId] !== undefined) {
          setDiscovered(cache[featureId] as boolean);
        }
      }).catch(() => { /* keep optimistic true on read failure */ });
    }

    return () => { cancelled = true; unsub(); };
  }, [featureId]);

  const markDiscovered = () => {
    cache[featureId] = true; // wins over any in-flight disk read
    setDiscovered(true);
    notify(featureId);
    AsyncStorage.setItem(`discovered:${featureId}`, 'true').catch(() => {});
  };

  return [discovered, markDiscovered];
}
