import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line } from 'react-native-svg';

import { AddSignalSheet } from '@/components/AddSignalSheet';
import { FinaleSheet } from '@/components/FinaleSheet';
import { HoverHelpModal } from '@/components/HoverHelpModal';
import { Minimap } from '@/components/Minimap';
import { openConductorSheet } from '@/hooks/useConductorSheet';
import { useUrgentCount } from '@/hooks/useUrgentCount';
import {
  LEGEND_ORDER,
  metaForRing,
  Signal,
  TYPE_META,
  TypeMeta,
  typeKeyFor,
} from '@/components/signalTypes';
import YesterdayModal from '@/components/YesterdayModal';
import { Tooltip } from '@/components/Tooltip';
import { useTheme } from '../theme';
import { useUserId } from '@/hooks/useUserId';

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
  outer:  { key: 'outer',  radius: 165, rotationMs: 60000, strokeOpacity: 0.4, label: 'ON THE HORIZON',    pulseMs: 2500 },
  middle: { key: 'middle', radius: 115, rotationMs: 30000, strokeOpacity: 0.7, label: 'APPROACHING FAST',  pulseMs: 1500 },
  inner:  { key: 'inner',  radius: 65,  rotationMs: 15000, strokeOpacity: 1.0, label: 'ACT NOW',           pulseMs: 600  },
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

// Age pressure — a signal lingering unresolved gradually pulses
// faster on the radar, communicating natural time pressure without
// any manual urgency escalation. Tiered multiplier applied as
// (1 - multiplier) on the ring's base pulseMs.
//   0–2d:  0%   (normal)
//   3–5d:  15%
//   6–9d:  30%
//   10–14: 50%
//   15+:   70%  (cap, equal to urgent inner-ring pulse)
function agePressureMultiplier(signal: Signal): number {
  const stamp = signal.lastUpdate || signal.createdAt;
  if (!stamp) return 0;
  const ms = Date.parse(stamp);
  if (isNaN(ms)) return 0;
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days < 3) return 0;
  if (days < 6) return 0.15;
  if (days < 10) return 0.30;
  if (days < 15) return 0.50;
  return 0.70;
}

function signalAgeDays(signal: Signal): number {
  const stamp = signal.lastUpdate || signal.createdAt;
  if (!stamp) return 0;
  const ms = Date.parse(stamp);
  if (isNaN(ms)) return 0;
  return Math.floor((Date.now() - ms) / 86400000);
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
  const { accentColor } = useTheme();
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
        stroke={accentColor}
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
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
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
  freshlyAddedIds,
  onSignalPress,
  crewColorMap,
}: {
  ring: RingDef;
  cx: number;
  cy: number;
  signals: Signal[];
  pausedSignalId: string | null;
  dimmedTypeKey: string | null;
  highlightedTypeKey: string | null;
  expandedRing: RingKey | null;
  freshlyAddedIds: Set<string>;
  onSignalPress: (s: Signal) => void;
  crewColorMap: Record<string, string>;
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

    // Snappier spring on expansion — higher tension + matching friction
    // lands the ring at its target around 200ms with a clean settle and
    // no visible bounce. Opacity fade on other-ring dim follows in 150ms
    // so signal repositioning reads as one unified motion.
    Animated.spring(scaleAnim, {
      toValue: targetScale,
      friction: 14,
      tension: 200,
      useNativeDriver: true,
    }).start();
    Animated.timing(opacityAnim, {
      toValue: targetOpacity,
      duration: 150,
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
        // Age pressure widens pulse rate as the signal lingers.
        // 600ms floor matches inner-ring urgent pulse — never faster
        // than the most urgent dot on the radar.
        const pressure = agePressureMultiplier(s);
        const ageDays = signalAgeDays(s);
        const effectivePulseMs = Math.max(600, Math.round(ring.pulseMs * (1 - pressure)));
        const crewMemberId = (s as Signal & { crewMemberId?: string }).crewMemberId;
        const crewKey = crewMemberId ? String(crewMemberId).toLowerCase().trim() : '';
        const crewOverride = crewKey ? crewColorMap[crewKey] : undefined;
        return (
          <SignalDot
            key={String(s.id)}
            meta={meta}
            x={x}
            y={y}
            pulseMs={effectivePulseMs}
            ageDays={ageDays}
            paused={pausedSignalId === String(s.id)}
            dim={isDottedDimmed}
            highlight={isHighlighted}
            freshlyAdded={freshlyAddedIds.has(String(s.id))}
            onPress={() => onSignalPress(s)}
            crewOverride={crewOverride}
            isAttributed={!!crewMemberId}
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
  ageDays,
  paused,
  dim,
  highlight,
  freshlyAdded,
  onPress,
  crewOverride,
  isAttributed,
}: {
  meta: TypeMeta;
  x: number;
  y: number;
  pulseMs: number;
  ageDays: number;
  paused: boolean;
  dim: boolean;
  highlight: boolean;
  freshlyAdded?: boolean;
  onPress: () => void;
  crewOverride?: string;
  isAttributed?: boolean;
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  // Dot color routes by attribution: crewOverride when attributed to a
  // mapped crew member, accentColor otherwise. Type info is still
  // conveyed by the emoji glyph + legend wheel — color signals "whose"
  // not "what". Note `isAttributed` is unused for now but kept on the
  // contract so a future "attributed-but-unmapped" branch can diverge
  // from the default accent fallback.
  void isAttributed;
  const dotColor = crewOverride || accentColor;
  const scale = useRef(new Animated.Value(1)).current;
  const pausedRef = useRef(paused);
  const highlightRef = useRef(highlight);
  const isFirstPulseRef = useRef(!!freshlyAdded);

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
      // First pulse is brighter when the signal was just added — gives
      // the user a "this is new" cue. After the first peak fades back
      // to 1, we fall into the steady-state pulse.
      let peak: number;
      if (isFirstPulseRef.current && toValue !== 1) {
        peak = 1.85;
        isFirstPulseRef.current = false;
      } else {
        peak = highlightRef.current ? 1.45 : 1.25;
      }
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
            // Signals 10+ days old shift to a subtle amber tint —
            // "this has been waiting" cue, without alarming the user
            // by changing the emoji or position.
            backgroundColor: dotColor + '26',
            borderColor: dotColor + '66',
            transform: [{ scale: composedScale }],
          },
        ]}>
        {ageDays >= 10 ? (
          <View
            pointerEvents="none"
            style={[styles.signalCircle, styles.signalAgedOverlay]}
          />
        ) : null}
        <Text style={styles.signalEmoji}>{meta.emoji}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const WHEEL_ITEM = 60;

const REPEAT_COUNT = 500;

// One cycle of the wheel = all signal-type filters, then a slim visual
// divider, then the navigation shortcuts. Repeated REPEAT_COUNT times to
// give the FlatList an infinite-feeling scroll in either direction.
type WheelItem =
  | { kind: 'type'; key: string }
  | { kind: 'divider' }
  | {
      kind: 'nav';
      key: string;
      label: string;
      emoji: string;
      route?: string;
      action?: 'yesterday' | 'addSignal';
    };

const NAV_ITEMS: WheelItem[] = [
  { kind: 'nav', key: 'home', label: 'Ground', emoji: '🏠', route: '/(tabs)/' },
  { kind: 'nav', key: 'yesterday', label: 'Yesterday', emoji: '🌅', action: 'yesterday' },
  // Vault route is a placeholder — the screen file doesn't exist yet, tap
  // will trigger an expo-router 404 until app/vault.tsx is created.
  { kind: 'nav', key: 'vault', label: 'Vault', emoji: '🗂', route: '/vault' },
  { kind: 'nav', key: 'cues', label: 'Cues', emoji: '⚠️', route: '/missed-cues' },
  { kind: 'nav', key: 'horizon', label: 'Horizon', emoji: '🔭', route: '/horizon' },
  { kind: 'nav', key: 'programme', label: 'Programme', emoji: '📅', route: '/programme' },
  { kind: 'nav', key: 'calendar', label: 'Calendar', emoji: '📆', route: '/calendar' },
  { kind: 'nav', key: 'compass', label: 'Compass', emoji: '🧭', route: '/compass' },
  { kind: 'nav', key: 'crew', label: 'Crew', emoji: '👨‍👩‍👧', route: '/crew' },
  { kind: 'nav', key: 'settings', label: 'Settings', emoji: '⚙️', route: '/(tabs)/settings' },
  // Add Signal lives in the wheel after the route shortcuts. "+" is plain
  // ASCII (not an emoji glyph) so it accepts color tinting — the renderer
  // brass-tints just this glyph to match the navLabel below.
  { kind: 'nav', key: 'addSignal', label: 'Signal', emoji: '+', action: 'addSignal' },
];

const WHEEL_BASE: WheelItem[] = [
  ...LEGEND_ORDER.map<WheelItem>((k) => ({ kind: 'type', key: k })),
  { kind: 'divider' },
  ...NAV_ITEMS,
];

// CollapsibleNavBar — replaces the legacy InfiniteLedger wheel.
// Collapsed: a thin 36px strip at the bottom with a center grab
// handle and an urgent-count badge when > 0. Expanded: 160px tall
// horizontal row of 5 nav options (Horizon / Programme / Calendar /
// Missed Cues / The Conductor). Toggle on tap of the handle area;
// swipe up expands, swipe down collapses. Spring animation on the
// height transition.
type NavOption = {
  key: string;
  icon: string;
  label: string;
  route?: string;
  action?: () => void;
};

function CollapsibleNavBar({
  bottomInset,
  urgentCount,
  opacity,
  onOpenConductor,
}: {
  bottomInset: number;
  urgentCount: number;
  opacity: Animated.AnimatedInterpolation<number> | Animated.Value;
  onOpenConductor: () => void;
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);

  const COLLAPSED_H = 36;
  const EXPANDED_H = 160;
  const [expanded, setExpanded] = useState(false);
  const heightAnim = useRef(new Animated.Value(COLLAPSED_H)).current;

  useEffect(() => {
    Animated.spring(heightAnim, {
      toValue: expanded ? EXPANDED_H : COLLAPSED_H,
      damping: 14,
      stiffness: 140,
      mass: 0.9,
      useNativeDriver: false,
    }).start();
  }, [expanded, heightAnim]);

  // Pan gesture — vertical swipe toggles. Threshold 30px in either
  // direction so a small finger-jitter doesn't trigger.
  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .runOnJS(true)
    .onEnd((e) => {
      if (e.translationY < -30) setExpanded(true);
      else if (e.translationY > 30) setExpanded(false);
    });

  const options: NavOption[] = [
    { key: 'horizon',    icon: '📅', label: 'Horizon',    route: '/horizon' },
    { key: 'programme',  icon: '📋', label: 'Programme',  route: '/programme' },
    { key: 'calendar',   icon: '🗓',  label: 'Calendar',   route: '/calendar' },
    { key: 'cues',       icon: '⚠️', label: 'Missed Cues', route: '/missed-cues' },
    { key: 'conductor',  icon: '◉',  label: 'The Conductor', action: onOpenConductor },
  ];

  function tapOption(opt: NavOption) {
    setExpanded(false);
    if (opt.action) opt.action();
    else if (opt.route) {
      // brief delay so the collapse animation reads visually
      // before the route push tears down the screen.
      setTimeout(() => router.push(opt.route as never), 120);
    }
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.collapsibleBar,
          {
            height: heightAnim,
            paddingBottom: bottomInset,
            opacity,
          },
        ]}>
        {/* Handle area — full bar width, taps toggle expand/collapse. */}
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={styles.collapsibleHandleArea}
          hitSlop={{ top: 4, bottom: 0, left: 0, right: 0 }}>
          <View style={styles.collapsibleHandle} />
          {urgentCount > 0 && !expanded ? (
            <View style={styles.collapsibleBadge}>
              <Text style={styles.collapsibleBadgeText}>{urgentCount}</Text>
            </View>
          ) : null}
        </Pressable>
        {/* Expanded options — fade in once the bar grows past the
            collapsed footprint. AnimatedValue interpolation maps the
            shared height to opacity so the labels don't show through
            the handle when nearly closed. */}
        <Animated.View
          style={[
            styles.collapsibleOptions,
            {
              opacity: heightAnim.interpolate({
                inputRange: [COLLAPSED_H, EXPANDED_H],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
          pointerEvents={expanded ? 'auto' : 'none'}>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => tapOption(opt)}
              activeOpacity={0.6}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={styles.collapsibleOption}>
              <Text style={styles.collapsibleOptionIcon}>{opt.icon}</Text>
              <Text style={styles.collapsibleOptionLabel}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function InfiniteLedger({
  bottomInset,
  width,
  activeTypeKey,
  opacity,
  onTapType,
  onYesterday,
  onAddSignal,
}: {
  bottomInset: number;
  width: number;
  activeTypeKey: string | null;
  opacity: Animated.AnimatedInterpolation<number> | Animated.Value;
  onTapType: (typeKey: string) => void;
  onYesterday: () => void;
  onAddSignal: () => void;
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  // 500x repeated data; start at the center. Practically infinite in either
  // direction, so no boundary detection / jump needed.
  const repeated = useMemo(() => {
    const out: WheelItem[] = new Array(WHEEL_BASE.length * REPEAT_COUNT);
    for (let i = 0; i < REPEAT_COUNT; i++) {
      for (let j = 0; j < WHEEL_BASE.length; j++) {
        out[i * WHEEL_BASE.length + j] = WHEEL_BASE[j];
      }
    }
    return out;
  }, []);
  const listRef = useRef<FlatList<WheelItem>>(null);
  const centerIndex = Math.floor(REPEAT_COUNT / 2) * WHEEL_BASE.length;
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
    <Animated.View style={[styles.legendWrap, { paddingBottom: 12 + bottomInset, opacity }]}>
      <View pointerEvents="none" style={[styles.wheelIndicator, { left: width / 2 - WHEEL_ITEM / 2 }]} />
      <View pointerEvents="none" style={[styles.wheelIndicator, { left: width / 2 + WHEEL_ITEM / 2 }]} />
      <FlatList
        ref={listRef}
        horizontal
        data={repeated}
        keyExtractor={(item, i) => `${item.kind}-${'key' in item ? item.key : 'div'}-${i}`}
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
          if (item.kind === 'divider') {
            return (
              <View pointerEvents="none" style={styles.wheelItem}>
                <View style={styles.wheelDivider} />
              </View>
            );
          }
          if (item.kind === 'nav') {
            // Brass-tint just the "+" glyph for the addSignal item — every
            // other nav uses an emoji glyph that ignores color tinting, so
            // navLabel below carries the brass for them. "+" is plain ASCII
            // and accepts color, so it gets the explicit override here.
            const isAddSignal = item.action === 'addSignal';
            return (
              <TouchableOpacity
                onPress={() => {
                  if (item.action === 'yesterday') onYesterday();
                  else if (item.action === 'addSignal') onAddSignal();
                  else if (item.route) router.push(item.route as never);
                }}
                activeOpacity={0.6}
                style={styles.wheelItem}>
                <Text style={[styles.wheelEmoji, isAddSignal && { color: BRASS }]}>
                  {item.emoji}
                </Text>
                <Text style={[styles.wheelLabel, styles.navLabel]}>
                  {item.label.toLowerCase()}
                </Text>
              </TouchableOpacity>
            );
          }
          // type filter
          const meta = TYPE_META[item.key];
          const isActive = activeTypeKey === item.key;
          return (
            <TouchableOpacity
              onPress={() => onTapType(item.key)}
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
      <View style={styles.deepLinkRow}>
        <TouchableOpacity
          style={styles.deepLink}
          onPress={() => router.push('/missed-cues')}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.missedCuesLinkText}>Missed Cues</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deepLink}
          onPress={() => router.push('/horizon')}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.missedCuesLinkText}>The Horizon</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
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

// Family vs personal view: family shows every household signal; personal
// filters to signal.userId === userId or unowned (no userId). Toggle
// persists in AsyncStorage so the choice survives app restarts. Minimap
// on Ground reads the same key to stay in sync with Hover.
const VIEW_MODE_KEY = 'hoverViewMode';
type ViewMode = 'family' | 'personal';

// Crew avatar accent palette — referenced defensively here in case any
// render path expects it. Kept as a stable export-shape constant so
// future code can pull a deterministic color per crew index without
// importing from elsewhere.
const CREW_COLORS = [
  '#b8960c', '#7c9e87', '#8b7355', '#6b8cae',
  '#a67c9e', '#ae7c7c', '#7c9eae', '#ae9e7c',
];
const crewColor = (index: number): string =>
  CREW_COLORS[Math.max(0, index ?? 0) % CREW_COLORS.length];

export default function HoverScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const FIRST_NAME = (() => {
    const raw = userId.split('_')[0] || '';
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  })();
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const urgentCount = useUrgentCount();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [showRingsTip, setShowRingsTip] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showReveal, setShowReveal] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const seen = await AsyncStorage.getItem('tutorial_hover_rings');
        if (!seen) setShowRingsTip(true);
      } catch { /* ignore */ }
    })();
  }, []);

  // One-time "your radar is now fully active" reveal — fires once the
  // household has been connected ~7 days. We piggyback on a stored
  // connectedAt timestamp written at first launch; if missing, the
  // reveal stays silent until something else seeds it.
  useEffect(() => {
    (async () => {
      try {
        const already = await AsyncStorage.getItem('hover_full_revealed');
        if (already) return;
        const connectedAtStr = await AsyncStorage.getItem('connected_at');
        if (!connectedAtStr) return;
        const ms = Date.parse(connectedAtStr);
        if (isNaN(ms)) return;
        const days = (Date.now() - ms) / (24 * 60 * 60 * 1000);
        if (days >= 7) setShowReveal(true);
      } catch { /* ignore */ }
    })();
  }, []);
  const [viewMode, setViewMode] = useState<ViewMode>('family');
  // Crew member filter — only active in personal view. Resets when
  // the user toggles back to family view. Crew list fetched once on
  // mount and refreshed when the tab regains focus.
  const [crewFilter, setCrewFilter] = useState<string | null>(null);
  const [crewList, setCrewList] = useState<{ name: string; photoUrl?: string | null }[]>([]);
  // Stable color-per-crew-member lookup. Backend records crewMemberId on
  // signals as the lowercased trimmed name, so we key the map the same
  // way. Index in crewList → CREW_COLORS slot, so colors stay stable as
  // long as crew order is stable on the server.
  const crewColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    crewList.forEach((c, i) => {
      const k = String(c.name || '').toLowerCase().trim();
      if (k) m[k] = crewColor(i);
    });
    return m;
  }, [crewList]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://conductor-ivory.vercel.app/api/signals?type=crew&userId=${userId}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data?.crew)
          ? data.crew
              .filter((m: any) => m && m.name)
              .map((m: any) => ({ name: m.name, photoUrl: m.photoUrl }))
          : [];
        setCrewList(list);
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [selected, setSelected] = useState<Signal | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveAnims, setResolveAnims] = useState<ResolveAnim[]>([]);
  const [ripples, setRipples] = useState<{ id: number; color: string; delay: number }[]>([]);
  const rippleSeq = useRef(0);
  const [centerPulse] = useState(() => new Animated.Value(1));
  const [filterTypeKey, setFilterTypeKey] = useState<string | null>(null);
  const [expandedRing, setExpandedRing] = useState<RingKey | null>(null);
  const [showYesterday, setShowYesterday] = useState(false);
  const [showAddSignal, setShowAddSignal] = useState(false);
  const [freshlyAddedIds, setFreshlyAddedIds] = useState<Set<string>>(() => new Set());
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

  // Tracks signal IDs we've already attempted to prefetch a suggestion
  // for. Prefetch happens on every loadSignals tick but skips anything
  // we've already poked at — keeps the per-minute network noise to
  // genuinely-new signals while the user has Hover open.
  const prefetchedRef = useRef<Set<string>>(new Set());

  function prefetchSuggestionsBackground(active: Signal[]) {
    // Rank by ETA ascending; the 3 nearest signals are the ones most
    // likely to be tapped next. Skip already-prefetched IDs and signals
    // with no parseable ETA.
    const ranked = active
      .filter((s) => s.eta && !prefetchedRef.current.has(String(s.id)))
      .map((s) => ({ s, ms: Date.parse(String(s.eta)) }))
      .filter((x) => !isNaN(x.ms))
      .sort((a, b) => a.ms - b.ms)
      .slice(0, 3);
    for (const { s } of ranked) {
      prefetchedRef.current.add(String(s.id));
      fetch(`${API_BASE}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          signalId: s.id,
          signalType: s.type || 'unknown',
          description: s.description || '',
          sender: s.sender || '',
          status: s.status || '',
          eta: s.eta || '',
        }),
      }).catch(() => {});
    }
  }

  async function loadSignals(): Promise<Signal[]> {
    try {
      const res = await fetch(`${API_BASE}/signals?userId=${userId}`);
      const data = await res.json();
      const active: Signal[] = (data.signals || []).filter(
        (s: Signal) => !s.state || s.state === 'incoming' || s.state === 'active'
      );
      setSignals(active);
      prefetchSuggestionsBackground(active);
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

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY)
      .then((v) => {
        if (v === 'personal' || v === 'family') setViewMode(v);
      })
      .catch(() => {});
  }, []);

  function toggleViewMode() {
    const next: ViewMode = viewMode === 'family' ? 'personal' : 'family';
    setViewMode(next);
    // Toggling out of personal clears any crew filter so re-entry
    // starts fresh.
    if (next === 'family') setCrewFilter(null);
    AsyncStorage.setItem(VIEW_MODE_KEY, next).catch(() => {});
  }

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
      // Crew member filter (personal view only) — when a crew name
      // is selected, restrict to signals tagged to that member.
      if (viewMode === 'personal' && crewFilter) {
        const cm = (s as Signal & { crewMemberId?: string }).crewMemberId;
        if (!cm || String(cm).toLowerCase().trim() !== crewFilter.toLowerCase().trim()) {
          continue;
        }
      } else if (viewMode === 'personal' && s.userId && s.userId !== userId) {
        // Default personal view: drop signals owned by someone else.
        // Unowned (userId null) signals appear in both modes.
        continue;
      }
      out[ringForSignal(s)].push(s);
    }
    return out;
  }, [signals, resolveAnims, viewMode, crewFilter]);

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
      body: JSON.stringify({ id: signal.id, state: 'resolved', userId: userId }),
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
      body: JSON.stringify({ id, state: 'active', userId: userId }),
    }).catch(() => {});
    setSignals((prev) =>
      prev.map((s) => (String(s.id) === String(id) ? { ...s, state: 'active' } : s))
    );
  }

  // Optimistic in-place update from FinaleSheet edit mode. The PATCH
  // itself is fired inside the sheet; we just keep our local copy in
  // sync so the list and the open sheet both reflect the new fields.
  function handleSignalUpdate(updated: Signal) {
    setSignals((prev) =>
      prev.map((s) => (String(s.id) === String(updated.id) ? { ...s, ...updated } : s))
    );
    setSelected((cur) =>
      cur && String(cur.id) === String(updated.id) ? { ...cur, ...updated } : cur
    );
  }

  // Optimistic insert from AddSignalSheet. The POST itself is fired
  // inside the sheet; we add the returned signal to local state so the
  // dot lands on the radar immediately. We also flag the id as
  // freshly-added for ~3s so SignalDot's first-pulse renders brighter.
  function handleSignalAdded(added: Signal) {
    setSignals((prev) => [added, ...prev]);
    const idStr = String(added.id);
    setFreshlyAddedIds((prev) => {
      const next = new Set(prev);
      next.add(idStr);
      return next;
    });
    setTimeout(() => {
      setFreshlyAddedIds((prev) => {
        if (!prev.has(idStr)) return prev;
        const next = new Set(prev);
        next.delete(idStr);
        return next;
      });
    }, 3000);
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
        {/* Minimap at top-left — the big radar IS the same picture
            at a larger scale, but the tap surface for ConductorSheet
            still lives here so the affordance is universal. Keeps
            clear of the `?` help button at top-right. */}
        <View
          style={{
            position: 'absolute',
            top: insets.top + 8,
            left: 22,
            zIndex: 50,
          }}>
          <Minimap
            floating={false}
            urgentCount={urgentCount}
            onPress={() => openConductorSheet('hover')}
          />
        </View>
        <TouchableOpacity
          onPress={() => setShowHelp(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            position: 'absolute',
            top: insets.top + 8,
            right: 22,
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.15)',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          activeOpacity={0.6}>
          <Text style={{ color: '#a8a5a0', fontSize: 12, fontWeight: '500' }}>?</Text>
        </TouchableOpacity>
        <HoverHelpModal
          visible={showHelp || showReveal}
          variant={showReveal ? 'reveal' : 'help'}
          onDismiss={() => {
            if (showReveal) {
              AsyncStorage.setItem('hover_full_revealed', '1').catch(() => {});
              setShowReveal(false);
            }
            setShowHelp(false);
          }}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.topHeader, { top: insets.top + 8, opacity: headerOpacity }]}>
          <Text style={styles.topHeaderText}>
            {viewMode === 'family'
              ? 'Management in Motion'
              : crewFilter
              ? `${crewFilter}'s signals`
              : `${FIRST_NAME}.`}
          </Text>
        </Animated.View>

        {viewMode === 'personal' && Array.isArray(crewList) && crewList.length > 0 ? (
          <Animated.View
            style={[styles.crewFilterRow, { top: insets.top + 56, opacity: headerOpacity }]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.crewFilterContent}>
              <TouchableOpacity
                onPress={() => setCrewFilter(null)}
                style={[
                  styles.crewFilterPill,
                  !crewFilter && styles.crewFilterPillActive,
                ]}
                activeOpacity={0.7}>
                <Text style={[styles.crewFilterPillText, !crewFilter && styles.crewFilterPillTextActive]}>
                  All
                </Text>
              </TouchableOpacity>
              {crewList?.map((m, i) => {
                if (!m || !m.name) return null;
                const initial = m.name.charAt(0).toUpperCase() || '?';
                const hasPhoto = typeof m.photoUrl === 'string' && m.photoUrl.length > 0;
                return (
                  <TouchableOpacity
                    key={`${m.name}-${i}`}
                    onPress={() => setCrewFilter(crewFilter === m.name ? null : m.name)}
                    style={styles.crewFilterMember}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <View
                      style={[
                        styles.crewFilterCircle,
                        { borderColor: crewColor(i) },
                        crewFilter === m.name && styles.crewFilterCircleActive,
                      ]}>
                      {hasPhoto ? (
                        <Image
                          source={{ uri: m.photoUrl as string }}
                          style={styles.crewFilterPhoto}
                          onError={() => { /* swallow — fall through to initials on next render */ }}
                        />
                      ) : (
                        <Text style={styles.crewFilterInitials}>{initial}</Text>
                      )}
                    </View>
                    <Text style={styles.crewFilterName} numberOfLines={1}>
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Animated.View>
        ) : null}

        <TouchableOpacity
          onPress={toggleViewMode}
          activeOpacity={0.7}
          style={[styles.viewToggle, { top: insets.top + 8 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text
            style={[
              styles.viewToggleEmoji,
              { color: viewMode === 'family' ? '#b8960c' : '#5a5855' },
            ]}>
            {viewMode === 'family' ? '👨‍👩‍👧' : '👤'}
          </Text>
        </TouchableOpacity>

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
          freshlyAddedIds={freshlyAddedIds}
          onSignalPress={setSelected}
          crewColorMap={crewColorMap}
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
          freshlyAddedIds={freshlyAddedIds}
          onSignalPress={setSelected}
          crewColorMap={crewColorMap}
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
          freshlyAddedIds={freshlyAddedIds}
          onSignalPress={setSelected}
          crewColorMap={crewColorMap}
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

        <CollapsibleNavBar
          bottomInset={insets.bottom}
          urgentCount={urgentCount}
          opacity={legendOpacity}
          onOpenConductor={() => openConductorSheet('hover')}
        />

        <AddSignalSheet
          visible={showAddSignal}
          userId={userId}
          onClose={() => setShowAddSignal(false)}
          onAdded={handleSignalAdded}
        />

        <Tooltip
          visible={showRingsTip}
          message="Three rings show urgency — inner ring needs your attention today."
          arrow="up"
          top={cy + 90}
          left={cx - 160}
          onDismiss={() => {
            setShowRingsTip(false);
            AsyncStorage.setItem('tutorial_hover_rings', 'done').catch(() => {});
          }}
        />

        <YesterdayModal
          visible={showYesterday}
          userId={userId}
          onClose={() => setShowYesterday(false)}
        />

        {selected && (
          <FinaleSheet
            mode="single"
            visible={!!selected}
            signal={selected}
            resolving={resolving}
            userId={userId}
            onClose={handleClose}
            onRest={handleRest}
            onHold={handleHold}
            onUpdate={handleSignalUpdate}
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

type ThemeColors = { background: string; surface: string; text: string; muted: string };
function makeStyles(theme: ThemeColors, accentColor: string) {
  const BRASS = accentColor;
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  return StyleSheet.create({
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
  crewFilterRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 5,
  },
  crewFilterContent: {
    paddingHorizontal: 18,
    gap: 12,
    alignItems: 'center',
  },
  crewFilterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    height: 32,
    justifyContent: 'center',
    marginRight: 8,
  },
  crewFilterPillActive: {
    borderColor: '#b8960c',
    backgroundColor: 'rgba(184,150,12,0.10)',
  },
  crewFilterPillText: { color: '#5a5855', fontSize: 11, letterSpacing: 0.5 },
  crewFilterPillTextActive: { color: '#b8960c', fontWeight: '600' },
  crewFilterMember: { alignItems: 'center', width: 50 },
  crewFilterCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  crewFilterCircleActive: { borderColor: '#b8960c' },
  crewFilterPhoto: { width: '100%', height: '100%' },
  crewFilterInitials: {
    color: '#b8960c',
    fontSize: 12,
    fontWeight: '600',
  },
  crewFilterName: {
    color: '#5a5855',
    fontSize: 9,
    marginTop: 4,
    textAlign: 'center',
  },
  viewToggle: {
    position: 'absolute',
    right: 16,
    zIndex: 6,
    padding: 4,
  },
  viewToggleEmoji: {
    fontSize: 22,
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
  signalAgedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(184, 150, 12, 0.20)',
    borderWidth: 0,
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
  // Collapsible nav bar (replaces InfiniteLedger). The wrapper is
  // height-animated; styles only set the visual chrome and let the
  // Animated.Value control vertical size.
  collapsibleBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  collapsibleHandleArea: {
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    position: 'relative',
  },
  collapsibleHandle: {
    width: 40,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: theme.muted,
    opacity: 0.5,
  },
  collapsibleBadge: {
    position: 'absolute',
    right: 16,
    top: 8,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  collapsibleOptions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: 8,
    flex: 1,
  },
  collapsibleOption: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    minWidth: 56,
  },
  collapsibleOptionIcon: {
    fontSize: 22,
    marginBottom: 6,
  },
  collapsibleOptionLabel: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  wheelIndicator: {
    // Short vertical tick marking the snap zone — sits across the wheel's
    // emoji/label area only, doesn't extend into the Missed Cues link below.
    // Roughly half the previous full-divider span; reads as a tick rather
    // than a column.
    position: 'absolute',
    top: 22,
    height: 32,
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
  navLabel: {
    color: BRASS,
  },
  wheelDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(240, 237, 232, 0.18)',
  },
  deepLinkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
    gap: 28,
  },
  deepLink: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  missedCuesLinkText: {
    color: '#5a5855',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  });
}
