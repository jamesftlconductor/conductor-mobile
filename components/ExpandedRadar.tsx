// Full-screen expanded radar — Step 4A (expansion animation + visual only).
//
// Tapping the Ground minimap expands this overlay from the minimap's top-right
// position to fill the screen (Animated.spring, top-right origin). It shows the
// live household radar at full size: jet-black backdrop, a breathing accent
// vapor glow, the three rotating rings (same colors/opacities as the minimap,
// scaled to the screen), live signal dots, and a gently pulsing center C mark.
//
// 4A has NO interaction beyond close: tap anywhere outside the rings contracts
// back. Center-tap-to-chat (4B) and directional navigation (4C) come later.

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useTheme } from '@/app/theme';
import { useUserId } from '@/hooks/useUserId';
import {
  angleDegForSignal,
  colorFor,
  groupSignalsForRadar,
  type RingKey,
  type Signal,
} from '@/components/Minimap';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Ring radii as a fraction of screen width (per spec).
const RADII: Record<RingKey, number> = {
  outer: SCREEN_W * 0.425,
  middle: SCREEN_W * 0.3,
  inner: SCREEN_W * 0.18,
};

// Same stroke opacities + rotation/pulse cadence as the minimap rings.
const RING_META: Record<RingKey, { strokeOpacity: number; rotationMs: number; pulseMs: number }> = {
  outer: { strokeOpacity: 0.7, rotationMs: 60000, pulseMs: 2500 },
  middle: { strokeOpacity: 0.8, rotationMs: 30000, pulseMs: 1500 },
  inner: { strokeOpacity: 1.0, rotationMs: 15000, pulseMs: 600 },
};

// The minimap's floating disc sits at roughly top:60 / right:20, 72px wide.
// The expansion originates from that top-right corner.
const START_SIZE = 72;
const START_SCALE = START_SIZE / SCREEN_W;
// Translate that keeps the top-right corner fixed while the full-screen content
// scales up from START_SCALE → 1 (RN scales around the view center).
const START_TX = ((1 - START_SCALE) * SCREEN_W) / 2;
const START_TY = (-(1 - START_SCALE) * SCREEN_H) / 2;

function ExpDot({ x, y, color, pulseMs }: { x: number; y: number; color: string; pulseMs: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const half = pulseMs / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.4, duration: half, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: half, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, pulseMs]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - 6,
        top: y - 6,
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: color,
        transform: [{ scale }],
      }}
    />
  );
}

function ExpandedRing({
  ringKey,
  strokeColor,
  signals,
}: {
  ringKey: RingKey;
  strokeColor: string;
  signals: Signal[];
}) {
  const meta = RING_META[ringKey];
  const radius = RADII[ringKey];
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: meta.rotationMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotation, meta.rotationMs]);

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const cx = SCREEN_W / 2;
  const cy = SCREEN_H / 2;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ rotate: spin }] }]}>
      <Svg width={SCREEN_W} height={SCREEN_H}>
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={strokeColor}
          strokeOpacity={meta.strokeOpacity}
          strokeWidth={2.5}
          fill="none"
        />
      </Svg>
      {signals.map((s) => {
        const angle = (angleDegForSignal(s.id) * Math.PI) / 180;
        const x = cx + radius * Math.cos(angle - Math.PI / 2);
        const y = cy + radius * Math.sin(angle - Math.PI / 2);
        return <ExpDot key={String(s.id)} x={x} y={y} color={colorFor(s)} pulseMs={meta.pulseMs} />;
      })}
    </Animated.View>
  );
}

export function ExpandedRadar({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme, accentColor, isDark } = useTheme();
  const userId = useUserId();
  const [grouped, setGrouped] = useState<Record<RingKey, Signal[]>>({ inner: [], middle: [], outer: [] });

  const progress = useRef(new Animated.Value(0)).current;
  const vaporAnim = useRef(new Animated.Value(0.5)).current;
  const cPulse = useRef(new Animated.Value(1)).current;

  // Load the live signals (same source + filter as the minimap) and group them
  // with the shared radar grouping so the dots match.
  useEffect(() => {
    if (!visible || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?userId=${userId}`);
        const data = await res.json();
        const active: Signal[] = (data.signals || []).filter(
          (s: Signal) => !s.state || s.state === 'incoming' || s.state === 'active',
        );
        if (!cancelled) setGrouped(groupSignalsForRadar(active, 'family', userId));
      } catch {
        // silent — rings still render without dots
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, userId]);

  // Expansion spring (top-right origin) on open.
  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      tension: 40,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [visible, progress]);

  // Vapor breathing 0.5 → 1.0 → 0.5 over a 4s cycle, independent of everything.
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(vaporAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(vaporAnim, { toValue: 0.5, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, vaporAnim]);

  // Center C gentle pulse.
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cPulse, { toValue: 1.08, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(cPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, cPulse]);

  function close() {
    Animated.timing(progress, {
      toValue: 0,
      duration: 350,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  }

  if (!visible) return null;

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [START_SCALE, 1] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [START_TX, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [START_TY, 0] });

  const outerColor = isDark ? '#f0ede8' : theme.text;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.content, { transform: [{ translateX }, { translateY }, { scale }] }]}>
        {/* Jet-black backdrop */}
        <View style={styles.black} />

        {/* Breathing accent vapor glow */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: vaporAnim }]}>
          <Svg width={SCREEN_W} height={SCREEN_H}>
            <Defs>
              <RadialGradient id="expandedVapor" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={accentColor} stopOpacity={0.35} />
                <Stop offset="1" stopColor={accentColor} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={SCREEN_W / 2} cy={SCREEN_H / 2} r={SCREEN_W * 0.55} fill="url(#expandedVapor)" />
          </Svg>
        </Animated.View>

        {/* Tap outside the rings → contract. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />

        {/* Central radar region absorbs taps so the rings/center don't close. */}
        <View style={styles.centerRegion} pointerEvents="box-none">
          <Pressable style={styles.centerHit} onPress={() => { /* 4B: open chat */ }} />
        </View>

        {/* Rings (rotating) */}
        <ExpandedRing ringKey="outer" strokeColor={outerColor} signals={grouped.outer} />
        <ExpandedRing ringKey="middle" strokeColor={outerColor} signals={grouped.middle} />
        <ExpandedRing ringKey="inner" strokeColor={accentColor} signals={grouped.inner} />

        {/* Center C mark, gently pulsing */}
        <View style={styles.centerWrap} pointerEvents="none">
          <Animated.Image
            source={require('../assets/icon.png')}
            resizeMode="contain"
            style={[styles.cMark, { tintColor: accentColor, transform: [{ scale: cPulse }] }]}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const RADAR_BOX = RADII.outer * 2;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
  },
  content: {
    ...StyleSheet.absoluteFillObject,
  },
  black: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  // Centered square the size of the outer ring — blocks close-taps over the radar.
  centerRegion: {
    position: 'absolute',
    left: SCREEN_W / 2 - RADAR_BOX / 2,
    top: SCREEN_H / 2 - RADAR_BOX / 2,
    width: RADAR_BOX,
    height: RADAR_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerHit: {
    ...StyleSheet.absoluteFillObject,
  },
  centerWrap: {
    position: 'absolute',
    left: SCREEN_W / 2 - 24,
    top: SCREEN_H / 2 - 24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cMark: {
    width: 48,
    height: 48,
  },
});
