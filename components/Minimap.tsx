import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useTheme } from '@/app/theme';
import { useHouseholdState } from '@/hooks/useHouseholdState';
import { useUserId } from '@/hooks/useUserId';
import { debugLog } from '@/utils/debugLog';

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
  outer:  { key: 'outer',  radius: 19, rotationMs: 60000, strokeOpacity: 0.10, pulseMs: 2500 },
  middle: { key: 'middle', radius: 13, rotationMs: 30000, strokeOpacity: 0.15, pulseMs: 1500 },
  inner:  { key: 'inner',  radius: 7,  rotationMs: 15000, strokeOpacity: 0.20, pulseMs: 600  },
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
  // Signals sharing a threadId belong to one trip/thread and collapse
  // into a single dot here, matching the Hover radar's clustering.
  threadId?: string;
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

const SIZE = 48;
const CENTER = SIZE / 2;

// Per-instance counter so each mounted Minimap's vapor RadialGradient has a
// unique id — react-native-svg can otherwise collide same-id gradients across
// SVGs (multiple Minimaps stay mounted across the tab screens).
let vaporInstanceCounter = 0;

function MinimapRing({
  ring,
  signals,
  arcColor,
}: {
  ring: RingDef;
  signals: Signal[];
  arcColor: string;
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
          stroke={arcColor}
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
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor, isDark } = useTheme();
  // Arc color flips with the theme so the rings read in light mode (where
  // the old hardcoded off-white was invisible). The radar disc keeps its
  // dark navy in dark mode but lightens to the theme surface in light mode
  // so the dark arcs contrast against it.
  const arcColor = isDark ? OFF_WHITE : theme.text;
  const discBg = isDark ? NAVY : theme.surface;
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
      const res = await fetch(`${API_BASE}/signals?userId=${userId}`);
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
    // Apply the personal-view filter, then collapse signals that share a
    // threadId into a single dot (placed on the ring of its soonest leg)
    // so a multi-leg trip reads as one dot here just like on Hover. No
    // count badge — dots are 3px, too small to label legibly.
    const visible: Signal[] = [];
    for (const s of signals) {
      if (viewMode === 'personal' && s.userId && s.userId !== userId) continue;
      visible.push(s);
    }

    const byThread = new Map<string, Signal[]>();
    const dots: Signal[] = [];
    for (const s of visible) {
      if (s.threadId) {
        const arr = byThread.get(s.threadId);
        if (arr) arr.push(s);
        else byThread.set(s.threadId, [s]);
      } else {
        dots.push(s);
      }
    }
    for (const [tid, members] of byThread) {
      if (members.length < 2) {
        dots.push(...members);
        continue;
      }
      let earliestMs = Infinity;
      for (const m of members) {
        const ms = parseEta(m.eta);
        if (!isNaN(ms) && ms < earliestMs) earliestMs = ms;
      }
      dots.push({
        id: `cluster:${tid}`,
        type: 'travel',
        eta: isFinite(earliestMs) ? new Date(earliestMs).toISOString() : members[0].eta,
      });
    }

    const out: Record<RingKey, Signal[]> = { inner: [], middle: [], outer: [] };
    for (const s of dots) out[ringForSignal(s)].push(s);
    return out;
  }, [signals, viewMode, userId]);

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

  // Always-on "breathing" pulse for the whole widget. The minimap read
  // too faint at rest, so the disc gently oscillates 0.5 → 1.0 → 0.5 on a
  // 4-second cycle (2s each way) — a very slow, calm breath that lifts it
  // to full visibility without ever feeling like an alert. Distinct from
  // the urgent inner-ring pulse above, which is faster and only fires when
  // there are signals to act on.
  const breatheAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 0.85,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breatheAnim, {
          toValue: 1.0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breatheAnim]);

  // Resting-state vapor — a soft accent radial glow behind the rings that
  // breathes its opacity 0.6 → 1.0 → 0.6 on a 4s cycle, fully independent of
  // the ring pulse and the disc breathe above, so the minimap feels alive even
  // when nothing is happening. The gradient's center opacity itself lifts from
  // 0.10 to 0.18 when there are urgent signals (set on the Stop below).
  const vaporId = useRef(`minimapVapor-${++vaporInstanceCounter}`).current;
  const vaporAnim = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(vaporAnim, {
          toValue: 1.0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(vaporAnim, {
          toValue: 0.6,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [vaporAnim]);

  // First-render discovery: scale-bounce 3 times, then surface a
  // tooltip ("Tap to ask The Conductor anything") for up to 4 seconds.
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
    debugLog('Minimap', `handlePress fired, onPress=${typeof onPress} floating=${floating}`);
    // Light haptic on tap — same pattern as the brief quick-action
    // chips. Swallowed on devices without haptics support.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    dismissDiscovery();
    // Kick off the tap-bounce animation on the native thread. We do
    // NOT block on it — the previous implementation used a 120ms
    // setTimeout before firing onPress so the bounce was visible
    // before the modal slid in, but that introduced a real
    // reliability hazard: any work React did in those 120ms could
    // race the deferred call. The animation now runs concurrently
    // with the state update; the modal's own slide-in (~300ms) is
    // long enough that the bounce reads anyway.
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
    // Fire the parent callback (or the legacy nav-to-Hover fallback)
    // SYNCHRONOUSLY. openConductorSheet mutates module state and
    // notifies the root-mounted sheet via useSyncExternalStore — the
    // modal slides in immediately.
    if (typeof onPress === 'function') {
      try {
        debugLog('Minimap', 'calling onPress()');
        onPress();
        debugLog('Minimap', 'onPress() returned');
      } catch (err: any) {
        debugLog('Minimap', `onPress threw: ${err?.message || String(err)}`);
      }
    } else {
      debugLog('Minimap', 'no onPress prop → router.push(/hover)');
      router.push('/(tabs)/hover');
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
          { backgroundColor: discBg },
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
          // Slow 4s breathing pulse so the disc never sits at a faint rest.
          { opacity: breatheAnim },
        ]}>
        {/* Resting-state vapor — accent radial glow behind everything, its
            opacity breathing 0.6 → 1.0 (vaporAnim) independent of the rings.
            Center opacity lifts 0.10 → 0.18 when urgent signals exist. */}
        <Animated.View pointerEvents="none" style={[styles.ringLayer, { opacity: vaporAnim }]}>
          <Svg width={SIZE} height={SIZE}>
            <Defs>
              <RadialGradient id={vaporId} cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={accentColor} stopOpacity={urgentCount > 0 ? 0.18 : 0.1} />
                <Stop offset="1" stopColor={accentColor} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={CENTER} cy={CENTER} r={CENTER} fill={`url(#${vaporId})`} />
          </Svg>
        </Animated.View>
        <MinimapRing ring={RINGS.outer} signals={grouped.outer} arcColor={arcColor} />
        <MinimapRing ring={RINGS.middle} signals={grouped.middle} arcColor={arcColor} />
        <Animated.View
          pointerEvents="none"
          style={[styles.ringLayer, urgentCount > 0 && { opacity: pulseAnim }]}>
          <MinimapRing ring={RINGS.inner} signals={grouped.inner} arcColor={arcColor} />
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
              Tap to ask The Conductor anything
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
