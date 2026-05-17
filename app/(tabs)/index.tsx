import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, LayoutAnimation, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, UIManager, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { fetchHealthSnapshot, type HealthSnapshot } from '@/components/HealthContext';
import { Minimap } from '@/components/Minimap';
import OverwatchView from '@/components/OverwatchView';
import YesterdayModal from '@/components/YesterdayModal';

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

async function registerForPushNotifications() {
  try {
    if (!Device.isDevice) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

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

const TAKEOFF_THEME = {
  bg: '#0f0f0f',
  title: '#f0ede8',
  brief: '#f0ede8',
  greeting: '#6b6865',
  divider: 'rgba(255,255,255,0.12)',
  timestamp: '#5a5855',
};

const CLEARANCE_THEME = {
  bg: '#080808',
  title: '#c8c5c0',
  brief: '#d4d1cc',
  greeting: '#4a4845',
  divider: 'rgba(255,255,255,0.05)',
  timestamp: '#3a3835',
};

// Time bands:
//   < 7   → Overwatch (overnight idle screen)
//   7-21  → Takeoff (morning brief surface; 9am-9pm shows the same most-recent
//                    Takeoff prose, no separate band needed)
//   21-22 → Clearance (one-hour evening close window)
//   ≥ 22  → Overwatch
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
  const sleepColor = sleep != null && sleep < 6 ? '#b8960c' : '#a8a5a0';
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

function PulseConditionsSection({ weather }: { weather: PulseData['weather'] }) {
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
  const loadLabel = signalLoad.charAt(0).toUpperCase() + signalLoad.slice(1);
  let loadColor = '#a8a5a0';
  if (signalLoad === 'heavy') loadColor = '#f59e0b';
  else if (signalLoad === 'moderate') loadColor = '#b8960c';
  return (
    <View style={styles.pulseSection}>
      <Text style={styles.pulseSectionLabel}>SIGNAL LOAD</Text>
      <Text style={[styles.pulseRow, { color: loadColor }]}>{loadLabel}</Text>
      {urgentCount > 0 ? (
        <Text style={[styles.pulseRow, { color: '#ef4444' }]}>
          {urgentCount} urgent
        </Text>
      ) : null}
    </View>
  );
}

function PulseFlagsSection({ flags }: { flags: string[] }) {
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
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  // Ask Conductor — single-shot Q&A. Always fresh call (server-side
  // 30min cache covers the duplicate-question case). State carries the
  // current question draft, the loading flag, the answer/error result.
  const [askQuestion, setAskQuestion] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState(false);
  const askInputRef = useRef<TextInput | null>(null);
  // Suggestion chips appear below the input when it's focused — give
  // users a starting point for common home-services questions.
  const [askFocused, setAskFocused] = useState(false);
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
      setTransparency(typeof data.transparency === 'string' && data.transparency.length > 0
        ? data.transparency
        : null);
      setTheRead(typeof data.theRead === 'string' && data.theRead.length > 0
        ? data.theRead
        : null);
      setWeekInReview(typeof data.weekInReview === 'string' && data.weekInReview.length > 0
        ? data.weekInReview
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
    } catch (err) {
      const fallback = "Nothing to report today. You're clear.";
      setBrief(fallback);
      setSegments([{ type: 'text', content: fallback }]);
      setTransparency(null);
    } finally {
      setLoading(false);
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

  const theme = mode.title === 'Takeoff' ? TAKEOFF_THEME : CLEARANCE_THEME;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <GestureDetector gesture={swipeGesture}>
        <ScrollView
          style={styles.scrollFlex}
          contentContainerStyle={styles.content}>
          <Minimap />
          <View style={styles.header}>
            <Text style={[styles.greeting, { color: theme.greeting }]}>
              {greeting}{userName && userName !== 'there' ? `, ${userName}` : ''}.
            </Text>
            <Text style={[styles.title, { color: theme.title }]}>{mode.title}</Text>
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
              {pulseExpanded && pulseData ? (
                <View style={styles.pulseCard}>
                  <PulseHealthSection health={pulseData.health} />
                  <PulseConditionsSection weather={pulseData.weather} />
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
                  placeholderTextColor="#5a5855"
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
                // Suggestion chips for common home-services questions —
                // tap to pre-fill the input, focus stays so the user can
                // edit or submit immediately.
                <View style={styles.askChipsRow}>
                  {['What should this cost?', 'Who have we used before?', 'Find a contractor near me'].map((q) => (
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
                  <Text style={[styles.askAnswerText, { color: theme.brief }]}>{askAnswer}</Text>
                  <TouchableOpacity
                    onPress={resetAsk}
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

          <View style={[styles.divider, { backgroundColor: theme.divider }]} />

          <TouchableOpacity
            onPress={() => setShowYesterday(true)}
            activeOpacity={0.6}>
            <Text style={styles.inFlowYesterday}>Yesterday&apos;s Programme →</Text>
          </TouchableOpacity>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={theme.brief} />
              <Text style={styles.loadingText}>Generating your brief...</Text>
            </View>
          ) : (
            <View style={styles.briefContainer}>
              <Text style={[styles.brief, { color: theme.brief }]}>
                {(segments.length > 0 ? segments : [{ type: 'text', content: brief } as BriefSegment]).map((seg, i) => {
                  if (seg.type === 'signal') {
                    const color = (seg.signalType && SIGNAL_TYPE_COLORS[seg.signalType]) || DEFAULT_SIGNAL_COLOR;
                    return (
                      <Text
                        key={i}
                        onPress={() => handleSignalTap(seg.signalId)}
                        style={{
                          textDecorationLine: 'underline',
                          textDecorationColor: color,
                          textDecorationStyle: 'solid',
                        }}>
                        {seg.content}
                      </Text>
                    );
                  }
                  return <Text key={i}>{seg.content}</Text>;
                })}
              </Text>
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

          {!loading && weekInReview ? (
            // Week in Review — Clearance-only Sunday reflection paragraph.
            // Server returns null on non-Sunday and on empty memory weeks,
            // so this block only renders when there's genuinely something
            // worth reading.
            <View style={styles.weekInReviewWrap}>
              <View style={styles.weekInReviewBrassLine} />
              <Text style={styles.weekInReviewLabel}>THIS WEEK</Text>
              <Text style={[styles.weekInReviewText, { color: theme.brief }]}>
                {weekInReview}
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
                    { color: theme.brief, opacity: theReadOpacity },
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
                      color: feedback === 'down' ? '#f0ede8' : '#5a5855',
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  scrollFlex: {
    flex: 1,
  },
  // The Pulse — synthesis output sits between the greeting/title block
  // and the in-flow date. Small uppercase label + one italic editorial
  // sentence; tap expands to reveal the synthesis flags that produced it.
  pulseWrap: {
    marginTop: 4,
    marginBottom: 16,
  },
  pulseLabel: {
    color: '#5a5855',
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
    borderTopColor: 'rgba(184, 150, 12, 0.18)',
  },
  pulseSection: {
    marginBottom: 14,
  },
  pulseSectionLabel: {
    color: '#5a5855',
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
    color: '#5a5855',
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
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 12,
  },
  askInput: {
    flex: 1,
    color: '#d6d3cd',
    fontSize: 13,
    paddingVertical: 6,
  },
  askSend: {
    color: '#b8960c',
    fontSize: 16,
    paddingLeft: 12,
  },
  askThinking: {
    color: '#5a5855',
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
    borderColor: 'rgba(184, 150, 12, 0.4)',
    borderRadius: 14,
  },
  askChipText: {
    color: '#b8960c',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  askAnswerCard: {
    marginTop: 12,
    paddingLeft: 12,
    paddingVertical: 10,
    borderLeftWidth: 2,
    borderLeftColor: '#b8960c',
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
    color: '#5a5855',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  // Date sits in normal flow above the divider, right-aligned within
  // the content's horizontal padding. Hardcoded to the muted grey
  // because the older theme.timestamp pull rendered it darker on
  // Clearance than the spec wanted.
  inFlowDate: {
    color: '#5a5855',
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
    color: '#5a5855',
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
    color: '#5a5855',
    fontSize: 16,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  title: {
    color: '#f0ede8',
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    color: '#f0ede8',
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
    backgroundColor: 'rgba(184, 150, 12, 0.2)',
    marginBottom: 16,
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
    borderColor: 'rgba(184, 150, 12, 0.55)',
    backgroundColor: 'rgba(184, 150, 12, 0.07)',
  },
  handoffBtnText: {
    color: '#b8960c',
    fontSize: 12,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  handoffAckedText: {
    color: '#5a5855',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 7,
  },
  weekInReviewLabel: {
    color: '#5a5855',
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
    backgroundColor: 'rgba(184, 150, 12, 0.2)',
  },
  theReadTrigger: {
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingVertical: 4,
  },
  theReadTriggerText: {
    color: '#5a5855',
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
    color: '#5a5855',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  feedbackSigCheck: {
    color: '#f0ede8',
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
    color: '#5a5855',
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  transparencyBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  transparencySheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
  },
  transparencyHeader: {
    color: '#f0ede8',
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
    backgroundColor: '#f0ede8',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  transparencyCloseBtnText: {
    color: '#0f0f0f',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  onboarding: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  onboardingLogo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#f0ede8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoMark: {
    color: '#0f0f0f',
    fontSize: 32,
    fontWeight: '700',
  },
  onboardingTitle: {
    color: '#f0ede8',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1,
    marginBottom: 8,
  },
  onboardingSubtitle: {
    color: '#5a5855',
    fontSize: 16,
    letterSpacing: 0.3,
    marginBottom: 32,
  },
  onboardingDivider: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    backgroundColor: '#f0ede8',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#0f0f0f',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  onboardingPrivacy: {
    color: '#5a5855',
    fontSize: 12,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});