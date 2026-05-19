import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, LayoutAnimation, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, UIManager, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { fetchHealthSnapshot, type HealthSnapshot } from '@/components/HealthContext';
import { HelpButton } from '@/components/HelpButton';
import { Minimap } from '@/components/Minimap';
import { ConductorSheet } from '@/components/ConductorSheet';
import { useUrgentCount } from '@/hooks/useUrgentCount';
import OverwatchView from '@/components/OverwatchView';
import YesterdayModal from '@/components/YesterdayModal';
import { Tooltip } from '@/components/Tooltip';
import { useShakeToAsk } from '@/components/useShakeToAsk';
import { conductorHaptics } from '@/app/haptics';
import { useTheme } from '@/app/theme';
import { useMemo } from 'react';
// Defensive native-module require: the binary running this OTA may
// predate the expo-speech install. A top-level `import * as Speech
// from 'expo-speech'` would crash the bundle on that binary. Defer
// the require and swallow failures so speech is simply a no-op.
const Speech: any = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-speech');
  } catch { return { speak: () => {}, stop: () => {} }; }
})();

// LayoutAnimation needs an opt-in on Android; iOS supports it by default.
// Enabling at module-load is the official pattern — re-calling per-toggle
// has no benefit.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type PulseData = {
  health: {
    sleep: number | null;
    hrv: { current: number | null; baseline7d: number | null };
    restingHR: number | null;
    steps: number | null;
    activeCalories: number | null;
    // Oura subset — null when the user hasn't connected the ring.
    oura?: {
      readinessScore: number | null;
      deepSleepSeconds: number | null;
      // Oura's body_temperature contributor: ~100 is normal; lower
      // numbers indicate elevated body temperature relative to baseline.
      temperatureContrib: number | null;
    } | null;
  } | null;
  weather: {
    tempF: number | null;
    heatIndex: number | null;
    humidity: number | null;
    conditions: string | null;
    rainWindow?: string | null;
    uvPeak?: { value: number; time: string } | null;
    temperaturePeak?: { tempF: number; time: string } | null;
    sunrise?: string | null;
    sunset?: string | null;
  } | null;
  signalLoad: 'heavy' | 'moderate' | 'light' | 'clear';
  urgentCount: number;
  synthesisFlags: string[];
};

// Synthesis-flag → user-facing phrase. Only flags listed here render in the
// expanded card; others (travel_prep, birthday_today, etc.) shape tone via
// the prompt but don't surface as user-readable lines.
const PULSE_FLAG_PHRASES: Record<string, string> = {
  dehydration_risk: 'Dehydration risk — stay ahead of fluids',
  high_stress_load: 'Heavy load on a recovery day',
  fatigue_plus_demands: 'Short sleep with urgent signals',
  green_light: 'Good day — health and load are both favorable',
  heat_caution: 'Heat caution for outdoor activity',
  storm_plus_outdoor: 'Storm timing may affect outdoor plans',
};

type BriefSegment =
  | { type: 'text'; content: string }
  | { type: 'signal'; content: string; signalId: string | number; signalType?: string };

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  package: '#60a5fa',
  delivery: '#7dd3fc',
  food: '#f59e0b',
  grocery: '#a3e635',
  service: '#86efac',
  reservation: '#f9a8d4',
  appointment: '#c4b5fd',
  travel: '#2dd4bf',
  deadline: '#fbbf24',
  unknown: '#8a8780',
};
const DEFAULT_SIGNAL_COLOR = '#ef4444';

const PENDING_SIGNAL_KEY = 'conductor:pendingSignalId';
const EXPO_PUSH_TOKEN_KEY = 'expoPushToken';
const HEALTH_CONTEXT_KEY = 'healthContext';
const PUSH_USER_ID = 'james_totalhome_gmail_com';

async function syncHealthIfStale() {
  try {
    const cachedRaw = await AsyncStorage.getItem(HEALTH_CONTEXT_KEY);
    const cached: HealthSnapshot | null = cachedRaw ? JSON.parse(cachedRaw) : null;
    // Refresh once per local calendar day. Comparing toDateString() handles
    // DST transitions and avoids tripping on millisecond boundaries.
    if (cached?.asOf && new Date(cached.asOf).toDateString() === new Date().toDateString()) {
      return;
    }

    const snapshot = await fetchHealthSnapshot();
    if (!snapshot) return;

    await AsyncStorage.setItem(HEALTH_CONTEXT_KEY, JSON.stringify(snapshot));

    await fetch('https://conductor-ivory.vercel.app/api/signals?type=preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: PUSH_USER_ID, healthData: snapshot }),
    });
  } catch {
    // Best-effort — never block app startup on health sync.
  }
}

// Notification categories — registered at launch so iOS knows what
// action buttons to render when a SIGNAL_FOLLOWUP or PACKAGE_TRACKING
// push lands. setNotificationCategoryAsync works over OTA — the
// app.json infoPlist categories are belt-and-suspenders for when JS
// hasn't booted yet (lockscreen action on first-ever launch after
// install).
async function registerNotificationCategories() {
  try {
    await Notifications.setNotificationCategoryAsync('SIGNAL_FOLLOWUP', [
      {
        identifier: 'REST',
        buttonTitle: 'Done ✓',
        options: { isDestructive: false, opensAppToForeground: false },
      },
      {
        identifier: 'HOLD',
        buttonTitle: 'Still open',
        options: { isDestructive: false, opensAppToForeground: false },
      },
    ]);
    await Notifications.setNotificationCategoryAsync('PACKAGE_TRACKING', [
      {
        identifier: 'REST',
        buttonTitle: 'Got it ✓',
        options: { isDestructive: false, opensAppToForeground: false },
      },
      {
        identifier: 'TRACK',
        buttonTitle: 'Track',
        options: { isDestructive: false, opensAppToForeground: true },
      },
    ]);
  } catch (err) {
    // Best-effort — categories already exist or platform unsupported.
    console.warn('[notifications] category registration:', err);
  }
}

async function registerForPushNotifications() {
  try {
    if (!Device.isDevice) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await registerNotificationCategories();

    const { status: existing } = await Notifications.getPermissionsAsync();
    let final = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      final = status;
    }
    if (final !== 'granted') return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) return;

    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResult.data;
    if (!token) return;

    // Always POST — backend write is idempotent (redis.set), so the cost of
    // skipping the cache-gated dedup is one round trip per launch in exchange
    // for automatic recovery if a previous POST silently failed. Cache only
    // after the server confirms receipt so a failure leaves the next launch
    // free to retry.
    const res = await fetch('https://conductor-ivory.vercel.app/api/signals?type=preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: PUSH_USER_ID, expoPushToken: token }),
    });
    if (!res.ok) return;

    await AsyncStorage.setItem(EXPO_PUSH_TOKEN_KEY, token);
  } catch {
    // Best-effort — never block app startup on push registration.
  }
}

// Helper for theme-aware brass-tinted rgba values. The codebase had
// dozens of `rgba(184,150,12,0.X)` literals — these are the brass
// accent at varied alpha for borders, soft fills, dividers. Now the
// accent comes from the user's chosen palette (brass / amber / copper /
// forest / navy), so we parse its hex and emit rgba() at the desired
// opacity.
function accentRgba(accentColor: string, opacity: number): string {
  const hex = accentColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// Band themes were module-level constants tied to the dark palette.
// They're now factories so they pick up the current theme + accent.
// Clearance is intentionally a quieter variant of the same palette
// (uses surface for bg, slightly muted text) — same evening-mood
// design intent but rendered in whatever theme the user picked.
type BandTheme = {
  bg: string;
  title: string;
  brief: string;
  greeting: string;
  divider: string;
  timestamp: string;
};
function makeTakeoffTheme(theme: { background: string; text: string; muted: string }): BandTheme {
  return {
    bg: theme.background,
    title: theme.text,
    brief: theme.text,
    greeting: theme.muted,
    divider: 'rgba(255,255,255,0.12)',
    timestamp: theme.muted,
  };
}
function makeClearanceTheme(theme: { background: string; surface: string; text: string; muted: string }): BandTheme {
  return {
    bg: theme.surface,
    title: theme.text,
    brief: theme.text,
    greeting: theme.muted,
    divider: 'rgba(255,255,255,0.05)',
    timestamp: theme.muted,
  };
}

// Time bands:
//   < 7   → Overwatch (overnight idle screen)
//   7-21  → Takeoff (morning brief surface; 9am-9pm shows the same most-recent
//                    Takeoff prose, no separate band needed)
//   21-22 → Clearance (one-hour evening close window)
//   ≥ 22  → Overwatch
// Compute contextual chips from current brief state. Returns at
// most 7 candidates; caller takes .slice(0, 3) for display.
function buildAskChips(args: {
  segments: BriefSegment[];
  urgentCount: number;
  pulseFlags: string[];
  pulseData: PulseData | null;
  conductorQuestion: string | null;
  maintenancePlanOffer: boolean;
  modeIsTakeoff: boolean;
}): string[] {
  const chips: string[] = [];

  // Look for a travel signal with a destination in the segments.
  const travel = (args.segments || []).find(
    (s) => s.type === 'signal' && /trip|flight|paris|london|nyc|destination|travel/i.test(s.content || '')
  );
  if (travel) {
    const m = (travel.content || '').match(/\b(?:to|in)\s+([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+){0,2})/);
    if (m && m[1]) chips.push(`What do I need for ${m[1]}?`);
  }

  // Maintenance plan offer is a strong "this is on your radar" cue.
  if (args.maintenancePlanOffer) {
    chips.push("What's due for maintenance this month?");
  }

  // Health-state pulse flags surface a readiness chip.
  const lowHealth =
    (args.pulseFlags || []).some((f) => /health|readiness|sleep|recovery|hrv/i.test(f)) ||
    (args.pulseData?.health?.oura?.readinessScore != null && args.pulseData.health.oura.readinessScore < 60);
  if (lowHealth) {
    chips.push('Why is my readiness low today?');
  }

  if (args.urgentCount > 0) {
    chips.push("What's most urgent right now?");
  }

  if (args.conductorQuestion) {
    chips.push('Answer your question for me');
  }

  // Fallbacks — always-available chips. Filled in order until we have 3.
  const fallbacks = [
    'What should this cost?',
    "What's coming up this week?",
    'How are we doing?',
    'Open my vault',
    args.modeIsTakeoff ? 'What is the brief?' : 'What is the Pulse?',
    'Show me my crew',
  ];
  for (const f of fallbacks) {
    if (chips.length >= 3) break;
    if (!chips.includes(f)) chips.push(f);
  }

  return chips;
}

function getBriefMode(hour: number) {
  if (hour < 7 || hour >= 22) return { title: 'Overwatch', endpoint: null as string | null };
  if (hour < 21) return { title: 'Takeoff', endpoint: 'brief' as string | null };
  return { title: 'Clearance', endpoint: 'clearance' as string | null };
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBriefWithRetry(url: string) {
  try {
    return await fetchWithTimeout(url, 30000);
  } catch (err) {
    await new Promise(r => setTimeout(r, 2000));
    return await fetchWithTimeout(url, 30000);
  }
}

// Round-half-up integer formatting. JS toFixed/Math.round handle floats
// adequately for the small one-decimal cases we need.
function roundInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '';
  return String(Math.round(n));
}

function PulseHealthSection({ health }: { health: PulseData['health'] }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  if (!health) {
    return (
      <View style={styles.pulseSection}>
        <Text style={styles.pulseSectionLabel}>HEALTH</Text>
        <Text style={styles.pulseEmpty}>
          Health data not connected — grant access in Settings
        </Text>
      </View>
    );
  }
  const { sleep, hrv, restingHR, steps, activeCalories } = health;
  const anyValue = sleep != null || hrv?.current != null || restingHR != null
    || steps != null || activeCalories != null;
  if (!anyValue) {
    return (
      <View style={styles.pulseSection}>
        <Text style={styles.pulseSectionLabel}>HEALTH</Text>
        <Text style={styles.pulseEmpty}>
          Health data not connected — grant access in Settings
        </Text>
      </View>
    );
  }
  const sleepColor = sleep != null && sleep < 6 ? accentColor : '#a8a5a0';
  let hrvBelowPct: number | null = null;
  if (hrv?.current != null && hrv?.baseline7d) {
    hrvBelowPct = Math.round((1 - hrv.current / hrv.baseline7d) * 100);
  }
  const hrvLow = hrvBelowPct != null && hrvBelowPct > 15;
  const hrvColor = hrvLow ? '#f59e0b' : '#a8a5a0';

  return (
    <View style={styles.pulseSection}>
      <Text style={styles.pulseSectionLabel}>HEALTH</Text>
      {sleep != null ? (
        <Text style={[styles.pulseRow, { color: sleepColor }]}>
          🌙  {sleep.toFixed(1)}h
        </Text>
      ) : null}
      {hrv?.current != null ? (
        <Text style={[styles.pulseRow, { color: hrvColor }]}>
          💓  {roundInt(hrv.current)}
          {hrvBelowPct != null && hrvBelowPct > 0
            ? ` — ${hrvBelowPct}% below baseline`
            : ''}
        </Text>
      ) : null}
      {restingHR != null ? (
        <Text style={[styles.pulseRow, { color: '#a8a5a0' }]}>
          ❤️  {roundInt(restingHR)} bpm
        </Text>
      ) : null}
      {steps != null ? (
        <Text style={[styles.pulseRow, { color: '#a8a5a0' }]}>
          👟  {steps.toLocaleString()} so far
        </Text>
      ) : null}
      {activeCalories != null ? (
        <Text style={[styles.pulseRow, { color: '#a8a5a0' }]}>
          🔥  {roundInt(activeCalories)} kcal
        </Text>
      ) : null}
      {health.oura ? (
        <>
          {health.oura.readinessScore != null ? (
            <Text
              style={[
                styles.pulseRow,
                {
                  color:
                    health.oura.readinessScore > 70 ? '#86efac'
                    : health.oura.readinessScore >= 50 ? '#f59e0b'
                    : '#ef4444',
                },
              ]}>
              🔴  Readiness {roundInt(health.oura.readinessScore)}/100
            </Text>
          ) : null}
          {health.oura.deepSleepSeconds != null ? (
            <Text style={[styles.pulseRow, { color: '#a8a5a0' }]}>
              💤  Deep sleep {Math.floor(health.oura.deepSleepSeconds / 3600)}h{' '}
              {Math.round((health.oura.deepSleepSeconds % 3600) / 60)}m
            </Text>
          ) : null}
          {/* Body temperature: Oura's contributor score where lower = elevated.
              Surface only when it's notable (<85 = slightly+ elevated). */}
          {health.oura.temperatureContrib != null && health.oura.temperatureContrib < 85 ? (
            <Text style={[styles.pulseRow, { color: '#f59e0b' }]}>
              🌡  Temperature slightly elevated
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function PulseTimelineSection({ weather }: { weather: PulseData['weather'] }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  // Today's Timeline — sunrise/peak/rain/UV/sunset. Renders only
  // when at least one of these is present so the section doesn't
  // appear on locations where the API returns nulls.
  const sunrise = weather?.sunrise;
  const sunset = weather?.sunset;
  const peak = weather?.temperaturePeak;
  const rain = weather?.rainWindow;
  const uv = weather?.uvPeak;
  if (!sunrise && !sunset && !peak && !rain && !uv) return null;

  const uvLabel = uv ? `${uv.value} at ${uv.time}${uv.value > 10 ? ' — extreme' : ''}` : null;
  const uvColor = uv && uv.value > 10 ? '#ef4444' : uv && uv.value > 7 ? '#f59e0b' : '#a8a5a0';

  return (
    <View style={styles.pulseSection}>
      <Text style={styles.pulseSectionLabel}>TODAY&apos;S TIMELINE</Text>
      {sunrise ? <Text style={styles.pulseRow}>🌅  Sunrise: {sunrise}</Text> : null}
      {peak ? (
        <Text style={styles.pulseRow}>
          ☀️  Peak: {peak.tempF}°F at {peak.time}
        </Text>
      ) : null}
      {rain ? <Text style={styles.pulseRow}>🌧  Rain: {rain}</Text> : null}
      {uvLabel ? <Text style={[styles.pulseRow, { color: uvColor }]}>☀️  UV: {uvLabel}</Text> : null}
      {sunset ? <Text style={styles.pulseRow}>🌅  Sunset: {sunset}</Text> : null}
    </View>
  );
}

function PulseConditionsSection({ weather }: { weather: PulseData['weather'] }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  // Always show the header even when individual fields are absent, to mark
  // the section's place in the card structure. Individual rows guard on
  // null so a missing humidity reading just drops that one line.
  const tempF = weather?.tempF;
  const heatIndex = weather?.heatIndex;
  const humidity = weather?.humidity;
  const conditions = weather?.conditions;

  const heatRef = heatIndex ?? tempF ?? null;
  const tempColor = heatRef != null && heatRef > 100
    ? '#ef4444'
    : heatRef != null && heatRef > 90 ? '#f59e0b' : '#a8a5a0';
  const humidColor = humidity != null && humidity > 80 ? '#f59e0b' : '#a8a5a0';

  return (
    <View style={styles.pulseSection}>
      <Text style={styles.pulseSectionLabel}>CONDITIONS</Text>
      {tempF != null ? (
        <Text style={[styles.pulseRow, { color: tempColor }]}>
          🌡  {roundInt(tempF)}°F
          {heatIndex != null && heatIndex !== tempF
            ? `, feels like ${roundInt(heatIndex)}°F`
            : ''}
        </Text>
      ) : null}
      {humidity != null ? (
        <Text style={[styles.pulseRow, { color: humidColor }]}>
          💧  {roundInt(humidity)}%
        </Text>
      ) : null}
      {conditions ? (
        <Text style={[styles.pulseRow, { color: '#a8a5a0' }]}>{conditions}</Text>
      ) : null}
    </View>
  );
}

function PulseLoadSection({
  signalLoad,
  urgentCount,
}: {
  signalLoad: PulseData['signalLoad'];
  urgentCount: number;
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  // Defensive: signalLoad comes from /api/brief and could be missing
  // on a malformed payload. signalLoad.charAt would crash.
  const safeLoad = typeof signalLoad === 'string' && signalLoad.length > 0 ? signalLoad : 'unknown';
  const loadLabel = safeLoad.charAt(0).toUpperCase() + safeLoad.slice(1);
  const safeUrgent = typeof urgentCount === 'number' ? urgentCount : 0;
  let loadColor = '#a8a5a0';
  if (safeLoad === 'heavy') loadColor = '#f59e0b';
  else if (safeLoad === 'moderate') loadColor = accentColor;
  return (
    <View style={styles.pulseSection}>
      <Text style={styles.pulseSectionLabel}>SIGNAL LOAD</Text>
      <Text style={[styles.pulseRow, { color: loadColor }]}>{loadLabel}</Text>
      {safeUrgent > 0 ? (
        <Text style={[styles.pulseRow, { color: '#ef4444' }]}>
          {safeUrgent} urgent
        </Text>
      ) : null}
    </View>
  );
}

function PulseFlagsSection({ flags }: { flags: string[] }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const phrased = (flags || [])
    .map((f) => PULSE_FLAG_PHRASES[f])
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (phrased.length === 0) return null;
  return (
    <View style={styles.pulseSection}>
      <Text style={styles.pulseSectionLabel}>CONDUCTOR NOTICED</Text>
      {phrased.map((phrase, i) => (
        <Text key={i} style={[styles.pulseRow, { color: '#d6d3cd' }]}>
          {phrase}
        </Text>
      ))}
    </View>
  );
}

export default function TakeoffScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [brief, setBrief] = useState('');
  const [segments, setSegments] = useState<BriefSegment[]>([]);
  const [transparency, setTransparency] = useState<string | null>(null);
  const [showTransparency, setShowTransparency] = useState(false);
  // The Read — overflow context Conductor deemed worth knowing but
  // not worth leading with. Collapsed by default; expand fades the
  // prose in via Animated.timing on opacity.
  const [theRead, setTheRead] = useState<string | null>(null);
  const [theReadExpanded, setTheReadExpanded] = useState(false);
  // Week in Review — only present in Clearance mode on Sundays. Server
  // returns null on non-Sunday and on empty memory weeks; the mobile
  // section is conditional on truthy.
  const [weekInReview, setWeekInReview] = useState<string | null>(null);
  // Month in Review — only populated on the last day of an ET month
  // (clearance only). Rendered below Week in Review when present.
  const [monthInReview, setMonthInReview] = useState<string | null>(null);
  // Year in Review — clearance only, December 31 only. Treated as a
  // major surface — thicker brass divider, slightly larger type,
  // small "Saved to your household record" italic underneath.
  const [yearInReview, setYearInReview] = useState<string | null>(null);
  const theReadOpacity = useRef(new Animated.Value(0)).current;
  // The Pulse — synthesis layer output: one warm sentence summarizing the
  // day's signal load + health + weather as a single editorial cue, plus
  // the synthesis flags that produced it (revealed on tap).
  const [pulse, setPulse] = useState<string | null>(null);
  const [pulseFlags, setPulseFlags] = useState<string[]>([]);
  const [pulseData, setPulseData] = useState<PulseData | null>(null);
  const [pulseExpanded, setPulseExpanded] = useState(false);
  // Handoff — coordination prompt surfaced when one member is
  // blocked and another can cover. `acked` flips to true after the
  // user taps the ack button; we keep the row mounted briefly to
  // show "Acknowledged" before fading.
  const [handoff, setHandoff] = useState<{ signalId: string; message: string } | null>(null);
  const [handoffAcked, setHandoffAcked] = useState(false);
  // Maintenance plan offer — brief returns true when inventory is
  // rich enough + no fresh plan exists + 7-day cooldown clear.
  const [maintenancePlanOffer, setMaintenancePlanOffer] = useState(false);
  // Quick-action popover — opened by long-press on a brief signal
  // chip. Holds the targeted signal id + content phrase so the
  // popover can render a confirmation header naming what was tapped.
  // `acted` flips after the user picks an action and drives the
  // optimistic UI: a brief strikethrough/dim/fade on the chip and
  // popover dismissal. `quickActed` is the per-signal map of applied
  // actions so we can keep chips dimmed/struck across re-renders.
  const [quickActionTarget, setQuickActionTarget] = useState<
    { signalId: string | number; phrase: string } | null
  >(null);
  const [quickActed, setQuickActed] = useState<
    Record<string, 'done' | 'snoozed' | 'dismissed'>
  >({});
  // One-time tutorial flags. Loaded from AsyncStorage on mount and
  // gated per-feature so each tooltip appears exactly once per
  // device. Setting a flag never un-sets — these are first-run hints.
  const [showSignalTapTip, setShowSignalTapTip] = useState(false);
  const [showPulseTip, setShowPulseTip] = useState(false);
  // Resolution moment — a brief "Rested ✓" toast fades in at the
  // top of the brief screen for 2s when the user taps Done on a
  // quick-action popover or the Finale Rest button (via deep-link
  // params from FinaleSheet). Pairs with conductorHaptics.signalRested
  // for the haptic side of the moment.
  const [restedToast, setRestedToast] = useState(false);
  // Conductor sheet — bottom sheet opened by tapping the Minimap.
  // Same component used by ScreenHeader on every other screen, so the
  // affordance is uniform.
  const [conductorSheetOpen, setConductorSheetOpen] = useState(false);
  const urgentCount = useUrgentCount();

  // Took Care Of band — items Conductor auto-resolved or expired
  // in the last 48h. Collapsed by default. Per-item dismissals are
  // persisted to AsyncStorage so a return-to-Ground doesn't undo
  // them.
  const [autoResolutions, setAutoResolutions] = useState<
    {
      signalId: string | number;
      description: string;
      sender: string | null;
      action: string;
      resolvedAt: string;
      wasAutomatic: boolean;
    }[]
  >([]);
  const [autoResExpanded, setAutoResExpanded] = useState(false);
  const [dismissedAutoRes, setDismissedAutoRes] = useState<Set<string>>(new Set());
  // Conductor's one proactive question per brief. Stored alongside
  // a per-day set of dismissed/acknowledged question texts so the
  // same prompt doesn't reappear when the brief refreshes within
  // the same ET day.
  const [conductorQuestion, setConductorQuestion] = useState<string | null>(null);
  const [conductorQuestionAcked, setConductorQuestionAcked] = useState<
    'ack' | 'dismissed' | null
  >(null);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  // Ask Conductor — single-shot Q&A. Always fresh call (server-side
  // 30min cache covers the duplicate-question case). State carries the
  // current question draft, the loading flag, the answer/error result.
  const [askQuestion, setAskQuestion] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askAction, setAskAction] = useState<{
    type: string;
    setting?: string;
    value?: any;
    label?: string;
    destination?: string;
  } | null>(null);
  const [askError, setAskError] = useState(false);
  const askInputRef = useRef<TextInput | null>(null);
  // Suggestion chips appear below the input when it's focused — give
  // users a starting point for common home-services questions.
  const [askFocused, setAskFocused] = useState(false);
  // Speech playback state — driven by AsyncStorage's
  // voiceResponsesEnabled toggle. When the brief or ask answer comes
  // back AND speech is enabled, we route the spoken summary through
  // expo-speech. The Stop button below the answer surfaces while
  // speech is active.
  const [speechActive, setSpeechActive] = useState(false);
  const voiceEnabledRef = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem('voiceResponsesEnabled');
        voiceEnabledRef.current = v === 'true';
      } catch { /* ignore */ }
    })();
  }, []);
  const stopSpeech = useCallback(() => {
    try { Speech.stop(); } catch { /* ignore */ }
    setSpeechActive(false);
  }, []);
  const speak = useCallback((text: string | null | undefined) => {
    if (!text || !voiceEnabledRef.current) return;
    try {
      Speech.stop();
      setSpeechActive(true);
      Speech.speak(text, {
        language: 'en-US',
        pitch: 1.0,
        rate: 0.88,
        onDone: () => setSpeechActive(false),
        onStopped: () => setSpeechActive(false),
        onError: () => setSpeechActive(false),
      });
    } catch {
      setSpeechActive(false);
    }
  }, []);

  // Shake-to-ask: shake fires haptic + focuses the question input so
  // the keyboard's native dictation button is one tap away. Reuses
  // existing ask input so we don't need a separate "Listening" state.
  useShakeToAsk(() => {
    conductorHaptics.newSignal();
    setTimeout(() => askInputRef.current?.focus(), 60);
  });
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [greeting, setGreeting] = useState('');
  // userName comes from the brief API response (`data.user`). The
  // 'there' default mirrors what brief.js falls back to server-side
  // when the user profile lookup fails; the render layer treats it
  // as "no name yet, render the bare greeting."
  const [userName, setUserName] = useState('there');
  const [date, setDate] = useState('');
  const [mode, setMode] = useState(getBriefMode(new Date().getHours()));
  const [showYesterday, setShowYesterday] = useState(false);
  const navigation = useNavigation();

  // Hide the bottom tab bar while Overwatch is active. Reaching `getParent()`
  // walks up to the Tabs navigator where the tabBarStyle option is meaningful.
  // The cleanup restores the bar when the screen unmounts or the mode flips.
  useEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    if (mode.title === 'Overwatch') {
      parent.setOptions({ tabBarStyle: { display: 'none' } });
    } else {
      parent.setOptions({ tabBarStyle: undefined });
    }
    return () => {
      parent.setOptions({ tabBarStyle: undefined });
    };
  }, [mode.title, navigation]);

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 17) setGreeting('Good afternoon');
    else setGreeting('Good evening');

    setMode(getBriefMode(hour));

    setDate(now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }));

    checkConnection();
    registerForPushNotifications();
    syncHealthIfStale();

    // Lock-screen action handler — REST/HOLD on SIGNAL_FOLLOWUP and
    // REST/TRACK on PACKAGE_TRACKING. Payload data was set by the
    // backend send paths so we can PATCH the signal without opening
    // the app. TRACK falls through naturally because its iOS option
    // opensAppToForeground=true (no JS work needed here).
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const actionId = response.actionIdentifier;
        const data: any = response.notification.request.content.data || {};
        const signalId = data.signalId;
        const userId = data.userId || 'james_totalhome_gmail_com';
        if (!signalId) return;
        if (actionId === 'REST') {
          fetch('https://conductor-ivory.vercel.app/api/signals', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: signalId, userId, state: 'resolved' }),
          }).catch(() => {});
        } else if (actionId === 'HOLD') {
          fetch('https://conductor-ivory.vercel.app/api/signals', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: signalId,
              userId,
              state: 'active',
              notedAt: new Date().toISOString(),
            }),
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('[notifications] response handler:', err);
      }
    });
    return () => { sub.remove(); };
  }, []);

  async function checkConnection() {
    try {
      const res = await fetch('https://conductor-ivory.vercel.app/api/signals?userId=james_totalhome_gmail_com');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.signals)) throw new Error('Invalid response: missing signals array');
      setConnected(true);
      generateBrief();
    } catch (err) {
      setConnected(false);
      setLoading(false);
    }
  }

  async function generateBrief() {
    // Each brief generation is its own session for feedback purposes — wipe
    // any previous thumbs choice so the buttons return to their resting
    // state on reload. Same for The Read — collapse it and clear any
    // stale content so the new brief's overflow doesn't leak from the
    // previous session.
    setFeedback(null);
    setTheRead(null);
    setTheReadExpanded(false);
    setWeekInReview(null);
    theReadOpacity.setValue(0);
    setPulse(null);
    setPulseFlags([]);
    setPulseData(null);
    setPulseExpanded(false);
    // Ask Conductor — full reset on brief regenerate. Carrying an answer
    // across briefs would imply continuity that isn't there yet.
    setAskQuestion('');
    setAskLoading(false);
    setAskAnswer(null);
    setAskError(false);
    const { endpoint } = getBriefMode(new Date().getHours());
    if (!endpoint) {
      // Overwatch mode — no brief to fetch. Just exit loading so the
      // OverwatchView renders.
      setLoading(false);
      return;
    }
    try {
      const userId = 'james_totalhome_gmail_com'; // temporary hardcode — will come from OAuth
      const res = await fetchBriefWithRetry(`https://conductor-ivory.vercel.app/api/${endpoint}?userId=${userId}`);
      const data = await res.json();
      if (typeof data.user === 'string' && data.user.length > 0) {
        setUserName(data.user);
      }
      setBrief(data.brief);
      if (Array.isArray(data.segments) && data.segments.length > 0) {
        setSegments(data.segments);
      } else {
        setSegments([{ type: 'text', content: data.brief || '' }]);
      }
      // Speak the brief summary on Takeoff load when voice toggle on.
      // Delayed by 1s so the user has a beat to land on the screen
      // before the audio starts. Skips Clearance/Overwatch modes.
      if (mode.endpoint === 'brief' && typeof data.spokenSummary === 'string' && data.spokenSummary.length > 0) {
        setTimeout(() => speak(data.spokenSummary), 1000);
      }
      setTransparency(typeof data.transparency === 'string' && data.transparency.length > 0
        ? data.transparency
        : null);
      setTheRead(typeof data.theRead === 'string' && data.theRead.length > 0
        ? data.theRead
        : null);
      setWeekInReview(typeof data.weekInReview === 'string' && data.weekInReview.length > 0
        ? data.weekInReview
        : null);
      setMonthInReview(typeof data.monthInReview === 'string' && data.monthInReview.length > 0
        ? data.monthInReview
        : null);
      setYearInReview(typeof data.yearInReview === 'string' && data.yearInReview.length > 0
        ? data.yearInReview
        : null);
      setPulse(typeof data.pulse === 'string' && data.pulse.length > 0
        ? data.pulse
        : null);
      setPulseFlags(Array.isArray(data.pulseFlags) ? data.pulseFlags : []);
      setPulseData(data.pulseData && typeof data.pulseData === 'object'
        ? (data.pulseData as PulseData)
        : null);
      setHandoff(
        data.handoff && typeof data.handoff === 'object' && data.handoff.signalId && data.handoff.message
          ? { signalId: String(data.handoff.signalId), message: String(data.handoff.message) }
          : null
      );
      setHandoffAcked(false);
      setMaintenancePlanOffer(data.maintenancePlanOffer === true);

      // One-time tooltips — only flip on once. Signal-tap tooltip
      // shows when the brief actually has chip segments to point at;
      // Pulse tooltip shows when pulse is present + auto-dismisses
      // after 4s on first viewing.
      try {
        const seenTap = await AsyncStorage.getItem('tutorial_signal_tap');
        const segArr = Array.isArray(data.segments) ? data.segments : [];
        if (!seenTap && segArr.some((s: any) => s?.type === 'signal')) {
          setShowSignalTapTip(true);
        }
      } catch { /* ignore */ }
      try {
        const seenPulse = await AsyncStorage.getItem('tutorial_pulse');
        if (!seenPulse && typeof data.pulse === 'string' && data.pulse.length > 0) {
          setShowPulseTip(true);
          setTimeout(() => {
            setShowPulseTip(false);
            AsyncStorage.setItem('tutorial_pulse', 'done').catch(() => {});
          }, 4000);
        }
      } catch { /* ignore */ }

      // Conductor question — load + filter against today's
      // dismissed-questions list so the user doesn't see the same
      // prompt twice within an ET day.
      const incomingQ =
        typeof data.conductorQuestion === 'string' && data.conductorQuestion.length > 0
          ? data.conductorQuestion
          : null;
      try {
        const todayKey = new Date().toLocaleDateString('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric', month: '2-digit', day: '2-digit',
        });
        const rawList = await AsyncStorage.getItem('conductorQ:dismissed:' + todayKey);
        const dismissedToday = rawList ? new Set(JSON.parse(rawList) as string[]) : new Set<string>();
        if (incomingQ && dismissedToday.has(incomingQ)) {
          setConductorQuestion(null);
        } else {
          setConductorQuestion(incomingQ);
        }
      } catch {
        setConductorQuestion(incomingQ);
      }
      setConductorQuestionAcked(null);
    } catch (err) {
      const fallback = "Nothing to report today. You're clear.";
      setBrief(fallback);
      setSegments([{ type: 'text', content: fallback }]);
      setTransparency(null);
    } finally {
      setLoading(false);
    }

    // Fire-and-forget — populates the Took Care Of band after the
    // main brief renders so the brief isn't blocked on this fetch.
    fetch(
      'https://conductor-ivory.vercel.app/api/signals?type=autoResolutions&userId=james_totalhome_gmail_com'
    )
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.items)) setAutoResolutions(d.items);
      })
      .catch(() => {});
    try {
      const dismissedRaw = await AsyncStorage.getItem('autoRes:dismissed');
      if (dismissedRaw) {
        const arr = JSON.parse(dismissedRaw);
        if (Array.isArray(arr)) setDismissedAutoRes(new Set(arr));
      }
    } catch {
      // best-effort
    }
  }

  async function handleSignalTap(signalId: string | number) {
    try {
      await AsyncStorage.setItem(PENDING_SIGNAL_KEY, String(signalId));
    } catch {
      // best-effort — still navigate
    }
    router.push('/(tabs)/hover');
  }

  function togglePulse() {
    // 250ms easeInEaseOut height animation. LayoutAnimation schedules the
    // next layout pass to interpolate — the state flip on the next line
    // triggers the re-render that supplies the new height.
    LayoutAnimation.configureNext({
      duration: 250,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    setPulseExpanded((v) => !v);
  }

  function toggleTheRead() {
    // Expanding: mount the Animated.Text first (state flip), then
    // ramp opacity 0→1. Collapsing: ramp opacity 1→0 first, THEN
    // unmount via state flip on animation finish — so the prose
    // fades out before vanishing from layout rather than snapping.
    if (theReadExpanded) {
      Animated.timing(theReadOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setTheReadExpanded(false);
      });
    } else {
      setTheReadExpanded(true);
      theReadOpacity.setValue(0);
      Animated.timing(theReadOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }

  async function submitAsk() {
    const q = askQuestion.trim();
    if (q.length === 0) return;
    if (askLoading) return;
    setAskLoading(true);
    setAskError(false);
    setAskAnswer(null);
    try {
      const res = await fetch('https://conductor-ivory.vercel.app/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'james_totalhome_gmail_com',
          question: q,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data?.answer !== 'string' || data.answer.length === 0) {
        throw new Error('empty answer');
      }
      setAskAnswer(data.answer);
      // Spoken response — gated on the voiceResponsesEnabled toggle.
      // Prefer the spokenAnswer field if backend returned one, fall
      // back to the written answer.
      speak(data.spokenAnswer || data.answer);
      // New: action handling. NAVIGATE auto-routes after a beat;
      // confirm_setting holds for the user to tap Yes/No (handled
      // by askAction state below).
      if (data?.action) {
        if (data.action.type === 'navigate' && typeof data.action.destination === 'string') {
          setTimeout(() => router.push(data.action.destination as any), 700);
        } else if (data.action.type === 'confirm_setting') {
          setAskAction(data.action);
        } else if (data.action.type === 'navigate_offer' && typeof data.action.destination === 'string') {
          setAskAction(data.action);
        }
      }
    } catch {
      setAskError(true);
    } finally {
      setAskLoading(false);
    }
  }

  function resetAsk() {
    // "Ask another →" — clear the current answer, blank the input,
    // refocus so the user lands directly on the keyboard.
    setAskAnswer(null);
    setAskError(false);
    setAskQuestion('');
    setTimeout(() => askInputRef.current?.focus(), 0);
  }

  function handleFeedback(rating: 'up' | 'down') {
    // Local state updates immediately so the UI feels instant. The POST is
    // fire-and-forget — backend write failures stay silent because the user
    // already saw their tap acknowledged.
    setFeedback(rating);
    const briefType = mode.endpoint === 'brief' ? 'takeoff' : 'clearance';
    fetch('https://conductor-ivory.vercel.app/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'james_totalhome_gmail_com',
        briefType,
        rating,
        briefDate: new Date().toISOString(),
      }),
    }).catch(() => {});
  }

  function handleConnect() {
    Linking.openURL('https://conductor-ivory.vercel.app/api/auth');
  }

  if (!connected && !loading) {
    return (
      <View style={styles.onboarding}>
        <View style={styles.onboardingLogo}>
          <Text style={styles.logoMark}>C</Text>
        </View>
        <Text style={styles.onboardingTitle}>Conductor</Text>
        <Text style={styles.onboardingSubtitle}>Your household, orchestrated.</Text>
        <View style={styles.onboardingDivider} />
        <Text style={styles.onboardingBody}>
          Connect your Gmail and Google Calendar. Conductor reads your signals and delivers a calm morning brief — what's arriving, what's scheduled, what matters today.
        </Text>
        <TouchableOpacity style={styles.connectButton} onPress={handleConnect}>
          <Text style={styles.connectButtonText}>Connect your household</Text>
        </TouchableOpacity>
        <Text style={styles.onboardingPrivacy}>
          We only read what you choose to share. Your emails stay private.
        </Text>
      </View>
    );
  }

  // Overwatch — overnight idle surface (10pm–7am). Renders alongside the
  // YesterdayModal so the same modal can be opened from the bottom link.
  if (mode.title === 'Overwatch') {
    // Swipe right (+X) → Hover; swipe left (−X) → Settings. 50px threshold.
    const overwatchSwipe = Gesture.Pan()
      .activeOffsetX([-30, 30])
      .failOffsetY([-20, 20])
      .runOnJS(true)
      .onEnd((e) => {
        if (Math.abs(e.translationY) >= 80) return;
        if (e.translationX > 50) router.push('/(tabs)/hover');
        else if (e.translationX < -50) router.push('/(tabs)/settings');
      });
    return (
      <>
        <GestureDetector gesture={overwatchSwipe}>
          <View style={{ flex: 1 }}>
            <OverwatchView onYesterday={() => setShowYesterday(true)} />
          </View>
        </GestureDetector>
        <YesterdayModal
          visible={showYesterday}
          userId="james_totalhome_gmail_com"
          onClose={() => setShowYesterday(false)}
        />
      </>
    );
  }

  // Swipe left → go to Hover
  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-30, 30])
    .failOffsetY([-20, 20])
    .runOnJS(true)
    .onEnd((e) => {
      if (e.translationX < -60 && Math.abs(e.translationY) < 80) {
        router.push('/(tabs)/hover');
      }
    });

  const bandTheme = mode.title === 'Takeoff' ? makeTakeoffTheme(theme) : makeClearanceTheme(theme);

  return (
    <View style={[styles.container, { backgroundColor: bandTheme.bg }]}>
      {/* Positioned to the left of the Minimap (40x40 at right: 20, top: 60).
          Minimap's left edge is 60px from screen right; HelpButton's right
          edge sits at 68px to give an 8px gap. */}
      <HelpButton cardId="brief" right={68} />
      {restedToast ? (
        <View pointerEvents="none" style={styles.restedToast}>
          <Text style={styles.restedToastText}>Rested ✓</Text>
        </View>
      ) : null}
      <GestureDetector gesture={swipeGesture}>
        <ScrollView
          style={styles.scrollFlex}
          contentContainerStyle={styles.content}>
          <Minimap
            urgentCount={urgentCount}
            onPress={() => setConductorSheetOpen(true)}
          />
          <ConductorSheet
            visible={conductorSheetOpen}
            onClose={() => setConductorSheetOpen(false)}
          />
          <View style={styles.header}>
            <Text style={[styles.greeting, { color: bandTheme.greeting }]}>
              {greeting}{userName && userName !== 'there' ? `, ${userName}` : ''}.
            </Text>
            <Text style={[styles.title, { color: bandTheme.title }]}>{mode.title}</Text>
          </View>

          {pulse ? (
            // The Pulse — synthesis layer output. One warm editorial
            // sentence; tap expands inline into the full health + context
            // card via LayoutAnimation. Card sections render from
            // pulseData with per-field null guards.
            <TouchableOpacity
              onPress={togglePulse}
              activeOpacity={0.6}
              hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
              style={styles.pulseWrap}>
              <Text style={styles.pulseLabel}>THE PULSE</Text>
              <Text style={styles.pulseText}>{pulse}</Text>
              {showPulseTip ? (
                <View style={styles.tooltipInline} pointerEvents="box-none">
                  <Tooltip
                    visible={showPulseTip}
                    message="Tap to see what Conductor is synthesizing today."
                    arrow="up"
                    showButton={false}
                    onDismiss={() => setShowPulseTip(false)}
                  />
                </View>
              ) : null}
              {pulseExpanded && pulseData ? (
                <View style={styles.pulseCard}>
                  <PulseHealthSection health={pulseData.health} />
                  <PulseConditionsSection weather={pulseData.weather} />
                  <PulseTimelineSection weather={pulseData.weather} />
                  <PulseLoadSection
                    signalLoad={pulseData.signalLoad}
                    urgentCount={pulseData.urgentCount}
                  />
                  <PulseFlagsSection flags={pulseData.synthesisFlags} />
                </View>
              ) : null}
            </TouchableOpacity>
          ) : null}

          {mode.title !== 'Overwatch' ? (
            // Ask Conductor — single-shot Q&A. Placed below The Pulse and
            // above the in-flow date so the input is the natural next
            // landing spot after reading the synthesis sentence. Overwatch
            // mode has no brief, so the question UI is hidden there too.
            <View style={styles.askWrap}>
              <View style={styles.askInputRow}>
                <TextInput
                  ref={askInputRef}
                  value={askQuestion}
                  onChangeText={setAskQuestion}
                  onSubmitEditing={submitAsk}
                  onFocus={() => setAskFocused(true)}
                  onBlur={() => setAskFocused(false)}
                  placeholder="Ask Conductor..."
                  placeholderTextColor={theme.muted}
                  returnKeyType="send"
                  editable={!askLoading}
                  blurOnSubmit={false}
                  style={styles.askInput}
                />
                <TouchableOpacity
                  onPress={submitAsk}
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  disabled={askLoading || askQuestion.trim().length === 0}>
                  <Text
                    style={[
                      styles.askSend,
                      (askLoading || askQuestion.trim().length === 0) && { opacity: 0.4 },
                    ]}>
                    →
                  </Text>
                </TouchableOpacity>
              </View>
              {askFocused && !askAnswer && !askLoading ? (
                // Suggestion chips — derived from brief state at render
                // time so they're contextually useful for what's
                // actually on the user's radar today.
                <View style={styles.askChipsRow}>
                  {buildAskChips({
                    segments,
                    urgentCount: pulseData?.urgentCount || 0,
                    pulseFlags,
                    pulseData,
                    conductorQuestion,
                    maintenancePlanOffer,
                    modeIsTakeoff: mode.endpoint === 'brief',
                  }).slice(0, 3).map((q) => (
                    <TouchableOpacity
                      key={q}
                      onPress={() => {
                        setAskQuestion(q);
                        askInputRef.current?.focus();
                      }}
                      activeOpacity={0.6}
                      style={styles.askChip}>
                      <Text style={styles.askChipText}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              {askLoading ? (
                <Text style={styles.askThinking}>Conductor is thinking...</Text>
              ) : null}
              {!askLoading && askError ? (
                <Text style={styles.askThinking}>Conductor couldn&apos;t reach that one. Try again.</Text>
              ) : null}
              {!askLoading && !askError && askAnswer ? (
                <View style={styles.askAnswerCard}>
                  <Text style={[styles.askAnswerText, { color: bandTheme.brief }]}>{askAnswer}</Text>
                  {speechActive ? (
                    <TouchableOpacity onPress={stopSpeech} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Text style={{ color: theme.muted, fontSize: 11, marginTop: 8 }}>■ Stop</Text>
                    </TouchableOpacity>
                  ) : null}
                  {askAction?.type === 'confirm_setting' ? (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                      <TouchableOpacity
                        onPress={async () => {
                          // Best-effort: route the user to settings for now.
                          // A future patch endpoint would apply the setting
                          // server-side.
                          setAskAction(null);
                          router.push('/settings' as never);
                        }}
                        style={{
                          flex: 1,
                          paddingVertical: 11,
                          borderRadius: 22,
                          backgroundColor: accentColor,
                          alignItems: 'center',
                        }}>
                        <Text style={{ color: theme.background, fontSize: 13, fontWeight: '600' }}>
                          Yes, do it →
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setAskAction(null)}
                        style={{
                          flex: 1,
                          paddingVertical: 11,
                          borderRadius: 22,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: theme.inputBackground,
                          alignItems: 'center',
                        }}>
                        <Text style={{ color: theme.muted, fontSize: 13 }}>No thanks</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => { resetAsk(); setAskAction(null); }}
                    activeOpacity={0.6}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.askAnotherWrap}>
                    <Text style={styles.askAnother}>Ask another →</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.inFlowDate}>{date}</Text>

          <View style={[styles.divider, { backgroundColor: bandTheme.divider }]} />

          <TouchableOpacity
            onPress={() => setShowYesterday(true)}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.inFlowYesterday}>Yesterday&apos;s Programme →</Text>
          </TouchableOpacity>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={bandTheme.brief} />
              <Text style={styles.loadingText}>Generating your brief...</Text>
            </View>
          ) : (
            <View style={styles.briefContainer}>
              <Text style={[styles.brief, { color: bandTheme.brief }]}>
                {(segments.length > 0 ? segments : [{ type: 'text', content: brief } as BriefSegment]).map((seg, i) => {
                  if (seg.type === 'signal') {
                    const color = (seg.signalType && SIGNAL_TYPE_COLORS[seg.signalType]) || DEFAULT_SIGNAL_COLOR;
                    const acted = quickActed[String(seg.signalId)];
                    // Optimistic chip styling per applied action.
                    const chipExtra: any = {};
                    if (acted === 'done') chipExtra.textDecorationLine = 'line-through';
                    else if (acted === 'snoozed') chipExtra.opacity = 0.45;
                    else if (acted === 'dismissed') chipExtra.opacity = 0.25;
                    return (
                      <Text
                        key={i}
                        onPress={() => handleSignalTap(seg.signalId)}
                        onLongPress={() =>
                          setQuickActionTarget({
                            signalId: seg.signalId,
                            phrase: seg.content || '',
                          })
                        }
                        style={{
                          textDecorationLine: acted === 'done' ? 'line-through' : 'underline',
                          textDecorationColor: color,
                          textDecorationStyle: 'solid',
                          ...chipExtra,
                        }}>
                        {seg.content}
                      </Text>
                    );
                  }
                  return <Text key={i}>{seg.content}</Text>;
                })}
              </Text>
              {showSignalTapTip ? (
                <View style={styles.tooltipInline} pointerEvents="box-none">
                  <Tooltip
                    visible={showSignalTapTip}
                    message="Tap any highlighted phrase to see details and take action."
                    arrow="up"
                    onDismiss={() => {
                      setShowSignalTapTip(false);
                      AsyncStorage.setItem('tutorial_signal_tap', 'done').catch(() => {});
                    }}
                  />
                </View>
              ) : null}
            </View>
          )}

          {!loading && handoff ? (
            // Handoff ack row — small brass button right-aligned
            // below the brief prose. Tap POSTs to the ack endpoint
            // and flips the row to a muted "Acknowledged" label that
            // unmounts after 3s.
            <View style={styles.handoffWrap}>
              {handoffAcked ? (
                <Text style={styles.handoffAckedText}>Acknowledged</Text>
              ) : (
                <TouchableOpacity
                  onPress={async () => {
                    setHandoffAcked(true);
                    try {
                      await fetch(
                        'https://conductor-ivory.vercel.app/api/signals?type=handoff',
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            signalId: handoff.signalId,
                            acknowledgedBy: 'james_totalhome_gmail_com',
                            userId: 'james_totalhome_gmail_com',
                          }),
                        }
                      );
                    } catch {
                      // Best-effort — the next brief will still suppress
                      // it if the write reached Redis; if not, the user
                      // can tap again on the next brief.
                    }
                    setTimeout(() => setHandoff(null), 3000);
                  }}
                  activeOpacity={0.6}
                  style={styles.handoffBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.handoffBtnText}>{userName || 'You'} has this ✓</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {!loading && (() => {
            // Took Care Of band — items Conductor auto-resolved or
            // expired in the last 48h, minus per-item dismissals.
            const visible = autoResolutions.filter(
              (i) => !dismissedAutoRes.has(String(i.signalId))
            );
            if (visible.length === 0) return null;
            const actionLabel = (a: string) =>
              a === 'expired' ? 'passed ✓' : 'handled ✓';
            return (
              <View style={styles.autoResWrap}>
                <TouchableOpacity
                  onPress={() => {
                    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
                    LayoutAnimation.configureNext({
                      duration: 200,
                      create: { type: 'easeInEaseOut', property: 'opacity' },
                      update: { type: 'easeInEaseOut' },
                    });
                    setAutoResExpanded((v) => !v);
                  }}
                  activeOpacity={0.6}
                  style={styles.autoResHeader}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.autoResHeaderText}>
                    Conductor took care of {visible.length} thing
                    {visible.length === 1 ? '' : 's'} ✓ {autoResExpanded ? '−' : '+'}
                  </Text>
                </TouchableOpacity>
                {autoResExpanded && (
                  <View style={styles.autoResList}>
                    {visible.slice(0, 8).map((item) => (
                      <View key={String(item.signalId)} style={styles.autoResRow}>
                        <Text style={styles.autoResDesc} numberOfLines={2}>
                          {item.description || 'Signal'}
                        </Text>
                        <Text style={styles.autoResLabel}>
                          {actionLabel(item.action)}
                        </Text>
                        <TouchableOpacity
                          onPress={() => {
                            const next = new Set(dismissedAutoRes);
                            next.add(String(item.signalId));
                            setDismissedAutoRes(next);
                            AsyncStorage.setItem('autoRes:dismissed', JSON.stringify([...next])).catch(() => {});
                          }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          <Text style={styles.autoResDismiss}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    <View style={styles.autoResFooter}>
                      <TouchableOpacity
                        onPress={() => router.push('/journal' as never)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Text style={styles.autoResViewAllText}>View all →</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          const all = new Set([
                            ...dismissedAutoRes,
                            ...visible.map((i) => String(i.signalId)),
                          ]);
                          setDismissedAutoRes(all);
                          AsyncStorage.setItem('autoRes:dismissed', JSON.stringify([...all])).catch(() => {});
                        }}>
                        <Text style={styles.autoResDismissAllText}>Dismiss all</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })()}

          {!loading && maintenancePlanOffer ? (
            // Maintenance plan offer card. Appears once per 7-day
            // window when the household has enough inventory and
            // no fresh plan. "Build plan →" routes to /maintenance
            // with ?generate=true to kick off generation on landing.
            // "Not now" POSTs ?action=dismiss and hides the card
            // for good.
            <View style={styles.maintOfferCard}>
              <Text style={styles.maintOfferTitle}>
                🏠  Conductor can build your home maintenance plan
              </Text>
              <Text style={styles.maintOfferSub}>
                Based on your inventory and seasonal patterns.
              </Text>
              <View style={styles.maintOfferRow}>
                <TouchableOpacity
                  onPress={() => {
                    setMaintenancePlanOffer(false);
                    router.push('/maintenance?generate=true' as never);
                  }}
                  style={styles.maintOfferPrimary}
                  activeOpacity={0.7}>
                  <Text style={styles.maintOfferPrimaryText}>Build plan →</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setMaintenancePlanOffer(false);
                    fetch('https://conductor-ivory.vercel.app/api/maintenance', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'dismiss', userId: 'james_totalhome_gmail_com' }),
                    }).catch(() => {});
                  }}
                  style={styles.maintOfferSecondary}
                  activeOpacity={0.7}>
                  <Text style={styles.maintOfferSecondaryText}>Not now</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {!loading && conductorQuestion ? (
            // Conductor's one proactive question — surfaced below
            // the Took Care Of band, above the feedback row. Two
            // small actions: "On it" (acknowledge) and "Remove"
            // (dismiss). Both fire-and-forget telemetry POSTs to
            // /api/signals?type=conductorQuestion. Dismissals also
            // persist per-day to AsyncStorage so the same prompt
            // doesn't reappear during the ET day.
            <View style={styles.conductorQWrap}>
              <Text style={styles.conductorQLabel}>CONDUCTOR ASKS</Text>
              <Text style={styles.conductorQText}>{conductorQuestion}</Text>
              {conductorQuestionAcked === 'ack' ? (
                <Text style={styles.conductorQAckedText}>Got it ✓</Text>
              ) : conductorQuestionAcked === 'dismissed' ? null : (
                <View style={styles.conductorQRow}>
                  <TouchableOpacity
                    style={[styles.conductorQBtn, styles.conductorQOnIt]}
                    onPress={() => {
                      setConductorQuestionAcked('ack');
                      const q = conductorQuestion;
                      fetch('https://conductor-ivory.vercel.app/api/signals?type=conductorQuestion', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          userId: 'james_totalhome_gmail_com',
                          question: q,
                          response: 'acknowledged',
                        }),
                      }).catch(() => {});
                      setTimeout(() => setConductorQuestion(null), 2000);
                    }}>
                    <Text style={styles.conductorQOnItText}>On it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.conductorQBtn, styles.conductorQRemove]}
                    onPress={async () => {
                      setConductorQuestionAcked('dismissed');
                      const q = conductorQuestion;
                      // Persist per-day dismissal so the same prompt
                      // doesn't reappear after a brief refresh.
                      try {
                        const todayKey = new Date().toLocaleDateString('en-US', {
                          timeZone: 'America/New_York',
                          year: 'numeric', month: '2-digit', day: '2-digit',
                        });
                        const k = 'conductorQ:dismissed:' + todayKey;
                        const raw = await AsyncStorage.getItem(k);
                        const arr = raw ? JSON.parse(raw) : [];
                        if (q && !arr.includes(q)) arr.push(q);
                        await AsyncStorage.setItem(k, JSON.stringify(arr));
                      } catch {
                        // best-effort
                      }
                      fetch('https://conductor-ivory.vercel.app/api/signals?type=conductorQuestion', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          userId: 'james_totalhome_gmail_com',
                          question: q,
                          response: 'dismissed',
                        }),
                      }).catch(() => {});
                      setConductorQuestion(null);
                    }}>
                    <Text style={styles.conductorQRemoveText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : null}

          {!loading && yearInReview ? (
            // Year in Review — clearance only, December 31 only.
            // Treated as the major surface: thicker brass divider,
            // larger type, persistence note underneath.
            <View style={styles.yearInReviewWrap}>
              <View style={styles.yearInReviewBrassLine} />
              <Text style={styles.yearInReviewLabel}>THIS YEAR</Text>
              <Text style={[styles.yearInReviewText, { color: bandTheme.brief }]}>
                {yearInReview}
              </Text>
              <Text style={styles.yearInReviewFooter}>
                Saved to your household record
              </Text>
            </View>
          ) : null}

          {!loading && weekInReview ? (
            // Week in Review — Clearance-only Sunday reflection paragraph.
            // Server returns null on non-Sunday and on empty memory weeks,
            // so this block only renders when there's genuinely something
            // worth reading.
            <View style={styles.weekInReviewWrap}>
              <View style={styles.weekInReviewBrassLine} />
              <Text style={styles.weekInReviewLabel}>THIS WEEK</Text>
              <Text style={[styles.weekInReviewText, { color: bandTheme.brief }]}>
                {weekInReview}
              </Text>
            </View>
          ) : null}

          {!loading && monthInReview ? (
            // Month in Review — only present on the last day of an
            // ET month, clearance-mode only. Same brass-divider
            // pattern as Week in Review, distinct THIS MONTH label.
            <View style={styles.weekInReviewWrap}>
              <View style={styles.weekInReviewBrassLine} />
              <Text style={styles.weekInReviewLabel}>THIS MONTH</Text>
              <Text style={[styles.weekInReviewText, { color: bandTheme.brief }]}>
                {monthInReview}
              </Text>
            </View>
          ) : null}

          {!loading && theRead ? (
            // The Read — overflow context Conductor deemed worth knowing
            // but not worth leading with. Brass separator line, small
            // muted trigger label, Animated.Text below that fades in on
            // expand and fades out before unmounting on collapse.
            <View style={styles.theReadWrap}>
              <View style={styles.theReadBrassLine} />
              <TouchableOpacity
                onPress={toggleTheRead}
                activeOpacity={0.6}
                style={styles.theReadTrigger}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.theReadTriggerText}>
                  The Read  {theReadExpanded ? '−' : '+'}
                </Text>
              </TouchableOpacity>
              {theReadExpanded ? (
                <Animated.Text
                  style={[
                    styles.theReadText,
                    { color: bandTheme.brief, opacity: theReadOpacity },
                  ]}>
                  {theRead}
                </Animated.Text>
              ) : null}
            </View>
          ) : null}

          {!loading ? (
            // Signature feedback — right-aligned, single-line, reads like
            // signing off on the brief. ✓ is always white; ✗ defaults to
            // muted and brightens when chosen. Both dim to 0.2 when their
            // sibling is the active selection.
            <View style={styles.feedbackSignature}>
              <Text style={styles.feedbackSigPrompt}>Was this helpful?</Text>
              <TouchableOpacity
                onPress={() => handleFeedback('up')}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                <Text
                  style={[
                    styles.feedbackSigCheck,
                    { opacity: feedback === 'down' ? 0.2 : 1 },
                  ]}>
                  ✓
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleFeedback('down')}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                <Text
                  style={[
                    styles.feedbackSigX,
                    {
                      color: feedback === 'down' ? theme.text : theme.muted,
                      opacity: feedback === 'up' ? 0.2 : 1,
                    },
                  ]}>
                  ✗
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {!loading && transparency ? (
            <TouchableOpacity
              style={styles.transparencyLinkCentered}
              onPress={() => setShowTransparency(true)}
              activeOpacity={0.6}>
              <Text style={styles.transparencyLinkText}>How Conductor thought about this</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </GestureDetector>

      <YesterdayModal
        visible={showYesterday}
        userId="james_totalhome_gmail_com"
        onClose={() => setShowYesterday(false)}
      />

      <Modal
        visible={showTransparency}
        animationType="slide"
        transparent
        onRequestClose={() => setShowTransparency(false)}>
        <Pressable style={styles.transparencyBackdrop} onPress={() => setShowTransparency(false)}>
          <Pressable style={styles.transparencySheet} onPress={() => {}}>
            <Text style={styles.transparencyHeader}>Conductor&apos;s Reasoning</Text>
            <Text style={styles.transparencyText}>{transparency || ''}</Text>
            <TouchableOpacity
              style={styles.transparencyCloseBtn}
              onPress={() => setShowTransparency(false)}
              activeOpacity={0.7}>
              <Text style={styles.transparencyCloseBtnText}>Shut</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Quick-action popover — long-press on any signal chip in the
          brief brings this up. Three options + dismiss on backdrop tap.
          Optimistic UI: chip styling flips immediately, API call fires
          in the background, errors silently revert via the next brief
          fetch. */}
      <Modal
        visible={quickActionTarget != null}
        animationType="fade"
        transparent
        onRequestClose={() => setQuickActionTarget(null)}>
        <Pressable
          style={styles.quickActionBackdrop}
          onPress={() => setQuickActionTarget(null)}>
          <Pressable style={styles.quickActionSheet} onPress={() => {}}>
            <Text style={styles.quickActionHeader}>
              {quickActionTarget?.phrase || 'Signal'}
            </Text>
            <View style={styles.quickActionRow}>
              <TouchableOpacity
                style={[styles.quickActionBtn, styles.quickActionDone]}
                onPress={() => {
                  const t = quickActionTarget;
                  if (!t) return;
                  setQuickActed((m) => ({ ...m, [String(t.signalId)]: 'done' }));
                  setQuickActionTarget(null);
                  // Success haptic + transient "Rested ✓" toast. Both
                  // fire optimistically before the PATCH lands so the
                  // moment of resolution feels immediate even on a
                  // slow network. The toast auto-dismisses after 2s.
                  conductorHaptics.signalRested();
                  setRestedToast(true);
                  setTimeout(() => setRestedToast(false), 2000);
                  fetch('https://conductor-ivory.vercel.app/api/signals', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id: t.signalId,
                      state: 'resolved',
                      userId: 'james_totalhome_gmail_com',
                    }),
                  }).then(() => {
                    // Refresh the Took Care Of band so the just-rested
                    // signal joins it without a manual pull-to-refresh.
                    return fetch(
                      'https://conductor-ivory.vercel.app/api/signals?type=autoResolutions&userId=james_totalhome_gmail_com'
                    );
                  })
                  .then((r) => r?.json?.())
                  .then((d) => {
                    if (Array.isArray(d?.items)) setAutoResolutions(d.items);
                  })
                  .catch(() => {});
                }}>
                <Text style={styles.quickActionDoneText}>Done ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickActionBtn, styles.quickActionMuted]}
                onPress={() => {
                  const t = quickActionTarget;
                  if (!t) return;
                  setQuickActed((m) => ({ ...m, [String(t.signalId)]: 'snoozed' }));
                  setQuickActionTarget(null);
                  fetch('https://conductor-ivory.vercel.app/api/signals', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id: t.signalId,
                      state: 'snoozed',
                      userId: 'james_totalhome_gmail_com',
                    }),
                  }).catch(() => {});
                }}>
                <Text style={styles.quickActionMutedText}>Snooze 24h ⏸</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickActionBtn, styles.quickActionDanger]}
                onPress={() => {
                  const t = quickActionTarget;
                  if (!t) return;
                  setQuickActed((m) => ({ ...m, [String(t.signalId)]: 'dismissed' }));
                  setQuickActionTarget(null);
                  // Camouflage by sender — backend resolves the
                  // signal's sender from signalId and adds a rule
                  // suppressing future imports from that source.
                  fetch('https://conductor-ivory.vercel.app/api/signals?type=camouflage', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userId: 'james_totalhome_gmail_com',
                      signalId: t.signalId,
                    }),
                  }).catch(() => {});
                  // Also resolve the signal so it drops off Horizon.
                  fetch('https://conductor-ivory.vercel.app/api/signals', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id: t.signalId,
                      state: 'expired',
                      userId: 'james_totalhome_gmail_com',
                    }),
                  }).catch(() => {});
                }}>
                <Text style={styles.quickActionDangerText}>Not relevant ✗</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

type ThemeColors = { background: string; surface: string; text: string; muted: string; border: string; inputBackground: string };
function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  scrollFlex: {
    flex: 1,
  },
  // Resolution-moment toast — absolutely-positioned brass pill near
  // the top of the screen. Renders for 2s on Done tap, fades out
  // automatically when restedToast flips back to false.
  restedToast: {
    position: 'absolute',
    top: 70,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: accentColor + '26',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accentColor + '66',
    zIndex: 50,
  },
  restedToastText: {
    color: accentColor,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  // The Pulse — synthesis output sits between the greeting/title block
  // and the in-flow date. Small uppercase label + one italic editorial
  // sentence; tap expands to reveal the synthesis flags that produced it.
  pulseWrap: {
    marginTop: 4,
    marginBottom: 16,
  },
  pulseLabel: {
    color: theme.muted,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  pulseText: {
    color: '#d6d3cd',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  // Expanded card sits inline below the pulse sentence. Brass-edged top
  // border separates it from the editorial line; each section stacks
  // vertically with a 14px gap.
  pulseCard: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: accentRgba(accentColor, 0.18),
  },
  pulseSection: {
    marginBottom: 14,
  },
  pulseSectionLabel: {
    color: theme.muted,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  pulseRow: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 2,
  },
  pulseEmpty: {
    color: theme.muted,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  // Ask Conductor — input row, loading/error states, answer card. Sits
  // between The Pulse and the in-flow date in Takeoff/Clearance modes.
  askWrap: {
    marginTop: 12,
    marginBottom: 18,
  },
  askInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.inputBackground,
    paddingTop: 12,
  },
  askInput: {
    flex: 1,
    color: '#d6d3cd',
    fontSize: 13,
    paddingVertical: 6,
  },
  askSend: {
    color: accentColor,
    fontSize: 16,
    paddingLeft: 12,
  },
  askThinking: {
    color: theme.muted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 8,
  },
  // Suggestion chips — surface common starter questions when the input
  // is focused. Horizontal scroll on narrow screens; muted brass
  // outline gives just enough affordance without competing with the
  // brief text above.
  askChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  askChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: accentRgba(accentColor, 0.4),
    borderRadius: 14,
  },
  askChipText: {
    color: accentColor,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  askAnswerCard: {
    marginTop: 12,
    paddingLeft: 12,
    paddingVertical: 10,
    borderLeftWidth: 2,
    borderLeftColor: accentColor,
  },
  askAnswerText: {
    fontSize: 14,
    lineHeight: 22,
  },
  askAnotherWrap: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  askAnother: {
    color: theme.muted,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  // Date sits in normal flow above the divider, right-aligned within
  // the content's horizontal padding. Hardcoded to the muted grey
  // because the older theme.timestamp pull rendered it darker on
  // Clearance than the spec wanted.
  inFlowDate: {
    color: theme.muted,
    fontSize: 12,
    letterSpacing: 0.3,
    textAlign: 'right',
    marginBottom: 8,
  },
  // Yesterday's Programme link sits in normal flow just below the
  // divider, right-aligned to mirror the date above it. Tap target
  // is the wrapping TouchableOpacity; the Text style only handles
  // visual placement.
  inFlowYesterday: {
    color: theme.muted,
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'right',
    marginTop: 8,
    marginBottom: 16,
  },
  content: {
    padding: 32,
    paddingTop: 80,
    minHeight: '100%',
  },
  header: {
    marginBottom: 32,
  },
  greeting: {
    color: theme.muted,
    fontSize: 16,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  title: {
    color: theme.text,
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1,
  },
  divider: {
    height: 1,
    backgroundColor: theme.border,
    // No marginBottom — the in-flow Yesterday's Programme link sits
    // directly below the divider with its own marginTop:8 +
    // marginBottom:16, which together produce the gap to the brief.
    marginBottom: 0,
  },
  briefContainer: {
    flex: 1,
  },
  loadingContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  loadingText: {
    color: '#8a8780',
    fontSize: 14,
    letterSpacing: 0.3,
    marginTop: 16,
  },
  brief: {
    color: theme.text,
    fontSize: 20,
    lineHeight: 32,
    fontWeight: '300',
    letterSpacing: 0.2,
  },
  // Week in Review — Clearance-only Sunday reflection. Brass-edged top
  // line separates the paragraph from the main brief; small uppercase
  // "THIS WEEK" label sits above the prose.
  weekInReviewWrap: {
    marginTop: 24,
  },
  weekInReviewBrassLine: {
    height: 1,
    backgroundColor: accentRgba(accentColor, 0.2),
    marginBottom: 16,
  },
  yearInReviewWrap: {
    marginTop: 26,
    marginBottom: 18,
  },
  yearInReviewBrassLine: {
    height: 2,
    backgroundColor: accentRgba(accentColor, 0.4),
    marginBottom: 18,
  },
  yearInReviewLabel: {
    color: accentColor,
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '600',
    marginBottom: 12,
  },
  yearInReviewText: {
    fontSize: 15,
    lineHeight: 24,
  },
  yearInReviewFooter: {
    color: theme.muted,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 14,
    letterSpacing: 0.3,
  },
  maintOfferCard: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    paddingLeft: 16,
    borderLeftWidth: 3,
    borderLeftColor: accentColor,
    backgroundColor: accentRgba(accentColor, 0.05),
    borderRadius: 6,
  },
  maintOfferTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  maintOfferSub: {
    color: theme.muted,
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 12,
    lineHeight: 17,
  },
  maintOfferRow: { flexDirection: 'row', gap: 10 },
  maintOfferPrimary: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accentRgba(accentColor, 0.55),
    backgroundColor: accentRgba(accentColor, 0.10),
  },
  maintOfferPrimaryText: { color: accentColor, fontSize: 12, fontWeight: '600' },
  maintOfferSecondary: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  maintOfferSecondaryText: { color: theme.muted, fontSize: 12 },
  conductorQWrap: {
    marginTop: 18,
    marginBottom: 6,
    paddingTop: 14,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: accentRgba(accentColor, 0.18),
  },
  conductorQLabel: {
    color: theme.muted,
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 8,
  },
  conductorQText: {
    color: theme.text,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
    marginBottom: 12,
  },
  conductorQRow: {
    flexDirection: 'row',
    gap: 10,
  },
  conductorQBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  conductorQOnIt: {
    borderColor: accentRgba(accentColor, 0.55),
    backgroundColor: accentRgba(accentColor, 0.08),
  },
  conductorQOnItText: {
    color: accentColor,
    fontSize: 12,
    fontWeight: '500',
  },
  conductorQRemove: {
    borderColor: 'rgba(255,255,255,0.10)',
  },
  conductorQRemoveText: {
    color: theme.muted,
    fontSize: 12,
  },
  conductorQAckedText: {
    color: theme.muted,
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  autoResWrap: {
    marginTop: 16,
    marginBottom: 4,
  },
  autoResHeader: {
    alignItems: 'flex-end',
    paddingVertical: 4,
  },
  autoResHeaderText: {
    color: theme.muted,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  autoResList: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.inputBackground,
  },
  autoResRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  autoResDesc: {
    flex: 1,
    color: '#a8a5a0',
    fontSize: 13,
  },
  autoResLabel: {
    color: theme.muted,
    fontSize: 11,
    fontStyle: 'italic',
  },
  autoResDismiss: {
    color: theme.muted,
    fontSize: 14,
    paddingHorizontal: 4,
  },
  autoResDismissAllBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
  },
  autoResDismissAllText: {
    color: theme.muted,
    fontSize: 10,
  },
  autoResFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
  },
  autoResViewAllText: {
    color: accentColor,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  handoffWrap: {
    alignItems: 'flex-end',
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  handoffBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accentRgba(accentColor, 0.55),
    backgroundColor: accentRgba(accentColor, 0.07),
  },
  handoffBtnText: {
    color: accentColor,
    fontSize: 12,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  handoffAckedText: {
    color: theme.muted,
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 7,
  },
  weekInReviewLabel: {
    color: theme.muted,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  weekInReviewText: {
    fontSize: 14,
    lineHeight: 22,
  },
  theReadWrap: {
    marginTop: 24,
  },
  theReadBrassLine: {
    height: 1,
    // Brass (#b8960c) at 20% opacity — a thin warm line that
    // separates the brief proper from the overflow trigger.
    backgroundColor: accentRgba(accentColor, 0.2),
  },
  theReadTrigger: {
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingVertical: 4,
  },
  theReadTriggerText: {
    color: theme.muted,
    fontSize: 10,
    letterSpacing: 2,
  },
  theReadText: {
    // Matches the brief's prose style — same font, size, line height,
    // weight, tracking. Color comes from theme.brief inline so it
    // tracks the Takeoff vs Clearance palette correctly.
    fontSize: 20,
    lineHeight: 32,
    fontWeight: '300',
    letterSpacing: 0.2,
    marginTop: 16,
  },
  feedbackSignature: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 12,
  },
  feedbackSigPrompt: {
    color: theme.muted,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  feedbackSigCheck: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    lineHeight: 20,
  },
  feedbackSigX: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 6,
    lineHeight: 20,
  },
  transparencyLinkCentered: {
    marginTop: 24,
    paddingVertical: 4,
  },
  transparencyLinkText: {
    color: theme.muted,
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tooltipInline: {
    marginTop: 8,
    alignItems: 'center',
  },
  quickActionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  quickActionSheet: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accentRgba(accentColor, 0.35),
    width: '100%',
    maxWidth: 360,
  },
  quickActionHeader: {
    color: theme.text,
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 14,
    textAlign: 'center',
  },
  quickActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  quickActionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickActionDone: {
    borderColor: accentRgba(accentColor, 0.65),
    backgroundColor: accentRgba(accentColor, 0.10),
  },
  quickActionDoneText: {
    color: accentColor,
    fontSize: 12,
    fontWeight: '600',
  },
  quickActionMuted: {
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  quickActionMutedText: {
    color: '#a8a5a0',
    fontSize: 12,
    fontWeight: '500',
  },
  quickActionDanger: {
    borderColor: 'rgba(217, 119, 87, 0.4)',
    backgroundColor: 'rgba(217, 119, 87, 0.06)',
  },
  quickActionDangerText: {
    color: '#d97757',
    fontSize: 12,
    fontWeight: '500',
  },
  transparencyBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  transparencySheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
  },
  transparencyHeader: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: 16,
  },
  transparencyText: {
    color: '#8a8780',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 24,
    letterSpacing: 0.2,
  },
  transparencyCloseBtn: {
    backgroundColor: theme.text,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  transparencyCloseBtnText: {
    color: theme.background,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  onboarding: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  onboardingLogo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: theme.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoMark: {
    color: theme.background,
    fontSize: 32,
    fontWeight: '700',
  },
  onboardingTitle: {
    color: theme.text,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1,
    marginBottom: 8,
  },
  onboardingSubtitle: {
    color: theme.muted,
    fontSize: 16,
    letterSpacing: 0.3,
    marginBottom: 32,
  },
  onboardingDivider: {
    width: '100%',
    height: 1,
    backgroundColor: theme.border,
    marginBottom: 32,
  },
  onboardingBody: {
    color: '#8a8780',
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 40,
  },
  connectButton: {
    backgroundColor: theme.text,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  connectButtonText: {
    color: theme.background,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  onboardingPrivacy: {
    color: theme.muted,
    fontSize: 12,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  });
}