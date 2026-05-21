import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SignalFilterPills } from '@/components/SignalFilterPills';
import { applyFilter as applyMeCrewHouse, useSignalFilter } from '@/hooks/useSignalFilter';
import { metaFor, type Signal } from '@/components/signalTypes';
import { useTheme } from './theme';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type ThemeColors = { background: string; text: string; muted: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 14;

// --- shapes ---

type VaultItem = {
  id: string;
  description?: string;
  renewalDate?: string;
  category?: string;
  amount?: string;
  consequence?: string;
};

type CrewMember = {
  memberType?: string;
  userId?: string;
  firstName?: string;
  name?: string;
  birthday?: string;     // MM-DD
  anniversary?: string;  // MM-DD
  upcomingEvents?: { date?: string; description?: string }[];
};

type CalendarEvent = {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  type?: string;          // household | work | personal | travel
  eventType?: string;     // outOfOffice | focusTime | default | ...
  householdRelevant?: boolean;
  userId?: string;
};

type ProgrammeItem = {
  ymd: string;
  sortKey: number;        // unix ms; for stable within-day ordering
  emoji: string;
  emojiColor?: string;    // brass / brass-tinted for some kinds
  description: string;
  ownerTag?: string;      // "[Sarah's]" when not yours; undefined otherwise
  timeLabel?: string;     // "9:30 AM" / "today" / etc.
  kind: 'signal' | 'vault' | 'crew_event' | 'birthday' | 'anniversary' | 'calendar';
  signalId?: string | number;
};

// --- date helpers ---

// Local-time YYYY-MM-DD so two timestamps on the same calendar day
// share a bucket regardless of how they parse (date vs datetime).
function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayOffset(target: Date, anchor: Date): number {
  return Math.round(
    (startOfLocalDay(target).getTime() - startOfLocalDay(anchor).getTime()) / DAY_MS
  );
}

function dayHeader(target: Date, anchor: Date): string {
  const off = dayOffset(target, anchor);
  if (off === 0) return 'TODAY';
  if (off === 1) return 'TOMORROW';
  return target.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Resolve a YYYY-MM-DD plus MM-DD birthday/anniversary string to the next
// occurrence on or after today. Returns null if the MM-DD is malformed.
function mmddToNextDate(mmdd: string, today: Date): Date | null {
  const m = mmdd?.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10) - 1;
  const day = parseInt(m[2], 10);
  const thisYear = new Date(today.getFullYear(), month, day);
  if (thisYear.getTime() < startOfLocalDay(today).getTime()) {
    return new Date(today.getFullYear() + 1, month, day);
  }
  return thisYear;
}

// --- item builders ---

function isAllDay(start: string | undefined): boolean {
  // Google all-day events come back with a YYYY-MM-DD date (no time).
  return typeof start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(start);
}

function isWorkBlock(ev: CalendarEvent): boolean {
  return ev.type === 'work' || ev.eventType === 'outOfOffice' || ev.eventType === 'focusTime';
}

function buildItems(args: {
  signals: Signal[];
  vault: VaultItem[];
  crew: CrewMember[];
  calendar: CalendarEvent[];
  today: Date;
  horizonEnd: Date;
  accentColor: string;
}): { items: ProgrammeItem[]; memberMap: Map<string, string> } {
  const { signals, vault, crew, calendar, today, horizonEnd, accentColor } = args;
  const BRASS = accentColor;
  const items: ProgrammeItem[] = [];
  const startMs = startOfLocalDay(today).getTime();
  const endMs = startOfLocalDay(horizonEnd).getTime() + DAY_MS - 1;

  // userId → first name, for owner tagging. Built from the household-
  // member records on the crew array. The requesting user is excluded so
  // their own items never carry an [X's] tag.
  const memberMap = new Map<string, string>();
  for (const m of crew || []) {
    if (m.memberType === 'member' && m.userId && m.firstName && m.userId !== USER_ID) {
      memberMap.set(m.userId, m.firstName);
    }
  }
  function ownerTagFor(uid: string | undefined): string | undefined {
    if (!uid || uid === USER_ID) return undefined;
    const name = memberMap.get(uid);
    return name ? `${name}'s` : undefined;
  }

  // --- signals ---
  for (const s of signals || []) {
    if (!s.eta) continue;
    const ms = Date.parse(s.eta);
    if (isNaN(ms) || ms < startMs || ms > endMs) continue;
    const d = new Date(ms);
    const meta = metaFor(s);
    items.push({
      ymd: ymd(d),
      sortKey: ms,
      emoji: meta.emoji,
      emojiColor: meta.color,
      description: s.description || 'Unknown',
      ownerTag: ownerTagFor((s as Signal & { userId?: string }).userId),
      timeLabel: isAllDay(s.eta) ? undefined : formatTime(d),
      kind: 'signal',
      signalId: s.id,
    });
  }

  // --- vault ---
  for (const v of vault || []) {
    if (!v.renewalDate) continue;
    const ms = Date.parse(v.renewalDate);
    if (isNaN(ms) || ms < startMs || ms > endMs) continue;
    const d = new Date(ms);
    items.push({
      ymd: ymd(d),
      sortKey: ms,
      emoji: '⚠️',
      emojiColor: BRASS,
      description: v.description || 'Renewal',
      kind: 'vault',
      signalId: v.id,
    });
  }

  // --- crew upcomingEvents + birthdays + anniversaries ---
  for (const m of crew || []) {
    const memberEmoji = m.memberType === 'pet' ? '🐾' : '👤';
    const memberName = m.firstName || m.name || '';

    for (const ev of m.upcomingEvents || []) {
      if (!ev.date) continue;
      const ms = Date.parse(ev.date);
      if (isNaN(ms) || ms < startMs || ms > endMs) continue;
      const d = new Date(ms);
      const label = memberName
        ? `${memberName}: ${ev.description || 'Event'}`
        : ev.description || 'Crew event';
      items.push({
        ymd: ymd(d),
        sortKey: ms,
        emoji: memberEmoji,
        description: label,
        timeLabel: isAllDay(ev.date) ? undefined : formatTime(d),
        kind: 'crew_event',
      });
    }

    if (m.birthday) {
      const d = mmddToNextDate(m.birthday, today);
      if (d && d.getTime() >= startMs && d.getTime() <= endMs) {
        const offsetDays = dayOffset(d, today);
        items.push({
          ymd: ymd(d),
          sortKey: d.getTime(),
          emoji: '🎂',
          emojiColor: offsetDays <= 7 ? BRASS : undefined,
          description: memberName ? `${memberName}'s birthday` : 'Birthday',
          kind: 'birthday',
        });
      }
    }

    if (m.anniversary) {
      const d = mmddToNextDate(m.anniversary, today);
      if (d && d.getTime() >= startMs && d.getTime() <= endMs) {
        const offsetDays = dayOffset(d, today);
        items.push({
          ymd: ymd(d),
          sortKey: d.getTime(),
          emoji: '💍',
          emojiColor: offsetDays <= 7 ? BRASS : undefined,
          description: memberName ? `${memberName}'s anniversary` : 'Anniversary',
          kind: 'anniversary',
        });
      }
    }
  }

  // --- calendar events (drop work blocks; they're privacy-stripped and
  // don't carry titles worth surfacing on the timeline) ---
  for (const ev of calendar || []) {
    if (!ev.start) continue;
    if (isWorkBlock(ev)) continue;
    const ms = Date.parse(ev.start);
    if (isNaN(ms) || ms < startMs || ms > endMs) continue;
    const d = new Date(ms);
    items.push({
      ymd: ymd(d),
      sortKey: ms,
      emoji: '📅',
      description: ev.title || 'Calendar event',
      ownerTag: ownerTagFor(ev.userId),
      timeLabel: isAllDay(ev.start) ? undefined : formatTime(d),
      kind: 'calendar',
    });
  }

  // Stable ordering: ms ascending, then by kind priority so all-day
  // events (sortKey at midnight) cluster predictably.
  const kindRank: Record<ProgrammeItem['kind'], number> = {
    birthday: 0, anniversary: 1, vault: 2, signal: 3, crew_event: 4, calendar: 5,
  };
  items.sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    return kindRank[a.kind] - kindRank[b.kind];
  });

  return { items, memberMap };
}

// --- screen ---

export default function ProgrammeScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const MUTED = theme.muted;
  const [signals, setSignals] = useState<Signal[]>([]);
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { filter: meCrewHouse, setFilter: setMeCrewHouse } = useSignalFilter('all');

  async function load() {
    // All four endpoints in parallel — Programme is read-only and each
    // is independently best-effort. A failed endpoint doesn't block the
    // others; the rendered timeline just omits that data category.
    const [sigRes, vaultRes, crewRes, calRes] = await Promise.allSettled([
      fetch(`${API_BASE}/signals?userId=${USER_ID}`),
      fetch(`${API_BASE}/signals?type=vault&userId=${USER_ID}`),
      fetch(`${API_BASE}/signals?type=crew&userId=${USER_ID}`),
      fetch(`${API_BASE}/signals?type=calendar&userId=${USER_ID}`),
    ]);

    async function jsonOk<T = any>(r: PromiseSettledResult<Response>): Promise<T | null> {
      if (r.status !== 'fulfilled' || !r.value.ok) return null;
      try { return (await r.value.json()) as T; } catch { return null; }
    }

    const sigData = await jsonOk<{ signals?: Signal[] }>(sigRes);
    const vaultData = await jsonOk<{ vault?: VaultItem[] }>(vaultRes);
    const crewData = await jsonOk<{ crew?: CrewMember[] }>(crewRes);
    const calData = await jsonOk<{ events?: CalendarEvent[] }>(calRes);

    setSignals(Array.isArray(sigData?.signals) ? sigData!.signals! : []);
    setVault(Array.isArray(vaultData?.vault) ? vaultData!.vault! : []);
    setCrew(Array.isArray(crewData?.crew) ? crewData!.crew! : []);
    setCalendar(Array.isArray(calData?.events) ? calData!.events! : []);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Build the day-grouped, sorted timeline. useMemo keys on the four
  // arrays so it only recomputes when fresh data lands.
  const grouped = useMemo(() => {
    const today = new Date();
    const horizonEnd = new Date(today.getTime() + (HORIZON_DAYS - 1) * DAY_MS);
    const filteredSignals = applyMeCrewHouse(signals, meCrewHouse, USER_ID);
    const { items } = buildItems({ signals: filteredSignals, vault, crew, calendar, today, horizonEnd, accentColor });

    // Bucket by YMD, preserving the sorted order produced above.
    const buckets = new Map<string, ProgrammeItem[]>();
    for (const it of items) {
      const arr = buckets.get(it.ymd) || [];
      arr.push(it);
      buckets.set(it.ymd, arr);
    }

    const days: { ymd: string; date: Date; header: string; items: ProgrammeItem[] }[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const d = new Date(today.getTime() + i * DAY_MS);
      const key = ymd(d);
      const items = buckets.get(key);
      if (!items || items.length === 0) continue;
      days.push({ ymd: key, date: d, header: dayHeader(d, today), items });
    }
    return days;
  }, [signals, vault, crew, calendar, accentColor]);

  function handleItemTap(item: ProgrammeItem) {
    // Signals navigate to Hover with the signal pre-selected — same flow
    // as the brief screen. Non-signal items don't have a detail view yet;
    // tap is a no-op for them in v1.
    if (item.kind === 'signal' && item.signalId != null) {
      router.push({ pathname: '/(tabs)/hover', params: { signalId: String(item.signalId) } });
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="The Programme"
        subtitle="Everything in motion"
        rightAction={
          <TouchableOpacity
            onPress={() => router.push('/calendar' as never)}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.monthLink}>Month →</Text>
          </TouchableOpacity>
        }
      />
      <SignalFilterPills value={meCrewHouse} onChange={setMeCrewHouse} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={MUTED} />
        }>

      {loading && (
        <View style={styles.empty}>
          <ActivityIndicator color={MUTED} />
        </View>
      )}

      {!loading && grouped.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>The horizon is clear.</Text>
        </View>
      )}

      {!loading &&
        grouped.map((day) => (
          <View key={day.ymd} style={styles.dayBlock}>
            <Text style={styles.dayHeader}>{day.header}</Text>
            <View style={styles.dayDivider} />
            {day.items.map((it, i) => (
              <TouchableOpacity
                key={`${day.ymd}-${i}`}
                style={styles.itemRow}
                onPress={() => handleItemTap(it)}
                activeOpacity={it.kind === 'signal' ? 0.6 : 1}>
                <Text style={[styles.itemEmoji, it.emojiColor ? { color: it.emojiColor } : null]}>
                  {it.emoji}
                </Text>
                <View style={styles.itemBody}>
                  <Text style={styles.itemDescription} numberOfLines={2}>
                    {it.description}
                  </Text>
                  {it.ownerTag ? (
                    <Text style={styles.itemOwner}>[{it.ownerTag}]</Text>
                  ) : null}
                </View>
                {it.timeLabel ? (
                  <Text style={styles.itemTime}>{it.timeLabel}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 60 },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    topBack: {
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    topBackText: {
      color: theme.muted,
      fontSize: 13,
      letterSpacing: 0.3,
    },
    monthLink: {
      color: accentColor,
      fontSize: 13,
      letterSpacing: 0.3,
      fontWeight: '500',
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    title: {
      color: theme.text,
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.5,
      marginBottom: 6,
    },
    subtitle: {
      color: theme.muted,
      fontSize: 13,
      paddingBottom: 24,
      letterSpacing: 0.2,
    },
    empty: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
    },
    emptyText: {
      color: theme.muted,
      fontSize: 14,
      letterSpacing: 0.3,
    },
    dayBlock: {
      marginBottom: 20,
    },
    dayHeader: {
      color: accentColor,
      fontSize: 11,
      letterSpacing: 2,
      textTransform: 'uppercase',
      fontWeight: '600',
      marginBottom: 6,
    },
    dayDivider: {
      height: 1,
      backgroundColor: SOFT_BORDER,
      marginBottom: 8,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 12,
    },
    itemEmoji: {
      fontSize: 20,
      lineHeight: 24,
      width: 28,
    },
    itemBody: {
      flex: 1,
      gap: 2,
    },
    itemDescription: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 19,
    },
    itemOwner: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 0.3,
    },
    itemTime: {
      color: theme.muted,
      fontSize: 12,
      letterSpacing: 0.3,
    },
  });
}
