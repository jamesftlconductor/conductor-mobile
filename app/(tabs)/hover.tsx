import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line } from 'react-native-svg';

import { FinaleSheet } from '@/components/FinaleSheet';
import {
  LEGEND_ORDER,
  metaForRing,
  Signal,
  TYPE_META,
  TypeMeta,
  typeKeyFor,
} from '@/components/signalTypes';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';
const PENDING_SIGNAL_KEY = 'conductor:pendingSignalId';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';

type RingKey = 'inner' | 'middle' | 'outer';

type RingDef = {
  key: RingKey;
  radius: number;
  rotationMs: number;
  strokeOpacity: number;
  label: string;
  pulseMs: number;
};

const RINGS: Record<RingKey, RingDef> = {
  outer:  { key: 'outer',  radius: 165, rotationMs: 60000, strokeOpacity: 0.12, label: 'ON THE HORIZON',    pulseMs: 2500 },
  middle: { key: 'middle', radius: 115, rotationMs: 30000, strokeOpacity: 0.18, label: 'APPROACHING FAST',  pulseMs: 1500 },
  inner:  { key: 'inner',  radius: 65,  rotationMs: 15000, strokeOpacity: 0.25, label: 'ACT NOW',           pulseMs: 600  },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const BRASS = '#b8960c';
const EXPANDED_RADIUS = 155;
// Annular tolerance for tap/long-press hit detection on a ring. Each ring's
// hit zone is its actual radius ± half the gap to its neighbour, so the
// three zones are contiguous and non-overlapping (0–90 inner, 90–140 middle,
// 140–200 outer). Keep these in sync with the radii in RINGS.
const RING_HIT_BOUNDARIES = { innerOuter: 90, middleOuter: 140, outerOuter: 200 };
const EXPANDED_HIT_TOLERANCE = 30;
const HOUR_MS = 60 * 60 * 1000;

function parseEta(eta?: string | null) {
  if (!eta) return NaN;
  return Date.parse(eta);
}

function ringForSignal(s: Signal): RingKey {
  // TODAY (today/overdue) → inner. THIS WEEK (next 7 days, after today) → middle.
  // AHEAD (>7 days, or no ETA non-delayed) → outer. Delayed-no-ETA → inner.
  const ms = parseEta(s.eta);
  const isDelayed = (s.status || '').toLowerCase().includes('delay');
  if (isNaN(ms)) return isDelayed ? 'inner' : 'outer';
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (ms <= endOfToday.getTime()) return 'inner';
  if (ms <= endOfToday.getTime() + 7 * DAY_MS) return 'middle';
  return 'outer';
}

function idAngle(id: Signal['id']): number {
  // Spread between 30° and 330° so the 12 o'clock area stays clear.
  const n = typeof id === 'number' ? id : parseInt(String(id), 10) || 0;
  return (Math.abs(n) % 300) + 30;
}

// Used while a ring is EXPANDED. Snap each signal to the time/day/week
// position that matches the marker scheme around the expanded ring.
//
// Inner (Act Now): 6 AM → 9 PM mapped linearly to 45° → 270° (15 hours
//   across 225°, so 15° per hour). Times outside that range clamp to the
//   nearest boundary.
// Middle (Approaching Fast): day-of-week × (360/7), Monday at the top.
// Outer (On the Horizon): (week - 1) × 90°, week 1 at the top, capped
//   at week 4 for ETAs further out.
//
// Signals without a parseable ETA fall back to evenly distributing across
// the visible arc using the array index passed in by the caller.
const INNER_ARC_START_DEG = 45;
const INNER_ARC_HOURS_START = 6;
const INNER_ARC_HOURS_END = 21; // 9 PM
const INNER_DEG_PER_HOUR = 15;
const MIDDLE_DEG_PER_DAY = 360 / 7;

function expandedAngleForSignal(
  s: Signal,
  ring: RingKey,
  fallbackIndex: number,
  fallbackTotal: number,
): number {
  const ms = parseEta(s.eta);
  const hasEta = !isNaN(ms);

  if (ring === 'inner') {
    if (hasEta) {
      const d = new Date(ms);
      const hours = d.getHours() + d.getMinutes() / 60;
      const clamped = Math.max(INNER_ARC_HOURS_START, Math.min(INNER_ARC_HOURS_END, hours));
      return INNER_ARC_START_DEG + (clamped - INNER_ARC_HOURS_START) * INNER_DEG_PER_HOUR;
    }
    // Distribute evenly across 45° → 270° (225° arc).
    if (fallbackTotal <= 0) return INNER_ARC_START_DEG;
    return INNER_ARC_START_DEG + (fallbackIndex / fallbackTotal) * 225;
  }

  if (ring === 'middle') {
    if (hasEta) {
      const d = new Date(ms);
      const dayIdx = (d.getDay() + 6) % 7; // Mon=0..Sun=6
      return dayIdx * MIDDLE_DEG_PER_DAY;
    }
    if (fallbackTotal <= 0) return 0;
    return (fallbackIndex / fallbackTotal) * 360;
  }

  // outer
  if (hasEta) {
    const days = Math.max(0, (ms - Date.now()) / DAY_MS);
    const week = Math.min(4, Math.max(1, Math.ceil((days + 0.001) / 7)));
    return (week - 1) * 90;
  }
  if (fallbackTotal <= 0) return 270; // park missing-ETA signals near WEEK 4
  return (fallbackIndex / fallbackTotal) * 360;
}

// Position depends on ring:
//   inner  → 12hr clock by hour (12=top, 3=right (90°), 6=bottom, 9=left); fallback id%360
//   middle → day-of-week (Mon=0°, Wed=90°, Fri=180°, Sun=270°, 45° per day); fallback id%360
//   outer  → id%360
function angleDegForSignal(s: Signal, ring: RingKey): number {
  const ms = parseEta(s.eta);

  if (ring === 'inner') {
    if (!isNaN(ms)) {
      const d = new Date(ms);
      const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      return ((hours % 12) / 12) * 360;
    }
    return idAngle(s.id);
  }

  if (ring === 'middle') {
    if (!isNaN(ms)) {
      const d = new Date(ms);
      // JS getDay(): 0=Sun..6=Sat. Remap to 0=Mon..6=Sun, then 45° per day.
      const dayIdx = (d.getDay() + 6) % 7;
      return dayIdx * 45;
    }
    return idAngle(s.id);
  }

  return idAngle(s.id);
}

type ResolveAnim = {
  signal: Signal;
  meta: TypeMeta;
  ring: RingKey;
  startX: number;
  startY: number;
  travel: Animated.Value;
  emojiOpacity: Animated.Value;
};

function DashedRing({ radius, opacity }: { radius: number; opacity: number }) {
  const size = radius * 2 + 4;
  const c = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dashCount = Math.max(24, Math.round(radius * 0.8));
  const dashLen = circumference / dashCount / 2;
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={c}
        cy={c}
        r={radius}
        stroke={OFF_WHITE}
        strokeOpacity={opacity}
        strokeWidth={1}
        fill="none"
        strokeDasharray={`${dashLen},${dashLen}`}
      />
    </Svg>
  );
}

// Ring of text markers placed just outside the expanded ring's radius.
// Inner: 6 hour stamps across 6 AM–9 PM. Middle: 7 weekday stamps. Outer:
// 4 week stamps. Doesn't rotate.
function ExpandedRingMarkers({
  ring,
  cx,
  cy,
}: {
  ring: RingKey;
  cx: number;
  cy: number;
}) {
  const labelRadius = EXPANDED_RADIUS + 18;

  let markers: { label: string; angleDeg: number }[] = [];
  if (ring === 'inner') {
    markers = [
      { label: '6AM', angleDeg: 45 },
      { label: '9AM', angleDeg: 90 },
      { label: '12PM', angleDeg: 135 },
      { label: '3PM', angleDeg: 180 },
      { label: '6PM', angleDeg: 225 },
      { label: '9PM', angleDeg: 270 },
    ];
  } else if (ring === 'middle') {
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    markers = days.map((label, i) => ({ label, angleDeg: i * MIDDLE_DEG_PER_DAY }));
  } else {
    markers = [
      { label: 'WEEK 1', angleDeg: 0 },
      { label: 'WEEK 2', angleDeg: 90 },
      { label: 'WEEK 3', angleDeg: 180 },
      { label: 'WEEK 4', angleDeg: 270 },
    ];
  }

  return (
    <>
      {markers.map((m, i) => {
        const a = (m.angleDeg * Math.PI) / 180;
        const x = cx + labelRadius * Math.cos(a - Math.PI / 2);
        const y = cy + labelRadius * Math.sin(a - Math.PI / 2);
        return (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: x - 30,
              top: y - 6,
              width: 60,
              alignItems: 'center',
            }}>
            <Text style={styles.expandedMarker}>{m.label}</Text>
          </View>
        );
      })}
    </>
  );
}

// Faint full circle at the expanded radius — visual reference frame so
// the user sees the orbit even if no signals are visible at some angles.
function ReferenceCircle({ cx, cy }: { cx: number; cy: number }) {
  const size = EXPANDED_RADIUS * 2 + 4;
  return (
    <Svg
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: cx - size / 2,
        top: cy - size / 2,
      }}
      width={size}
      height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={EXPANDED_RADIUS}
        stroke={OFF_WHITE}
        strokeOpacity={0.08}
        strokeWidth={1}
        fill="none"
      />
    </Svg>
  );
}

// Thin brass tick from center to the expanded ring at the current hour
// position — only meaningful when the inner ring is expanded.
function CurrentTimeIndicator({ cx, cy }: { cx: number; cy: number }) {
  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;
  const clamped = Math.max(INNER_ARC_HOURS_START, Math.min(INNER_ARC_HOURS_END, hours));
  const angleDeg = INNER_ARC_START_DEG + (clamped - INNER_ARC_HOURS_START) * INNER_DEG_PER_HOUR;
  const a = (angleDeg * Math.PI) / 180;
  const size = EXPANDED_RADIUS * 2 + 4;
  const c = size / 2;
  const tipX = c + EXPANDED_RADIUS * Math.cos(a - Math.PI / 2);
  const tipY = c + EXPANDED_RADIUS * Math.sin(a - Math.PI / 2);
  return (
    <Svg
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: cx - c,
        top: cy - c,
      }}
      width={size}
      height={size}>
      <Line x1={c} y1={c} x2={tipX} y2={tipY} stroke={BRASS} strokeOpacity={0.5} strokeWidth={1} />
    </Svg>
  );
}

function RotatingRing({
  ring,
  cx,
  cy,
  signals,
  pausedSignalId,
  dimmedTypeKey,
  highlightedTypeKey,
  expandedRing,
  onSignalPress,
}: {
  ring: RingDef;
  cx: number;
  cy: number;
  signals: Signal[];
  pausedSignalId: string | null;
  dimmedTypeKey: string | null;
  highlightedTypeKey: string | null;
  expandedRing: RingKey | null;
  onSignalPress: (s: Signal) => void;
}) {
  const rotation = useRef(new Animated.Value(0)).current;
  const isExpanded = expandedRing === ring.key;
  const isDimmed = expandedRing !== null && !isExpanded;
  // Rotation pauses when (a) any signal on this ring is selected for Finale
  // OR (b) this ring itself is the expanded one. Other rings keep rotating
  // in the background — they're visibly dimmed so the motion isn't noisy.
  const paused =
    isExpanded ||
    (pausedSignalId !== null && signals.some((s) => String(s.id) === pausedSignalId));
  const pausedRef = useRef(paused);

  // Scale and opacity animations driven by expansion state. Spring on the
  // way up to 155px, timing on the way down/out to 0.7. Opacity is timing
  // (a spring on opacity reads as a flicker). useNativeDriver false on
  // scale because the rest of the file uses native, but mixing scale +
  // rotate on the same view with native driver is fine — both transform
  // properties are native-supported.
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const targetScale = isExpanded
      ? EXPANDED_RADIUS / ring.radius
      : isDimmed
      ? 0.7
      : 1;
    const targetOpacity = isDimmed ? 0.6 : 1;

    Animated.spring(scaleAnim, {
      toValue: targetScale,
      friction: 7,
      tension: 70,
      useNativeDriver: true,
    }).start();
    Animated.timing(opacityAnim, {
      toValue: targetOpacity,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [isExpanded, isDimmed, ring.radius, scaleAnim, opacityAnim]);

  useEffect(() => {
    let stopped = false;
    let currentAnim: Animated.CompositeAnimation | null = null;

    function tick() {
      if (stopped) return;
      if (pausedRef.current) {
        setTimeout(tick, 80);
        return;
      }
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

  const size = ring.radius * 2 + 4;
  // Index missing-ETA signals so expandedAngleForSignal can distribute
  // them evenly without colliding.
  const missingEtaSignals = isExpanded
    ? signals.filter((s) => isNaN(parseEta(s.eta)))
    : [];
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: cx - size / 2,
        top: cy - size / 2,
        width: size,
        height: size,
        opacity: opacityAnim,
        transform: [{ rotate: spin }, { scale: scaleAnim }],
      }}>
      <DashedRing radius={ring.radius} opacity={ring.strokeOpacity} />

      {signals.map((s) => {
        const meta = metaForRing(s, ring.key);
        let angleDeg: number;
        if (isExpanded) {
          const fallbackIndex = missingEtaSignals.findIndex(
            (m) => String(m.id) === String(s.id),
          );
          angleDeg = expandedAngleForSignal(
            s,
            ring.key,
            Math.max(0, fallbackIndex),
            missingEtaSignals.length,
          );
        } else {
          angleDeg = angleDegForSignal(s, ring.key);
        }
        const angle = (angleDeg * Math.PI) / 180;
        const x = size / 2 + ring.radius * Math.cos(angle - Math.PI / 2);
        const y = size / 2 + ring.radius * Math.sin(angle - Math.PI / 2);
        const tk = typeKeyFor(s);
        const isHighlighted = highlightedTypeKey === tk;
        const isDottedDimmed = dimmedTypeKey !== null && !isHighlighted;
        return (
          <SignalDot
            key={String(s.id)}
            meta={meta}
            x={x}
            y={y}
            pulseMs={ring.pulseMs}
            paused={pausedSignalId === String(s.id)}
            dim={isDottedDimmed}
            highlight={isHighlighted}
            onPress={() => onSignalPress(s)}
          />
        );
      })}
    </Animated.View>
  );
}

function SignalDot({
  meta,
  x,
  y,
  pulseMs,
  paused,
  dim,
  highlight,
  onPress,
}: {
  meta: TypeMeta;
  x: number;
  y: number;
  pulseMs: number;
  paused: boolean;
  dim: boolean;
  highlight: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pausedRef = useRef(paused);
  const highlightRef = useRef(highlight);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { highlightRef.current = highlight; }, [highlight]);

  useEffect(() => {
    let stopped = false;
    let currentAnim: Animated.CompositeAnimation | null = null;

    function tick(toValue: number) {
      if (stopped) return;
      if (pausedRef.current) {
        setTimeout(() => tick(toValue), 80);
        return;
      }
      const peak = highlightRef.current ? 1.45 : 1.25;
      const target = toValue === 1 ? 1 : peak;
      currentAnim = Animated.timing(scale, {
        toValue: target,
        duration: pulseMs / 2,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      });
      currentAnim.start(({ finished }) => {
        if (!finished) return;
        tick(toValue === 1 ? 1.25 : 1);
      });
    }

    tick(1.25);
    return () => {
      stopped = true;
      currentAnim?.stop();
    };
  }, [pulseMs, scale]);

  const baseOpacity = dim ? 0.2 : 1;
  const composedScale = highlight
    ? Animated.multiply(scale, new Animated.Value(1.2 / 1.25))
    : scale;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.signalHit, { left: x - 18, top: y - 18, opacity: baseOpacity }]}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
      <Animated.View
        style={[
          styles.signalCircle,
          {
            backgroundColor: meta.color + '26',
            borderColor: meta.color + '66',
            transform: [{ scale: composedScale }],
          },
        ]}>
        <Text style={styles.signalEmoji}>{meta.emoji}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const WHEEL_ITEM = 60;

const REPEAT_COUNT = 500;

function InfiniteLedger({
  bottomInset,
  width,
  activeTypeKey,
  onTapType,
}: {
  bottomInset: number;
  width: number;
  activeTypeKey: string | null;
  onTapType: (typeKey: string) => void;
}) {
  // 500x repeated data; start at the center. Practically infinite in either
  // direction, so no boundary detection / jump needed.
  const repeated = useMemo(() => {
    const out: string[] = new Array(LEGEND_ORDER.length * REPEAT_COUNT);
    for (let i = 0; i < REPEAT_COUNT; i++) {
      for (let j = 0; j < LEGEND_ORDER.length; j++) {
        out[i * LEGEND_ORDER.length + j] = LEGEND_ORDER[j];
      }
    }
    return out;
  }, []);
  const listRef = useRef<FlatList<string>>(null);
  const centerIndex = Math.floor(REPEAT_COUNT / 2) * LEGEND_ORDER.length;
  const sidePad = Math.max(0, width / 2 - WHEEL_ITEM / 2);

  useEffect(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        offset: centerIndex * WHEEL_ITEM,
        animated: false,
      });
    });
  }, [centerIndex]);

  return (
    <View style={[styles.legendWrap, { paddingBottom: 12 + bottomInset }]}>
      <View pointerEvents="none" style={[styles.wheelIndicator, { left: width / 2 - WHEEL_ITEM / 2 }]} />
      <View pointerEvents="none" style={[styles.wheelIndicator, { left: width / 2 + WHEEL_ITEM / 2 }]} />
      <FlatList
        ref={listRef}
        horizontal
        data={repeated}
        keyExtractor={(t, i) => `${t}-${i}`}
        showsHorizontalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM}
        decelerationRate="fast"
        initialScrollIndex={centerIndex}
        initialNumToRender={20}
        windowSize={5}
        maxToRenderPerBatch={20}
        getItemLayout={(_, i) => ({ length: WHEEL_ITEM, offset: WHEEL_ITEM * i, index: i })}
        contentContainerStyle={{ paddingHorizontal: sidePad }}
        renderItem={({ item }) => {
          const meta = TYPE_META[item];
          const isActive = activeTypeKey === item;
          return (
            <TouchableOpacity
              onPress={() => onTapType(item)}
              activeOpacity={0.6}
              style={[styles.wheelItem, isActive && styles.wheelItemActive]}>
              <Text style={styles.wheelEmoji}>{meta.emoji}</Text>
              <Text style={[styles.wheelLabel, { color: meta.color }]}>
                {meta.label.toLowerCase()}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
      <TouchableOpacity
        style={styles.missedCuesLink}
        onPress={() => router.push('/(tabs)/missed-cues')}
        activeOpacity={0.6}>
        <Text style={styles.missedCuesLinkText}>Missed Cues</Text>
      </TouchableOpacity>
    </View>
  );
}

function Ripple({
  cx,
  cy,
  color,
  delay,
  onDone,
}: {
  cx: number;
  cy: number;
  color: string;
  delay: number;
  onDone?: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    anim.start(({ finished }) => {
      if (finished) onDone?.();
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.05, 1] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: cx - 80,
        top: cy - 80,
        width: 160,
        height: 160,
        borderRadius: 80,
        borderWidth: 1.5,
        borderColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

export default function HoverScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selected, setSelected] = useState<Signal | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveAnims, setResolveAnims] = useState<ResolveAnim[]>([]);
  const [ripples, setRipples] = useState<{ id: number; color: string; delay: number }[]>([]);
  const rippleSeq = useRef(0);
  const [centerPulse] = useState(() => new Animated.Value(1));
  const [filterTypeKey, setFilterTypeKey] = useState<string | null>(null);
  const [expandedRing, setExpandedRing] = useState<RingKey | null>(null);
  const signalsRef = useRef<Signal[]>([]);
  const expandedRingRef = useRef<RingKey | null>(null);

  useEffect(() => {
    signalsRef.current = signals;
  }, [signals]);
  useEffect(() => {
    expandedRingRef.current = expandedRing;
  }, [expandedRing]);

  const cx = width / 2;
  const cy = height / 2 - 50;

  // Header + legend opacity animations driven by expandedRing. Both fade
  // when any ring is expanded — header to 0 (out of the way), legend to
  // 0.3 (still visible but recedes).
  const headerOpacity = useRef(new Animated.Value(1)).current;
  const legendOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(headerOpacity, {
      toValue: expandedRing ? 0 : 1,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
    Animated.timing(legendOpacity, {
      toValue: expandedRing ? 0.3 : 1,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [expandedRing, headerOpacity, legendOpacity]);

  async function loadSignals(): Promise<Signal[]> {
    try {
      const res = await fetch(`${API_BASE}/signals?userId=${USER_ID}`);
      const data = await res.json();
      const active: Signal[] = (data.signals || []).filter(
        (s: Signal) => !s.state || s.state === 'incoming' || s.state === 'active'
      );
      setSignals(active);
      return active;
    } catch {
      return [];
    }
  }

  useEffect(() => {
    loadSignals();
    const id = setInterval(loadSignals, 60000);
    return () => clearInterval(id);
  }, []);

  // Auto-open Finale every time the screen gains focus and a pendingSignalId
  // is in AsyncStorage. Hover is mounted as a tab, so a one-shot mount effect
  // would only fire once — focus effect re-checks on every navigation.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const pendingId = await AsyncStorage.getItem(PENDING_SIGNAL_KEY);
          if (!pendingId || cancelled) return;
          await AsyncStorage.removeItem(PENDING_SIGNAL_KEY);
          let match = signalsRef.current.find((s) => String(s.id) === String(pendingId));
          if (!match) {
            const fresh = await loadSignals();
            if (cancelled) return;
            match = fresh.find((s) => String(s.id) === String(pendingId));
          }
          if (match && !cancelled) setSelected(match);
        } catch {
          // ignore
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const grouped = useMemo(() => {
    const animatingIds = new Set(resolveAnims.map((a) => String(a.signal.id)));
    const out: Record<RingKey, Signal[]> = { inner: [], middle: [], outer: [] };
    for (const s of signals) {
      if (animatingIds.has(String(s.id))) continue;
      out[ringForSignal(s)].push(s);
    }
    return out;
  }, [signals, resolveAnims]);

  function startRest(signal: Signal) {
    const ring = ringForSignal(signal);
    const meta = metaForRing(signal, ring);
    const ringDef = RINGS[ring];
    const angle = (angleDegForSignal(signal, ring) * Math.PI) / 180;
    const startX = cx + ringDef.radius * Math.cos(angle - Math.PI / 2);
    const startY = cy + ringDef.radius * Math.sin(angle - Math.PI / 2);

    const travel = new Animated.Value(0);
    const emojiOpacity = new Animated.Value(1);
    const anim: ResolveAnim = { signal, meta, ring, startX, startY, travel, emojiOpacity };
    setResolveAnims((prev) => [...prev, anim]);

    Animated.timing(travel, {
      toValue: 1,
      duration: 800,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      Animated.timing(emojiOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();

      Animated.sequence([
        Animated.timing(centerPulse, { toValue: 1.3, duration: 150, useNativeDriver: true }),
        Animated.timing(centerPulse, { toValue: 1.0, duration: 150, useNativeDriver: true }),
      ]).start();

      const baseId = ++rippleSeq.current;
      const newRipples = [0, 100, 200].map((delay, i) => ({
        id: baseId * 10 + i,
        color: meta.color,
        delay,
      }));
      setRipples((prev) => [...prev, ...newRipples]);

      setTimeout(() => {
        setSignals((prev) => prev.filter((s) => String(s.id) !== String(signal.id)));
        setResolveAnims((prev) => prev.filter((a) => a !== anim));
        setRipples((prev) => prev.filter((r) => !newRipples.some((n) => n.id === r.id)));
      }, 1000);
    });

    fetch(`${API_BASE}/signals`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: signal.id, state: 'resolved', userId: USER_ID }),
    }).catch(() => {});
  }

  function handleRest(signal: Signal) {
    setSelected(null);
    setResolving(false);
    startRest(signal);
  }

  function handleClose() {
    setSelected(null);
  }

  function handleHold(signal: Signal) {
    const id = signal.id;
    setSelected(null);
    fetch(`${API_BASE}/signals`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, state: 'active', userId: USER_ID }),
    }).catch(() => {});
    setSignals((prev) =>
      prev.map((s) => (String(s.id) === String(id) ? { ...s, state: 'active' } : s))
    );
  }

  function handleLegendTap(typeKey: string) {
    setFilterTypeKey((prev) => (prev === typeKey ? null : typeKey));
  }

  const pausedSignalId = selected ? String(selected.id) : null;

  const filteredList = useMemo(() => {
    if (!filterTypeKey) return [];
    return signals.filter((s) => typeKeyFor(s) === filterTypeKey);
  }, [signals, filterTypeKey]);

  // Swipe right → go back to Ground (index tab)
  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-30, 30])
    .failOffsetY([-20, 20])
    .runOnJS(true)
    .onEnd((e) => {
      if (e.translationX > 60 && Math.abs(e.translationY) < 80) {
        router.push('/(tabs)');
      }
    });

  // Long-press on any ring (or its label) expands that ring. Distance from
  // (cx, cy) is bucketed into one of three contiguous zones so labels in
  // the gaps and dots on the rotating ring all resolve correctly. Pressing
  // again on the same ring collapses; on a different ring switches.
  const longPressGesture = Gesture.LongPress()
    .minDuration(400)
    .runOnJS(true)
    .onStart((event) => {
      const dx = event.x - cx;
      const dy = event.y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= RING_HIT_BOUNDARIES.outerOuter) return;
      let target: RingKey;
      if (distance < RING_HIT_BOUNDARIES.innerOuter) target = 'inner';
      else if (distance < RING_HIT_BOUNDARIES.middleOuter) target = 'middle';
      else target = 'outer';
      setExpandedRing((prev) => (prev === target ? null : target));
    });

  // Tap-to-collapse — only when a ring is currently expanded, and only when
  // the tap lands outside the expanded ring's annular hit zone. Taps inside
  // that zone reach signal dots via their own TouchableOpacity, which stays
  // working through gesture-handler races.
  const tapGesture = Gesture.Tap()
    .runOnJS(true)
    .onEnd((event) => {
      if (expandedRingRef.current === null) return;
      const dx = event.x - cx;
      const dy = event.y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const insideExpandedRing =
        Math.abs(distance - EXPANDED_RADIUS) <= EXPANDED_HIT_TOLERANCE;
      if (!insideExpandedRing) setExpandedRing(null);
    });

  const composedGesture = Gesture.Race(swipeGesture, longPressGesture, tapGesture);

  return (
    <GestureDetector gesture={composedGesture}>
      <View style={styles.container}>
        <Animated.View
          pointerEvents="none"
          style={[styles.topHeader, { top: insets.top + 8, opacity: headerOpacity }]}>
          <Text style={styles.topHeaderText}>Management in Motion</Text>
        </Animated.View>

        {expandedRing !== null && <ReferenceCircle cx={cx} cy={cy} />}
        {expandedRing !== null && <ExpandedRingMarkers ring={expandedRing} cx={cx} cy={cy} />}
        {expandedRing === 'inner' && <CurrentTimeIndicator cx={cx} cy={cy} />}

        <RotatingRing
          ring={RINGS.outer}
          cx={cx}
          cy={cy}
          signals={grouped.outer}
          pausedSignalId={pausedSignalId}
          dimmedTypeKey={filterTypeKey}
          highlightedTypeKey={filterTypeKey}
          expandedRing={expandedRing}
          onSignalPress={setSelected}
        />
        <RotatingRing
          ring={RINGS.middle}
          cx={cx}
          cy={cy}
          signals={grouped.middle}
          pausedSignalId={pausedSignalId}
          dimmedTypeKey={filterTypeKey}
          highlightedTypeKey={filterTypeKey}
          expandedRing={expandedRing}
          onSignalPress={setSelected}
        />
        <RotatingRing
          ring={RINGS.inner}
          cx={cx}
          cy={cy}
          signals={grouped.inner}
          pausedSignalId={pausedSignalId}
          dimmedTypeKey={filterTypeKey}
          highlightedTypeKey={filterTypeKey}
          expandedRing={expandedRing}
          onSignalPress={setSelected}
        />

        <Animated.View
          pointerEvents="none"
          style={[
            styles.centerC,
            { left: cx - 11, top: cy - 12, transform: [{ scale: centerPulse }] },
          ]}>
          <Text style={styles.centerCText}>C</Text>
        </Animated.View>

        {/* Fixed (non-rotating) ring labels at 12 o'clock in the gaps between rings.
            The active ring's label brightens (90% opacity, 10px) per the spec. */}
        <View pointerEvents="none" style={[styles.betweenRingLabel, { top: cy - 39 }]}>
          <Text
            style={[
              styles.betweenRingLabelText,
              expandedRing === 'inner' && styles.betweenRingLabelTextActive,
            ]}>
            ACT NOW
          </Text>
        </View>
        <View pointerEvents="none" style={[styles.betweenRingLabel, { top: cy - 94 }]}>
          <Text
            style={[
              styles.betweenRingLabelText,
              expandedRing === 'middle' && styles.betweenRingLabelTextActive,
            ]}>
            APPROACHING FAST
          </Text>
        </View>
        <View pointerEvents="none" style={[styles.betweenRingLabel, { top: cy - 144 }]}>
          <Text
            style={[
              styles.betweenRingLabelText,
              expandedRing === 'outer' && styles.betweenRingLabelTextActive,
            ]}>
            ON THE HORIZON
          </Text>
        </View>

        {resolveAnims.map((a) => {
          const tx = a.travel.interpolate({ inputRange: [0, 1], outputRange: [a.startX, cx] });
          const ty = a.travel.interpolate({ inputRange: [0, 1], outputRange: [a.startY, cy] });
          const scaleDown = a.travel.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] });
          return (
            <Animated.View
              key={`anim-${String(a.signal.id)}`}
              pointerEvents="none"
              style={[
                styles.signalCircle,
                styles.travelDot,
                {
                  backgroundColor: a.meta.color + '26',
                  borderColor: a.meta.color + '66',
                  opacity: a.emojiOpacity,
                  transform: [
                    { translateX: Animated.subtract(tx, new Animated.Value(14)) },
                    { translateY: Animated.subtract(ty, new Animated.Value(14)) },
                    { scale: scaleDown },
                  ],
                },
              ]}>
              <Text style={styles.signalEmoji}>{a.meta.emoji}</Text>
            </Animated.View>
          );
        })}

        {ripples.map((r) => (
          <Ripple key={r.id} cx={cx} cy={cy} color={r.color} delay={r.delay} />
        ))}

        <Animated.View style={{ opacity: legendOpacity }}>
          <InfiniteLedger
            bottomInset={insets.bottom}
            width={width}
            activeTypeKey={filterTypeKey}
            onTapType={handleLegendTap}
          />
        </Animated.View>

        {selected && (
          <FinaleSheet
            mode="single"
            visible={!!selected}
            signal={selected}
            resolving={resolving}
            onClose={handleClose}
            onRest={handleRest}
            onHold={handleHold}
          />
        )}

        {filterTypeKey && (
          <FinaleSheet
            mode="category"
            visible={filterTypeKey !== null}
            categoryTypeKey={filterTypeKey}
            signals={filteredList}
            bottomInset={insets.bottom}
            onClose={() => setFilterTypeKey(null)}
            onRest={(s) => {
              setFilterTypeKey(null);
              setTimeout(() => startRest(s), 50);
            }}
          />
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  topHeader: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  topHeaderText: {
    color: 'rgba(240, 237, 232, 0.35)',
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontWeight: '500',
  },
  centerC: {
    position: 'absolute',
    width: 22,
    alignItems: 'center',
  },
  centerCText: {
    color: OFF_WHITE,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  betweenRingLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  betweenRingLabelText: {
    color: BRASS,
    fontSize: 7,
    letterSpacing: 2,
    fontWeight: '600',
    textTransform: 'uppercase',
    opacity: 0.6,
  },
  betweenRingLabelTextActive: {
    fontSize: 10,
    opacity: 0.9,
  },
  expandedMarker: {
    color: BRASS,
    fontSize: 8,
    letterSpacing: 1,
    fontWeight: '600',
    textTransform: 'uppercase',
    opacity: 0.85,
  },
  signalHit: {
    position: 'absolute',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signalEmoji: {
    fontSize: 16,
    lineHeight: 20,
  },
  travelDot: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  legendWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG,
    paddingTop: 12,
  },
  wheelIndicator: {
    position: 'absolute',
    top: 12,
    bottom: 8,
    width: 1,
    backgroundColor: 'rgba(240, 237, 232, 0.18)',
  },
  wheelItem: {
    width: 60,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  wheelItemActive: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
  },
  wheelEmoji: {
    fontSize: 20,
    lineHeight: 24,
  },
  wheelLabel: {
    fontSize: 10,
    letterSpacing: 0.5,
  },
  missedCuesLink: {
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: 'center',
  },
  missedCuesLinkText: {
    color: '#5a5855',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
