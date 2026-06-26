// Weather-reactive background. Renders a full-screen photo for the current
// weather condition with gentle, condition-specific motion overlaid on top.
// Ground uses it animated at full opacity (replacing the old Lottie); Settings
// uses it static at 0.15 opacity as a subtle backdrop. Conditions crossfade
// over 1.5s. The image itself stays still apart from a slow zoom/drift — all
// the "weather" is in the overlays (rain, lightning, twinkle, pulses, sweep).

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  ImageBackground,
  ImageSourcePropType,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

export type WeatherKind =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy'
  | 'overcast'
  | 'heavy-rain'
  | 'hazy-morning'
  | 'sunset'
  | 'hurricane'
  | 'thunderstorm'
  | 'clearing';

const ASSETS: Record<WeatherKind, ImageSourcePropType> = {
  'clear-day': require('../assets/weather/clear-day.jpg'),
  'clear-night': require('../assets/weather/clear-night.jpg'),
  'partly-cloudy': require('../assets/weather/partly-cloudy.jpg'),
  overcast: require('../assets/weather/overcast.jpg'),
  'heavy-rain': require('../assets/weather/heavy-rain.jpg'),
  'hazy-morning': require('../assets/weather/hazy-morning.jpg'),
  sunset: require('../assets/weather/sunset.jpg'),
  hurricane: require('../assets/weather/hurricane.jpg'),
  thunderstorm: require('../assets/weather/thunderstorm.jpg'),
  clearing: require('../assets/weather/clearing.jpg'),
};

// Condition → image kind. Matching order mirrors the spec exactly.
export function resolveWeatherKind(condition?: string | null, hour: number = new Date().getHours()): WeatherKind {
  const c = (condition || '').toLowerCase();
  const isNight = hour < 6 || hour >= 20;
  if (isNight && (c.includes('clear') || c.includes('fair'))) return 'clear-night';
  if (c.includes('thunder') || c.includes('storm')) return 'thunderstorm';
  if (c.includes('hurricane') || c.includes('severe') || c.includes('tornado')) return 'hurricane';
  if (c.includes('heavy rain') || c.includes('downpour')) return 'heavy-rain';
  if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'heavy-rain';
  if (c.includes('fog') || c.includes('haze') || c.includes('mist')) return 'hazy-morning';
  if (c.includes('overcast') || c.includes('cloudy')) return 'overcast';
  if (c.includes('partly') || c.includes('scattered')) return 'partly-cloudy';
  // "Clearing" / "clears" (after-the-storm) — checked before the generic clear
  // branch since "clearing".includes("clear"). At night the clear-night branch
  // above already wins, so this only applies in daylight.
  if (c.includes('clearing') || c.includes('clears')) return 'clearing';
  if (c.includes('clear') || c.includes('sunny') || c.includes('fair')) return 'clear-day';
  if (hour >= 17 && hour < 20) return 'sunset';
  if (hour >= 6 && hour < 9) return 'hazy-morning';
  return 'partly-cloudy';
}

// Exported require() resolver, matching the spec's getWeatherAsset signature.
export function getWeatherAsset(condition?: string | null, hour: number = new Date().getHours()): ImageSourcePropType {
  return ASSETS[resolveWeatherKind(condition, hour)];
}

// ── Slow zoom / drift per kind (rain/storm/hurricane stay perfectly still) ──
const ZOOM: Record<WeatherKind, { scale: number; ms: number; driftX?: number; driftMs?: number } | null> = {
  'clear-day': { scale: 1.04, ms: 25000 },
  'clear-night': { scale: 1.02, ms: 40000 },
  'partly-cloudy': { scale: 1.05, ms: 20000, driftX: 8, driftMs: 30000 },
  overcast: { scale: 1.02, ms: 35000 },
  'hazy-morning': { scale: 1.03, ms: 30000 },
  sunset: { scale: 1.06, ms: 30000 },
  clearing: { scale: 1.05, ms: 20000 },
  'heavy-rain': null,
  thunderstorm: null,
  hurricane: null,
};

function ZoomImage({ kind, animated }: { kind: WeatherKind; animated: boolean }) {
  const z = animated ? ZOOM[kind] : null;
  const scale = useRef(new Animated.Value(1)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!z) {
      scale.setValue(1);
      drift.setValue(0);
      return;
    }
    const zoom = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: z.scale, duration: z.ms / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: z.ms / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    zoom.start();
    let driftLoop: Animated.CompositeAnimation | null = null;
    if (z.driftX) {
      driftLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(drift, { toValue: z.driftX, duration: (z.driftMs ?? 30000) / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(drift, { toValue: 0, duration: (z.driftMs ?? 30000) / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      driftLoop.start();
    }
    return () => {
      zoom.stop();
      driftLoop?.stop();
    };
  }, [kind, animated, z, scale, drift]);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ scale }, { translateX: drift }] }]}>
      <ImageBackground source={ASSETS[kind]} resizeMode="cover" style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

// ── Overlay primitives ──────────────────────────────────────────────────
function ColorPulse({ rgb, from, to, ms }: { rgb: string; from: number; to: number; ms: number }) {
  const op = useRef(new Animated.Value(from)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: to, duration: ms / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(op, { toValue: from, duration: ms / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [op, from, to, ms]);
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: rgb, opacity: op }]} />;
}

// ── Organic rain ────────────────────────────────────────────────────────
// Many individual streaks, each with its own angle, length, opacity, speed and
// column — derived deterministically from the index (fractional parts of
// irrational multipliers) so they spread evenly across the width and stay
// stable across re-renders (no Math.random in render). Each streak falls on its
// own native-driven loop, staggered by an initial delay, and resets off-screen
// above so the loop is seamless.
type Drop = { x: number; len: number; angle: number; opacity: number; ms: number; delay: number };
const frac = (n: number) => n - Math.floor(n);
function makeDrops(count: number, angleMin: number, angleMax: number, msMin: number, msMax: number): Drop[] {
  return Array.from({ length: count }, (_, i) => {
    const r = (k: number) => frac((i + 1) * k);
    return {
      x: Math.round(r(0.61803398875) * (W + 40)) - 20,
      len: Math.round(20 + r(0.7548776662) * 40), // 20–60px
      opacity: 0.04 + r(0.32472334) * 0.1, // 0.04–0.14
      angle: angleMin + r(0.12345678) * (angleMax - angleMin),
      ms: Math.round(msMin + r(0.98765432) * (msMax - msMin)),
      delay: Math.round(r(0.54360287) * msMax),
    };
  });
}
// Heavy rain: 24 streaks, 12–22°, 0.6–1.0s. Thunderstorm: denser + faster.
// Hurricane: most streaks, steeper 25–35°, fastest.
const RAIN_HEAVY = makeDrops(24, 12, 22, 600, 1000);
const RAIN_THUNDER = makeDrops(32, 12, 22, 400, 700);
const RAIN_HURRICANE = makeDrops(40, 25, 35, 300, 500);

function RainDrop({ x, len, angle, opacity, ms, delay }: Drop) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }),
    );
    const start = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(start);
      loop.stop();
    };
  }, [t, ms, delay]);
  // Falls from just above the top to just below the bottom, then the loop
  // resets it off-screen (no visible pop).
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-(len + 20), H + 20] });
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: x, top: 0, transform: [{ translateY }] }}>
      <View style={{ width: 1.2, height: len, borderRadius: 1, backgroundColor: '#ffffff', opacity, transform: [{ rotate: `${angle}deg` }] }} />
    </Animated.View>
  );
}

function Rain({ drops }: { drops: Drop[] }) {
  return (
    <>
      {drops.map((d, i) => (
        <RainDrop key={i} {...d} />
      ))}
    </>
  );
}

function Lightning() {
  const op = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const flash = (cb?: () => void) =>
      Animated.sequence([
        Animated.timing(op, { toValue: 0.3, duration: 60, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) cb?.();
      });
    const schedule = () => {
      const delay = 5000 + Math.random() * 10000;
      timer = setTimeout(() => {
        if (stopped) return;
        flash(() => {
          if (stopped) return;
          // ~40% of the time, a quick second flash for a double-strike feel.
          if (Math.random() < 0.4) {
            timer = setTimeout(() => {
              if (!stopped) flash(schedule);
            }, 150);
          } else {
            schedule();
          }
        });
      }, delay);
    };
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      op.stopAnimation();
    };
  }, [op]);
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgb(200,220,255)', opacity: op }]} />;
}

const STAR_POSITIONS: { left: `${number}%`; top: `${number}%` }[] = [
  { left: '20%', top: '10%' },
  { left: '54%', top: '7%' },
  { left: '72%', top: '16%' },
  { left: '38%', top: '21%' },
];
function Star({ pos, index }: { pos: { left: `${number}%`; top: `${number}%` }; index: number }) {
  const op = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    // Independent 2–4s cycles so the four stars twinkle out of phase.
    const dur = 2000 + Math.random() * 2000;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.9, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(op, { toValue: 0.4, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [op, index]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: pos.left, top: pos.top, width: 2, height: 2, borderRadius: 1, backgroundColor: '#ffffff', opacity: op }}
    />
  );
}
function StarTwinkle() {
  return (
    <>
      {STAR_POSITIONS.map((p, i) => (
        <Star key={i} pos={p} index={i} />
      ))}
    </>
  );
}

// Faint Archimedean spiral for the hurricane swirl.
const SPIRAL_PATH = (() => {
  let d = '';
  const turns = 4;
  const steps = 240;
  const cx = 50;
  const cy = 50;
  const maxR = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * 2 * Math.PI;
    const r = t * maxR;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d;
})();
function Spiral() {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(rot, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [rot]);
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const s = Math.max(W, H);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity: 0.06, transform: [{ rotate: spin }] }]}>
      <Svg width={s} height={s} viewBox="0 0 100 100">
        <Path d={SPIRAL_PATH} stroke="#ffffff" strokeWidth={0.6} fill="none" />
      </Svg>
    </Animated.View>
  );
}

// Brightening sweep — a soft white band drifting left→right.
function BrighteningSweep() {
  const tx = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(tx, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [tx]);
  const bandW = W * 0.6;
  const translateX = tx.interpolate({ inputRange: [0, 1], outputRange: [-bandW, W] });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
      <Svg width={bandW} height={H}>
        <Defs>
          <LinearGradient id="weatherSweep" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.06} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width={bandW} height={H} fill="url(#weatherSweep)" />
      </Svg>
    </Animated.View>
  );
}

function WeatherOverlays({ kind }: { kind: WeatherKind }) {
  switch (kind) {
    case 'clear-day':
      return <ColorPulse rgb="rgb(255,220,100)" from={0.04} to={0.08} ms={8000} />;
    case 'clear-night':
      return <StarTwinkle />;
    case 'overcast':
      return <ColorPulse rgb="rgb(100,100,120)" from={0.03} to={0.06} ms={12000} />;
    case 'hazy-morning':
      return <ColorPulse rgb="rgb(255,200,100)" from={0.05} to={0.1} ms={10000} />;
    case 'sunset':
      return <ColorPulse rgb="rgb(255,160,50)" from={0.04} to={0.1} ms={6000} />;
    case 'heavy-rain':
      return <Rain drops={RAIN_HEAVY} />;
    case 'thunderstorm':
      return (
        <>
          <Rain drops={RAIN_THUNDER} />
          <Lightning />
        </>
      );
    case 'hurricane':
      return (
        <>
          <Rain drops={RAIN_HURRICANE} />
          <ColorPulse rgb="rgb(0,0,0)" from={0} to={0.15} ms={3000} />
          <Spiral />
        </>
      );
    case 'clearing':
      return <BrighteningSweep />;
    case 'partly-cloudy':
    default:
      return null;
  }
}

type Props = {
  condition?: string | null;
  hour?: number;
  animated?: boolean;
  opacity?: number;
  style?: ViewStyle;
};

export function WeatherBackground({ condition, hour, animated = false, opacity = 1, style }: Props) {
  const resolvedHour = hour ?? new Date().getHours();

  // When no condition is passed (Settings), self-resolve from the last value
  // Ground cached so the two screens stay in sync without a second data source.
  const [storedCondition, setStoredCondition] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (condition !== undefined && condition !== null) return;
    let cancelled = false;
    AsyncStorage.getItem('lastWeatherCondition')
      .then((v) => {
        if (!cancelled && v) setStoredCondition(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [condition]);

  const effectiveCondition = condition !== undefined && condition !== null ? condition : storedCondition;
  const kind = resolveWeatherKind(effectiveCondition, resolvedHour);

  // Crossfade: the previous kind sits behind, the current kind fades in over
  // 1.5s. renderedRef avoids a stale closure when the kind changes.
  const [renderedKind, setRenderedKind] = useState<WeatherKind>(kind);
  const [prevKind, setPrevKind] = useState<WeatherKind | null>(null);
  const renderedRef = useRef<WeatherKind>(kind);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (kind === renderedRef.current) return;
    setPrevKind(renderedRef.current);
    renderedRef.current = kind;
    setRenderedKind(kind);
    fade.setValue(0);
    const anim = Animated.timing(fade, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true });
    anim.start(({ finished }) => {
      if (finished) setPrevKind(null);
    });
    return () => anim.stop();
  }, [kind, fade]);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }, style]}>
      {/* Outgoing layer (during a crossfade only). */}
      {prevKind ? <ImageBackground source={ASSETS[prevKind]} resizeMode="cover" style={StyleSheet.absoluteFill} /> : null}
      {/* Current layer — fades in, with its slow zoom/drift. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <ZoomImage kind={renderedKind} animated={animated} />
      </Animated.View>
      {/* Motion overlays for the current kind. Keyed so they remount cleanly
          when the condition changes. */}
      {animated ? (
        <View key={renderedKind} style={StyleSheet.absoluteFill} pointerEvents="none">
          <WeatherOverlays kind={renderedKind} />
        </View>
      ) : null}
    </View>
  );
}
