// Vitals — a live dashboard of the household's health, weather, signals, and
// household state. Each source loads independently (so a slow fetch doesn't
// block the others), the whole screen auto-refreshes every 5 minutes and on
// pull-to-refresh, and a "last updated" stamp sits at the bottom.
//
// Sources that exist today are wired to real data (Apple HealthKit, /api/brief
// pulseData, /api/signals, streak, calendar-month). Fields with no source yet
// (readiness, wind, forecast, last import run, resolved today) render an em
// dash with a small "coming soon" note rather than a fabricated value.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { fetchHealthSnapshot, type HealthSnapshot } from '@/components/HealthContext';
import { useTheme } from '@/app/theme';
import { useUserId } from '@/hooks/useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';
const REFRESH_MS = 5 * 60 * 1000;

type Weather = {
  tempF?: number | null;
  heatIndex?: number | null;
  humidity?: number | null;
  conditions?: string | null;
} | null;

type SignalsData = { active: number; urgent: number; nextEta: string | null } | null;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (isNaN(ms)) return '';
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtEta(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (isNaN(ms)) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? `Today ${fmtTime(iso)}`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${fmtTime(iso)}`;
}

export default function VitalsScreen() {
  const userId = useUserId();
  const { theme, accentColor } = useTheme();

  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [weather, setWeather] = useState<Weather>(null);
  const [signals, setSignals] = useState<SignalsData>(null);
  const [streak, setStreak] = useState<number | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [calendarToday, setCalendarToday] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const snap = await fetchHealthSnapshot();
      setHealth(snap);
    } catch { /* leave previous */ }
  }, []);

  const loadBrief = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/brief?userId=${userId}`);
      const data = await res.json();
      setWeather((data?.pulseData?.weather as Weather) ?? null);
      const gen =
        typeof data?.generatedAt === 'string'
          ? data.generatedAt
          : typeof data?.asOf === 'string'
            ? data.asOf
            : null;
      setGeneratedAt(gen);
    } catch { /* leave previous */ }
  }, [userId]);

  const loadSignals = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/signals?userId=${userId}`);
      const data = await res.json();
      const all: any[] = Array.isArray(data?.signals) ? data.signals : [];
      const active = all.filter(
        (s) => !s.state || s.state === 'incoming' || s.state === 'active',
      );
      const now = Date.now();
      let urgent = 0;
      let nextEta: string | null = null;
      let best = Infinity;
      for (const s of active) {
        const t = Date.parse(s.eta);
        if (isNaN(t)) continue;
        if (t - now < 24 * 60 * 60 * 1000) urgent += 1;
        if (t > now && t < best) {
          best = t;
          nextEta = s.eta;
        }
      }
      setSignals({ active: active.length, urgent, nextEta });
    } catch { /* leave previous */ }
  }, [userId]);

  const loadStreak = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/signals?type=streak&userId=${userId}`);
      const data = await res.json();
      const s = data?.streak;
      setStreak(s && typeof s.currentStreak === 'number' ? s.currentStreak : null);
    } catch { /* leave previous */ }
  }, [userId]);

  const loadCalendar = useCallback(async () => {
    if (!userId) return;
    try {
      const d = new Date();
      const month = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      const todayKey = `${month}-${pad2(d.getDate())}`;
      const res = await fetch(
        `${API_BASE}/signals?type=calendar-month&userId=${userId}&month=${month}`,
      );
      const data = await res.json();
      const bucket = data?.days?.[todayKey];
      const count = bucket
        ? (bucket.signals?.length || 0) + (bucket.crewEvents?.length || 0)
        : 0;
      setCalendarToday(count);
    } catch { /* leave previous */ }
  }, [userId]);

  const loadAll = useCallback(async () => {
    // Each source resolves independently; allSettled so one failure doesn't
    // sink the rest.
    await Promise.allSettled([
      loadHealth(),
      loadBrief(),
      loadSignals(),
      loadStreak(),
      loadCalendar(),
    ]);
    setLastUpdated(Date.now());
  }, [loadHealth, loadBrief, loadSignals, loadStreak, loadCalendar]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadAll();
      if (!cancelled) setLoading(false);
    })();
    const id = setInterval(() => { loadAll(); }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const styles = makeStyles(theme, accentColor);

  const hrvText =
    health?.hrv?.current != null
      ? `${health.hrv.current} ms` +
        (health.hrv.baseline7d != null ? `  ·  7d ${health.hrv.baseline7d} ms` : '')
      : null;
  const rhrText = health?.restingHR != null ? `${health.restingHR} bpm` : null;
  const sleepText =
    health?.sleep?.duration != null
      ? `${health.sleep.duration.toFixed(1)} h` +
        (health.sleep.efficiency != null
          ? `  ·  ${Math.round((health.sleep.efficiency <= 1 ? health.sleep.efficiency * 100 : health.sleep.efficiency))}%`
          : '')
      : null;

  const tempText = weather?.tempF != null ? `${Math.round(weather.tempF)}°F` : null;
  const feelsText = weather?.heatIndex != null ? `Feels ${Math.round(weather.heatIndex)}°F` : null;
  const tempCombined = [tempText, feelsText].filter(Boolean).join('  ·  ') || null;
  const humidityText = weather?.humidity != null ? `${Math.round(weather.humidity)}%` : null;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Vitals" subtitle="Your household, live" screenContext="vitals" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />
        }>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={accentColor} />
          </View>
        ) : null}

        <Section title="Health" note="Apple HealthKit" styles={styles}>
          <Row label="HRV" value={hrvText} styles={styles} />
          <Row label="Resting heart rate" value={rhrText} styles={styles} />
          <Row label="Sleep last night" value={sleepText} styles={styles} />
          <Row label="Readiness" value={null} comingSoon styles={styles} />
        </Section>

        <Section title="Weather" styles={styles}>
          <Row label="Conditions" value={weather?.conditions ?? null} styles={styles} />
          <Row label="Temperature" value={tempCombined} styles={styles} />
          <Row label="Humidity" value={humidityText} styles={styles} />
          <Row label="Wind" value={null} comingSoon styles={styles} />
          <Row label="Today's forecast" value={null} comingSoon styles={styles} />
        </Section>

        <Section title="Signals" styles={styles}>
          <Row label="Active" value={signals ? String(signals.active) : null} styles={styles} />
          <Row label="Urgent" value={signals ? String(signals.urgent) : null} styles={styles} />
          <Row label="Resolved today" value={null} comingSoon styles={styles} />
          <Row label="Current streak" value={streak != null ? `${streak} day${streak === 1 ? '' : 's'}` : null} styles={styles} />
        </Section>

        <Section title="Household" styles={styles}>
          <Row label="Brief generated" value={generatedAt ? fmtTime(generatedAt) : null} styles={styles} />
          <Row label="Last import run" value={null} comingSoon styles={styles} />
          <Row label="Calendar events today" value={calendarToday != null ? String(calendarToday) : null} styles={styles} />
          <Row label="Next signal ETA" value={signals?.nextEta ? fmtEta(signals.nextEta) : (signals ? 'None upcoming' : null)} styles={styles} />
        </Section>

        <Text style={styles.lastUpdated}>
          {lastUpdated
            ? `Last updated ${fmtTime(new Date(lastUpdated).toISOString())}`
            : 'Updating…'}
        </Text>
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  note,
  children,
  styles,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {note ? <Text style={styles.sectionNote}>{note}</Text> : null}
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  comingSoon,
  styles,
}: {
  label: string;
  value: string | null;
  comingSoon?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={value ? styles.rowValue : styles.rowDash}>{value ?? '—'}</Text>
        {!value && comingSoon ? <Text style={styles.comingSoon}>coming soon</Text> : null}
      </View>
    </View>
  );
}

type ThemeColors = { background: string; surface: string; card: string; text: string; muted: string; border: string };

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 20 },
    loading: { paddingVertical: 20, alignItems: 'center' },
    section: { marginBottom: 22 },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    sectionTitle: {
      color: accentColor,
      fontSize: 11,
      letterSpacing: 2,
      fontWeight: '600',
      textTransform: 'uppercase',
    },
    sectionNote: { color: theme.muted, fontSize: 10, letterSpacing: 0.3 },
    card: {
      backgroundColor: theme.card,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      paddingHorizontal: 14,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    rowLabel: { color: theme.muted, fontSize: 13, flex: 1, paddingRight: 12 },
    rowRight: { alignItems: 'flex-end' },
    rowValue: { color: theme.text, fontSize: 14, fontWeight: '500' },
    rowDash: { color: theme.muted, fontSize: 14 },
    comingSoon: { color: theme.muted, fontSize: 9, fontStyle: 'italic', marginTop: 2, letterSpacing: 0.3 },
    lastUpdated: {
      color: theme.muted,
      fontSize: 11,
      textAlign: 'center',
      marginTop: 4,
      fontStyle: 'italic',
    },
  });
}
