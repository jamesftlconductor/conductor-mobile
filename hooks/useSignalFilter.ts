// Universal Me / Crew / House filter applied across Hover, Horizon,
// Programme, Journal, Calendar, and Compass. Each consumer screen
// owns its own filter state — we deliberately don't lift this to a
// global hook because the filter is an interaction-level UX concept
// per surface, not a household-wide setting.
//
// The helper applyFilter implements the categorization rules in one
// place so every screen agrees on what "Me" / "Crew" / "House" means.
// A signal may match multiple buckets (e.g. a maintenance signal
// owned by a crew member is both 'crew' and 'house') — for those,
// 'me' / 'crew' priority wins over 'house' so the active filter
// behaves intuitively.

import { useState } from 'react';

export type SignalFilter = 'all' | 'me' | 'crew' | 'house';

const HOUSE_TYPES = new Set([
  'delivery', 'maintenance', 'service', 'subscription',
  'insurance', 'registration', 'warranty', 'lease', 'utility',
]);

const ME_TYPES = new Set([
  'health', 'finance', 'personal_reminder',
]);

type FilterCandidate = {
  type?: string;
  crewMemberId?: string | null;
  userId?: string | null;
  // Some screens compute additional categorical flags upstream; these
  // are optional and the filter falls through to type-based when
  // they're absent.
  signalOwner?: 'personal' | 'shared' | null;
};

export function useSignalFilter(initial: SignalFilter = 'all') {
  const [filter, setFilter] = useState<SignalFilter>(initial);
  return { filter, setFilter };
}

// Apply the active filter to a list. Pure function so screens can
// useMemo around it. currentUserId is the viewing user — used for the
// 'me' bucket. Pass an empty string when not available; the filter
// degrades to 'all'-like behavior on that side.
export function applyFilter<T extends FilterCandidate>(
  signals: T[],
  filter: SignalFilter,
  currentUserId: string,
): T[] {
  if (filter === 'all') return signals;
  return signals.filter((s) => {
    const crewId = s.crewMemberId ?? null;
    const ownedByMe = crewId === currentUserId
      || (crewId === null && (s.signalOwner === 'personal' || (s.type && ME_TYPES.has(s.type))));
    const ownedByCrew = crewId !== null && crewId !== currentUserId;
    const isHouse = !crewId && s.type && HOUSE_TYPES.has(s.type);

    if (filter === 'me') return ownedByMe;
    if (filter === 'crew') return ownedByCrew;
    if (filter === 'house') return isHouse;
    return true;
  });
}
