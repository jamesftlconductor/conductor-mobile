// The Chord — five C marks (the four Movements + The Conductor) that appear on
// every screen as the connective visual thread. Each surface configures it for
// its context (size, per-mark state, tap behaviour); the marks themselves are
// always the same five in the same order/colors.

import { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { router } from 'expo-router';

import { useTheme } from '@/app/theme';
import { MOVEMENTS, MovementKey } from '@/utils/movements';

const C_MARK = require('../assets/c-mark.png');

export type ChordKey = MovementKey | 'conductor';

export type MarkState = {
  /** Reduced presence — movement healthy-but-quiet / needs attention. */
  dim?: boolean;
  /** Pulse — movement has urgent signals. */
  urgent?: boolean;
  /** Outline-only feel (seeking data / not configured) — rendered faint. */
  outlined?: boolean;
};

const ORDER: { key: ChordKey; route: string }[] = [
  ...MOVEMENTS.map((m) => ({ key: m.key as ChordKey, route: m.route })),
  { key: 'conductor', route: '/(tabs)/hover' },
];

function colorFor(key: ChordKey, accentColor: string): string {
  if (key === 'conductor') return accentColor;
  return MOVEMENTS.find((m) => m.key === key)?.color ?? accentColor;
}

function Mark({
  color,
  size,
  state,
  active,
  onPress,
}: {
  color: string;
  size: number;
  state?: MarkState;
  active?: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!state?.urgent) {
      scale.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.3, duration: 600, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state?.urgent, scale]);

  const opacity = state?.outlined ? 0.3 : state?.dim ? 0.4 : 1;
  const markSize = active ? Math.round(size * 1.4) : size;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Image
          source={C_MARK}
          resizeMode="contain"
          style={{ width: markSize, height: markSize, tintColor: color, opacity }}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

export function ChordIndicator({
  size = 14,
  active,
  states,
  onPress,
  style,
  gap = 6,
}: {
  size?: number;
  /** Movement-screen context: this mark is enlarged + others dimmed. */
  active?: MovementKey;
  /** Per-mark overrides (dim / urgent / outlined). */
  states?: Partial<Record<ChordKey, MarkState>>;
  /** Override tap behaviour. Default: navigate to the mark's route. */
  onPress?: (key: ChordKey) => void;
  style?: StyleProp<ViewStyle>;
  gap?: number;
}) {
  const { accentColor } = useTheme();
  return (
    <View style={[styles.row, { gap }, style]}>
      {ORDER.map(({ key, route }) => {
        const isActive = active === key;
        // In movement context, the non-active marks recede.
        const base: MarkState | undefined = active && !isActive ? { dim: true } : undefined;
        return (
          <Mark
            key={key}
            color={colorFor(key, accentColor)}
            size={size}
            active={isActive}
            state={{ ...base, ...states?.[key] }}
            onPress={() => (onPress ? onPress(key) : router.push(route as never))}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
