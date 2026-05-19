import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

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
};

export function Minimap({ floating = true, onPress }: MinimapProps = {}) {
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

  function handlePress() {
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

  return (
    <Pressable
      onPress={handlePress}
      style={ringStyle}
      hitSlop={8}>
      <Animated.View
        style={[
          styles.circle,
          glowColor && {
            shadowColor: glowColor,
            shadowOpacity: 0.6,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 0 },
            elevation: 8,
          },
          { transform: [{ scale: tapScale }] },
        ]}>
        <MinimapRing ring={RINGS.outer} signals={grouped.outer} />
        <MinimapRing ring={RINGS.middle} signals={grouped.middle} />
        <MinimapRing ring={RINGS.inner} signals={grouped.inner} />
      </Animated.View>
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
});
