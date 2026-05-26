// Polls /api/signals?type=urgentCount every 5 minutes. The backend
// caches the count with a 5-min TTL too, so this poll is cheap —
// most calls hit the cached value.
//
// userId comes from useUserId (AsyncStorage-backed, populated by the
// OAuth deep-link). Until the userId is loaded the hook stays at 0
// and the polling loop short-circuits.

import { useEffect, useState } from 'react';

import { useUserId } from './useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';
const POLL_MS = 5 * 60 * 1000;

export function useUrgentCount(): number {
  const userId = useUserId();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=urgentCount&userId=${userId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (typeof data?.count === 'number') setCount(data.count);
      } catch {
        // silent — keep last known count rather than dropping to 0
      }
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId]);

  return count;
}
