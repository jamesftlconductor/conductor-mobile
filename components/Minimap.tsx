import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/app/theme';
import { useHouseholdState } from '@/hooks/useHouseholdState';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

// Mirrors Hover's view-mode toggle. Reads from the same AsyncStorage key
// so the minimap on Ground stays visually in sync with whatever filter
// Hover is currently applying.
const VIEW_MODE_KEY = 'hoverViewMode';
type ViewMode = 'family' | 'personal';

const NAVY = '#0a0f1e';
const OFF_WHITE = '#f0ede8';

type RingKey = 'inner' | 'middle' | 'outer';

type RingDef = {
  key: RingKey;
  radius: number;
  rotationMs: number;
  strokeOpacity: number;
  pulseMs: number;
};

const RINGS: Record<RingKey, RingDef> = {
  outer:  { key: 'outer',  radius: 16, rotationMs: 60000, strokeOpacity: 0.10, pulseMs: 2500 },
  middle: { key: 'middle', radius: 11, rotationMs: 30000, strokeOpacity: 0.15, pulseMs: 1500 },
  inner:  { key: 'inner',  radius: 6,  rotationMs: 15000, strokeOpacity: 0.20, pulseMs: 600  },
};

const TYPE_COLORS: Record<string, string> = {
  package:     '#60a5fa',
  food:        '#f59e0b',
  grocery:     '#a3e635',
  service:     '#86efac',
  reservation: '#f9a8d4',
  travel:      '#2dd4bf',
  deadline:    '#fbbf24',
  urgent:      '#ef4444',
};
const DEFAULT_COLOR = '#ef4444';

type Signal = {
  id: number | string;
  status?: string;
  eta?: string | null;
  type?: string;
  state?: string;
  userId?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function colorFor(s: Signal) {
  if (s.type && TYPE_COLORS[s.type]) return TYPE_COLORS[s.type];
  return DEFAULT_COLOR;
}

function parseEta(eta?: string | null) {
  if (!eta) return NaN;
  return Date.parse(eta);
}

function ringForSignal(s: Signal): RingKey {
  const ms = parseEta(s.eta);
  const now = Date.now();
  const isDelayed = (s.status || '').toLowerCase().includes('delay');
  if (isNaN(ms)) return isDelayed ? 'inner' : 'outer';
  if (ms < now + DAY_MS) return 'inner';
  if (ms < now + WEEK_MS) return 'middle';
  return 'outer';
}

function angleDegForSignal(id: Signal['id']) {
  const n = typeof id === 'number' ? id : parseInt(String(id), 10) || 0;
  return Math.abs(n) % 60;
}

const SIZE = 40;
const CENTER = SIZE / 2;

function MinimapRing({
  ring,
  signals,
}: {
  ring: RingDef;
  signals: Signal[];
}) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let stopped = false;
    let currentAnim: Animated.CompositeAnimation | null = null;

    function tick() {
      if (stopped) return;
      const startVal = (rotation as any)._value ?? 0;
      const remainingFrac = 1 - (startVal % 1);
      const duration = ring.rotationMs * remainingFrac;
      currentAnim = Animated.timing(rotation, {
        toValue: Math.floor(startVal) + 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      currentAnim.start(({ finished }) => {
        if (!finished) return;
        rotation.setValue(0);
        tick();
      });
    }

    tick();
    return () => {
      stopped = true;
      currentAnim?.stop();
    };
  }, [ring.rotationMs, rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ringLayer,
        { transform: [{ rotate: spin }] },
      ]}>
      <Svg width={SIZE} height={SIZE}>
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={ring.radius}
          stroke={OFF_WHITE}
          strokeOpacity={ring.strokeOpacity}
          strokeWidth={0.6}
          fill="none"
        />
      </Svg>
      {signals.map((s) => {
        const angle = (angleDegForSignal(s.id) * Math.PI) / 180;
        const x = CENTER + ring.radius * Math.cos(angle - Math.PI / 2);
        const y = CENTER + ring.radius * Math.sin(angle - Math.PI / 2);
        return (
          <PulsingDot
            key={String(s.id)}
            x={x}
            y={y}
            color={colorFor(s)}
            pulseMs={ring.pulseMs}
          />
        );
      })}
    </Animated.View>
  );
}

function PulsingDot({
  x,
  y,
  color,
  pulseMs,
}: {
  x: number;
  y: number;
  color: string;
  pulseMs: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const half = pulseMs / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.4,
          duration: half,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: half,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseMs, scale]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - 1.5,
        top: y - 1.5,
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: color,
        transform: [{ scale }],
      }}
    />
  );
}

type MinimapProps = {
  // 'floating' (default) keeps the legacy absolute-positioned widget
  // used on Ground. 'inline' drops the position styles so the
  // minimap can sit inside a ScreenHeader row at the far right.
  floating?: boolean;
  // Override the default tap behavior. Floating Ground minimap opens
  // ConductorSheet; inline header minimap on every other screen also
  // opens ConductorSheet. Callers pass their own onPress (typically
  // setSheetOpen(true)). When omitted, falls back to the legacy
  // navigation-to-Hover behavior for backwards compat.
  onPress?: () => void;
  // Number of signals currently warranting attention — drives the
  // top-right badge and the inner-ring pulse. Default 0 hides both.
  urgentCount?: number;
};

const DISCOVERY_KEY = 'minimapDiscovered';
const DISCOVERY_AUTOHIDE_MS = 4000;

export function Minimap({ floating = true, onPress, urgentCount: urgentCountProp }: MinimapProps = {}) {
  const { theme, accentColor } = useTheme();
  // Weather-vane state drives the border color + pulse cadence. The
  // urgentCount that came in via prop (legacy callers) is overridden
  // by the hook's count so every minimap reads from the same source.
  const householdState = useHouseholdState();
  const urgentCount = householdState.urgentCount ?? urgentCountProp ?? 0;
  const borderColor = householdState.borderColor;
  const pulseSpeed = householdState.pulseSpeed;
  const [signals, setSignals] = useState<Signal[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('family');
  const tapScale = useRef(new Animated.Value(1)).current;

  async function loadSignals() {
    try {
      const res = await fetch(`${API_BASE}/signals?userId=${USER_ID}`);
      const data = await res.json();
      const active = (data.signals || []).filter(
        (s: Signal) => !s.state || s.state === 'incoming' || s.state === 'active'
      );
      setSignals(active);
    } catch {
      // silent
    }
  }

  // Re-read viewMode on every refresh tick so a toggle on Hover propagates
  // to the next minimap repaint within at most the polling interval.
  // Setting it as part of loadSignals keeps the two reads coupled.
  async function loadViewMode() {
    try {
      const v = await AsyncStorage.getItem(VIEW_MODE_KEY);
      if (v === 'personal' || v === 'family') setViewMode(v);
    } catch {
      // silent
    }
  }

  useEffect(() => {
    loadSignals();
    loadViewMode();
    const id = setInterval(() => {
      loadSignals();
      loadViewMode();
    }, 60000);
    return () => clearInterval(id);
  }, []);

  const grouped = useMemo(() => {
    const out: Record<RingKey, Signal[]> = { inner: [], middle: [], outer: [] };
    for (const s of signals) {
      if (viewMode === 'personal' && s.userId && s.userId !== USER_ID) continue;
      out[ringForSignal(s)].push(s);
    }
    return out;
  }, [signals, viewMode]);

  const innerSignals = grouped.inner;
  const glowColor = innerSignals.length > 0 ? colorFor(innerSignals[0]) : null;

  // Pulse cadence comes from householdState.pulseSpeed (ms per half
  // cycle). When pulseSpeed is null (busy/clear) we stop the loop and
  // hold opacity at 1. Otherwise the inner ring opacity oscillates
  // 0.3 → 1.0 → 0.3 with the configured timing — red_alert is 400ms,
  // grief is 3000ms, etc.
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (pulseSpeed == null) {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: pulseSpeed,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: pulseSpeed,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseSpeed, pulseAnim]);

  // First-render discovery: scale-bounce 3 times, then surface a
  // tooltip ("Tap to ask Conductor anything") for up to 4 seconds.
  // Persisted via AsyncStorage so it only fires once per install.
  const discoveryScale = useRef(new Animated.Value(1)).current;
  const [discoveryTooltipVisible, setDiscoveryTooltipVisible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(DISCOVERY_KEY);
        if (seen === 'true' || cancelled) return;
        const bounce = () =>
          Animated.sequence([
            Animated.timing(discoveryScale, {
              toValue: 1.15,
              duration: 250,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(discoveryScale, {
              toValue: 1.0,
              duration: 250,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]);
        Animated.sequence([bounce(), bounce(), bounce()]).start(() => {
          if (cancelled) return;
          setDiscoveryTooltipVisible(true);
          setTimeout(() => {
            setDiscoveryTooltipVisible(false);
            AsyncStorage.setItem(DISCOVERY_KEY, 'true').catch(() => {});
          }, DISCOVERY_AUTOHIDE_MS);
        });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [discoveryScale]);

  function dismissDiscovery() {
    if (!discoveryTooltipVisible) return;
    setDiscoveryTooltipVisible(false);
    AsyncStorage.setItem(DISCOVERY_KEY, 'true').catch(() => {});
  }

  function handlePress() {
    // Light haptic on tap — same pattern as the brief quick-action
    // chips. Swallowed on devices without haptics support.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    dismissDiscovery();
    Animated.sequence([
      Animated.timing(tapScale, {
        toValue: 0.9,
        duration: 100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(tapScale, {
        toValue: 1.0,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
    // Custom onPress overrides the legacy nav-to-Hover behavior.
    // Wait 120ms before firing so the press-down animation gets a
    // visible bounce before whatever the parent does next.
    if (onPress) {
      setTimeout(onPress, 120);
    } else {
      setTimeout(() => router.push('/(tabs)/hover'), 120);
    }
  }

  const ringStyle = floating ? styles.touchWrapFloating : styles.touchWrapInline;
  const badgeLabel = urgentCount > 9 ? '9+' : String(urgentCount);

  return (
    <Pressable
      onPress={handlePress}
      style={ringStyle}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
      <Animated.View
        style={[
          styles.circle,
          // Weather-vane border — borderColor flips based on the
          // household state. red_alert → red, grief → violet, joy →
          // gold, etc. Default state (clear/busy) is brass so a
          // healthy household reads as the familiar accent.
          { borderWidth: 2, borderColor },
          glowColor && {
            shadowColor: glowColor,
            shadowOpacity: 0.6,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 0 },
            elevation: 8,
          },
          // tapScale + discoveryScale compose so the press-bounce and
          // the first-render discovery bounce don't fight each other.
          { transform: [{ scale: Animated.multiply(tapScale, discoveryScale) }] },
        ]}>
        <MinimapRing ring={RINGS.outer} signals={grouped.outer} />
        <MinimapRing ring={RINGS.middle} signals={grouped.middle} />
        <Animated.View
          pointerEvents="none"
          style={[styles.ringLayer, urgentCount > 0 && { opacity: pulseAnim }]}>
          <MinimapRing ring={RINGS.inner} signals={grouped.inner} />
        </Animated.View>
      </Animated.View>
      {urgentCount > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.badge,
            // Badge color matches the weather-vane state so a stress
            // day reads orange-on-orange, a grief day violet, etc.
            // borderColor here is theme.background to maintain the
            // crisp gap between badge and minimap rings.
            { backgroundColor: borderColor, borderColor: theme.background },
          ]}>
          <Text style={styles.badgeText}>{badgeLabel}</Text>
        </View>
      ) : null}
      {discoveryTooltipVisible ? (
        <Pressable onPress={dismissDiscovery}>
          <View
            style={[
              styles.discoveryTooltip,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <Text style={[styles.discoveryTooltipText, { color: theme.muted }]}>
              Tap to ask Conductor anything
            </Text>
          </View>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Legacy floating behavior — used on Ground where the minimap
  // sits absolutely top-right above the brief content.
  touchWrapFloating: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
  },
  // Inline behavior — used inside ScreenHeader rows on every other
  // screen. No absolute positioning; the parent flex layout decides
  // where it goes.
  touchWrapInline: {
    // intentionally empty — flex parent positions it
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: NAVY,
    overflow: 'hidden',
  },
  ringLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
  },
  // Top-right urgent count. The 1.5px border in theme.background
  // creates a thin gap between the badge and the minimap rings so
  // the digit reads cleanly even when the inner ring's signal dot
  // sits at 1 o'clock.
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 12,
  },
  // First-render-only tooltip. Positioned absolutely below the
  // minimap so it doesn't reflow neighboring header content. Tap
  // anywhere on it (or the minimap itself) to dismiss permanently.
  discoveryTooltip: {
    position: 'absolute',
    top: SIZE + 8,
    right: 0,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  discoveryTooltipText: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
