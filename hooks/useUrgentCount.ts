// Polls /api/signals?type=urgentCount every 5 minutes. The backend
// caches the count with a 5-min TTL too, so this poll is cheap —
// most calls hit the cached value.
//
// userId is hardcoded to match the rest of the app for now; when the
// multi-account work lands, swap to reading from AsyncStorage. The
// extra fetch on mount means a freshly-opened Settings or feature
// screen gets a current badge without waiting up to 5 minutes.

import { useEffect, useState } from 'react';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';
const POLL_MS = 5 * 60 * 1000;

export function useUrgentCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=urgentCount&userId=${USER_ID}`);
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
  }, []);

  return count;
}
