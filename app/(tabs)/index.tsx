import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { fetchHealthSnapshot, type HealthSnapshot } from '@/components/HealthContext';
import { Minimap } from '@/components/Minimap';

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

function getBriefMode(hour: number) {
  return hour < 21
    ? { title: 'Takeoff', endpoint: 'brief' }
    : { title: 'Clearance', endpoint: 'clearance' };
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

export default function TakeoffScreen() {
  const [brief, setBrief] = useState('');
  const [segments, setSegments] = useState<BriefSegment[]>([]);
  const [transparency, setTransparency] = useState<string | null>(null);
  const [showTransparency, setShowTransparency] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [date, setDate] = useState('');
  const [mode, setMode] = useState(getBriefMode(new Date().getHours()));

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
    try {
      const userId = 'james_totalhome_gmail_com'; // temporary hardcode — will come from OAuth
      const { endpoint } = getBriefMode(new Date().getHours());
      const res = await fetchBriefWithRetry(`https://conductor-ivory.vercel.app/api/${endpoint}?userId=${userId}`);
      const data = await res.json();
      setBrief(data.brief);
      if (Array.isArray(data.segments) && data.segments.length > 0) {
        setSegments(data.segments);
      } else {
        setSegments([{ type: 'text', content: data.brief || '' }]);
      }
      setTransparency(typeof data.transparency === 'string' && data.transparency.length > 0
        ? data.transparency
        : null);
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
          <Text style={styles.connectButtonText}>Connect with Google</Text>
        </TouchableOpacity>
        <Text style={styles.onboardingPrivacy}>
          We only read what you choose to share. Your emails stay private.
        </Text>
      </View>
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
    <GestureDetector gesture={swipeGesture}>
    <ScrollView
      style={[styles.container, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}>
      <Minimap />
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: theme.greeting }]}>{greeting}.</Text>
        <Text style={[styles.title, { color: theme.title }]}>{mode.title}</Text>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.divider }]} />

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

      {!loading && transparency ? (
        <TouchableOpacity
          style={styles.transparencyLink}
          onPress={() => setShowTransparency(true)}
          activeOpacity={0.6}>
          <Text style={styles.transparencyLinkText}>How Conductor thought about this</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={[styles.timestamp, { color: theme.timestamp }]}>{date}</Text>

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
              <Text style={styles.transparencyCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
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
    marginBottom: 32,
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
  timestamp: {
    color: '#5a5855',
    fontSize: 12,
    letterSpacing: 0.5,
    marginTop: 48,
    textTransform: 'uppercase',
  },
  transparencyLink: {
    marginTop: 32,
    paddingVertical: 8,
    alignItems: 'center',
  },
  transparencyLinkText: {
    color: '#5a5855',
    fontSize: 11,
    letterSpacing: 1,
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