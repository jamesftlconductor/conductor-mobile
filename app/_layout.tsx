import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import React, { useEffect, useState } from 'react';
import { Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeProvider as ConductorThemeProvider } from '@/app/theme';
import { ConductorSheet } from '@/components/ConductorSheet';
import { DebugBanner } from '@/components/DebugBanner';
import { setHouseholdId, setUserId, useUserId, useUserIdLoaded } from '@/hooks/useUserId';
import { debugLog } from '@/utils/debugLog';
import {
  acceptIconChange,
  declineIconChange,
  getAutoUpdateEnabled,
  ICON_COLORS,
  ICON_TAGLINES,
  MONTH_ICONS,
  MONTH_NAMES,
  shouldSuggestIconUpdate,
  type MonthIcon,
} from '@/hooks/useDynamicIcon';

const ALERT_API_BASE = 'https://conductor-ivory.vercel.app/api';
const ALERT_POLL_MS = 60 * 1000;

export const unstable_settings = {
  anchor: '(tabs)',
};

// Hand-rolled class-based ErrorBoundary. Avoids `react-error-boundary`
// because pulling in an external package at the very root of the app
// was itself a candidate for the launch-crash investigation. A class
// component is part of React core, ships with React Native, and has
// no peer-dependency surface area.
type FallbackProps = { error: any; reset: () => void };
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; Fallback: React.ComponentType<FallbackProps> },
  { error: any }
> {
  state = { error: null as any };
  static getDerivedStateFromError(error: any) {
    return { error };
  }
  componentDidCatch(error: any, info: any) {
    // Surfaces in dev logs and EAS log streams. Production builds can
    // still recover via the Fallback's reset action.
    console.error('[AppErrorBoundary]', error?.message || error, info?.componentStack);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      const Fallback = this.props.Fallback;
      return <Fallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children as React.ReactElement;
  }
}

function FallbackComponent({ error, reset }: FallbackProps) {
  const message = error && typeof error.message === 'string' ? error.message : null;
  return (
    <View style={fallbackStyles.container}>
      <Text style={fallbackStyles.title}>Conductor ran into an issue.</Text>
      <Text style={fallbackStyles.body}>Tap to restart.</Text>
      {message ? (
        <Text style={fallbackStyles.detail} numberOfLines={3}>
          {message}
        </Text>
      ) : null}
      <TouchableOpacity onPress={reset} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={fallbackStyles.cta}>Restart Conductor</Text>
      </TouchableOpacity>
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#f5f0eb', fontSize: 18, marginBottom: 8, textAlign: 'center' },
  body: { color: '#5a5855', fontSize: 13, marginBottom: 24 },
  detail: {
    color: '#5a5855',
    fontSize: 10,
    fontFamily: 'Menlo',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 18,
  },
  cta: { color: '#b8960c', fontSize: 14, fontWeight: '500' },
});

// Red Alert overlay — household-critical events surface above
// everything. Polls /api/alert?action=active every 60s. expo-speech
// is used to announce the alert audibly because expo-av isn't in the
// install yet; once an mp3 ships in assets/sounds/alert.mp3 the
// speech fallback can stay as a redundant accessibility surface.
type ActiveAlert = {
  id: string;
  description: string;
  createdAt: string;
};

function RedAlertOverlay() {
  const userId = useUserId();
  const [alert, setAlert] = useState<ActiveAlert | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(`${ALERT_API_BASE}/alert?action=active&userId=${userId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.active && data.alert) {
          setAlert(data.alert);
        } else {
          setAlert(null);
          setDismissed(false);
        }
      } catch { /* silent */ }
    }
    check();
    const t = setInterval(check, ALERT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [userId]);

  // When a new alert appears (and isn't already dismissed for this
  // session), speak the description out loud. expo-speech is the
  // sound surface until an mp3 lands in assets.
  useEffect(() => {
    if (!alert || dismissed) return;
    try {
      Speech.stop();
      Speech.speak(`Conductor Red Alert. ${alert.description}`, {
        rate: 0.85,
        pitch: 1.0,
        language: 'en-US',
      });
    } catch { /* swallow — speech is best-effort */ }
  }, [alert?.id, dismissed]);

  if (!alert || dismissed) return null;

  async function imAware() {
    const targetId = alert?.id;
    try {
      await fetch(`${ALERT_API_BASE}/alert`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // householdId derived server-side from userId, but the
          // backend accepts both — sending userId only keeps the
          // mobile side from caching the id.
          householdId: 'RangerOaks925',
          alertId: targetId,
          userId,
        }),
      });
    } catch { /* ignore — local dismissal still applies */ }
    Speech.stop();
    setDismissed(true);
    setAlert(null);
  }

  function handleNow() {
    Speech.stop();
    setDismissed(true);
    router.push('/(tabs)/hover' as never);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={overlayStyles.backdrop}>
        <Text style={overlayStyles.mark}>CONDUCTOR</Text>
        <Text style={overlayStyles.title}>RED ALERT</Text>
        <Text style={overlayStyles.body}>{alert.description}</Text>
        <Text style={overlayStyles.timestamp}>
          {(() => {
            try {
              return new Date(alert.createdAt).toLocaleTimeString();
            } catch { return ''; }
          })()}
        </Text>
        <TouchableOpacity style={overlayStyles.primaryBtn} onPress={handleNow}>
          <Text style={overlayStyles.primaryBtnText}>Handle now →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={overlayStyles.secondaryBtn} onPress={imAware}>
          <Text style={overlayStyles.secondaryBtnText}>I&apos;m aware</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ padding: 16 }}
          onPress={() => Linking.openURL('tel:911').catch(() => {})}>
          <Text style={overlayStyles.tertiary}>Get help →</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const overlayStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(239,68,68,0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  mark: {
    color: 'white',
    fontSize: 12,
    letterSpacing: 3,
    marginBottom: 24,
    opacity: 0.7,
  },
  title: {
    color: 'white',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
    marginBottom: 16,
  },
  body: {
    color: 'white',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 8,
  },
  timestamp: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginBottom: 40,
  },
  primaryBtn: {
    backgroundColor: '#b8960c',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryBtnText: {
    color: 'white',
    fontSize: 15,
  },
  tertiary: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
  },
});

// Subtle launch-time icon suggestion. Slides up 4 seconds after
// mount (long enough for the brief to land first), auto-dismisses
// after 8 seconds of no interaction. "Update" persists the choice;
// "Keep current" marks this month declined so the sheet doesn't
// re-appear today. The native OS icon swap is gated behind a
// dynamic require in acceptIconChange — until expo-dynamic-app-icon
// is installed + an EAS build is cut, this is preference-only.
function IconSuggestionSheet() {
  const [suggested, setSuggested] = useState<MonthIcon | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const enabled = await getAutoUpdateEnabled();
        if (!enabled || cancelled) return;
        const suggestion = await shouldSuggestIconUpdate();
        if (suggestion && !cancelled) setSuggested(suggestion);
      } catch { /* silent */ }
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!suggested) return;
    const t = setTimeout(() => setSuggested(null), 8000);
    return () => clearTimeout(t);
  }, [suggested]);

  if (!suggested) return null;

  const monthName = MONTH_NAMES[MONTH_ICONS.indexOf(suggested)];
  const tagline = ICON_TAGLINES[suggested];
  const swatchColor = ICON_COLORS[suggested];

  return (
    <View pointerEvents="box-none" style={iconSuggestStyles.wrap}>
      <View style={iconSuggestStyles.sheet}>
        <View
          style={[
            iconSuggestStyles.swatch,
            { backgroundColor: swatchColor },
          ]}
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={iconSuggestStyles.title}>
            {monthName} has arrived.
          </Text>
          <Text style={iconSuggestStyles.sub} numberOfLines={1}>
            {tagline}
          </Text>
        </View>
        <TouchableOpacity
          onPress={async () => {
            await acceptIconChange(suggested);
            setSuggested(null);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ paddingHorizontal: 10 }}>
          <Text style={iconSuggestStyles.update}>Update</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={async () => {
            await declineIconChange(suggested);
            setSuggested(null);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ paddingLeft: 8 }}>
          <Text style={iconSuggestStyles.dismiss}>Keep current</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const iconSuggestStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 24,
    paddingHorizontal: 12,
  },
  sheet: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    height: 76,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 9,
  },
  title: {
    color: '#f5f0eb',
    fontSize: 14,
    fontWeight: '500',
  },
  sub: {
    color: '#8a8780',
    fontSize: 11,
    marginTop: 2,
  },
  update: {
    color: '#b8960c',
    fontSize: 13,
    fontWeight: '600',
  },
  dismiss: {
    color: '#5a5855',
    fontSize: 12,
  },
});

// Deep-link handler — catches the `conductormobile://onboard-success?
// userId=...&householdId=...` URL emitted by /api/success after OAuth
// completes, persists the resolved userId (and householdId) to
// AsyncStorage via setUserId/setHouseholdId, and signals every screen
// that uses useUserId() to rerender against the new identity. Without
// this, the app has no other channel to learn what userId Google's
// OAuth produced — Sarah's app would forever read James's brief.
function parseDeepLinkParam(url: string, key: string): string | null {
  try {
    const re = new RegExp(`[?&]${key}=([^&]+)`);
    const match = url.match(re);
    if (!match) return null;
    const raw = decodeURIComponent(match[1]);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function DeepLinkHandler() {
  useEffect(() => {
    let mounted = true;
    async function handleUrl(url: string | null) {
      if (!url || !mounted) return;
      if (!url.startsWith('conductormobile://onboard-success')) return;
      const id = parseDeepLinkParam(url, 'userId');
      if (!id) return;
      await setUserId(id);
      // Capture the household id at the same time so screens that
      // need it for cross-member views (Compass, Crew, etc) don't
      // have to round-trip to the server.
      const hid = parseDeepLinkParam(url, 'householdId');
      if (hid) {
        try { await setHouseholdId(hid); } catch { /* ignore */ }
      }
      // After onboarding completion the user is most usefully landed on
      // the Ground tab; if they were mid-onboarding, the onboarding
      // route can stay on screen and finish — useUserId() will start
      // returning the real id and the boot guard stops redirecting.
      try { router.replace('/(tabs)' as never); } catch { /* ignore */ }
    }
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (event) => handleUrl(event.url));
    return () => {
      mounted = false;
      try { sub.remove(); } catch { /* ignore */ }
    };
  }, []);
  return null;
}

// Boot guard — if no userId is in AsyncStorage by the time the initial
// AsyncStorage read completes, force the user into /onboarding. This
// is what prevents Sarah's freshly-installed app from rendering Ground
// against James's userId. Waits for `loaded` to flip true before
// deciding so a 50ms launch race doesn't bounce a legitimate user.
// Logs every decision so the debug banner can show why a redirect did
// or did not fire — the previous build silently failed and we lost a
// day of testing to it.
function BootGuard() {
  const userId = useUserId();
  const loaded = useUserIdLoaded();
  useEffect(() => {
    debugLog('Boot', `tick loaded=${loaded} userId=${userId ?? '(null)'}`);
    if (!loaded) return;
    if (userId) {
      debugLog('Boot', `userId present — staying put`);
      return;
    }
    debugLog('Boot', `no userId — router.replace(/onboarding)`);
    try {
      router.replace('/onboarding' as never);
      debugLog('Boot', `router.replace OK`);
    } catch (err: any) {
      debugLog('Boot', `router.replace threw: ${err?.message || String(err)}`);
    }
  }, [loaded, userId]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AppErrorBoundary Fallback={FallbackComponent}>
      <ConductorThemeProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <DeepLinkHandler />
          <BootGuard />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="onboard-first-intro" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="horizon" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="vault" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="compass" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="crew" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="programme" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="signal-filters" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="providers" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="inventory" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="communicate" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="directory" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="junior" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="privacy-dashboard" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="profile-setup" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="recurring-events" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="missed-cues" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="calendar" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="channel" options={{ headerShown: false, gestureEnabled: true }} />
            <Stack.Screen name="icon-selector" options={{ headerShown: false, gestureEnabled: true }} />
          </Stack>
          {/* Root-mounted ConductorSheet — visibility owned by
              useConductorSheet so any minimap from any screen opens
              the same instance. Lives above <Stack> so it overlays
              every route. */}
          <ConductorSheet />
          {/* Diagnostic banner — pinned to top, renders the most
              recent debugLog entries. Toggle via
              utils/debugLog.DEBUG_BANNER_ENABLED. */}
          <DebugBanner />
          {/* Red Alert overlay — household-wide critical events.
              Renders above everything else when an active alert is
              present and the current user hasn't dismissed it. */}
          <RedAlertOverlay />
          {/* Icon suggestion — surfaces 4 seconds after mount when
              the current month has a new icon and the user hasn't
              already declined it. Subtle bottom sheet, not a modal. */}
          <IconSuggestionSheet />
          <StatusBar style="auto" />
        </ThemeProvider>
      </GestureHandlerRootView>
      </ConductorThemeProvider>
    </AppErrorBoundary>
  );
}
