// Standard loading skeleton — muted rectangle with fade-in on mount
// then a gentle opacity pulse. One file used across every screen's
// loading state so the muted-rectangle treatment is uniform.

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';

export function SkeletonRow({
  height = 48,
  width = '100%',
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: object;
}) {
  const { theme } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in on mount, then loop a gentle pulse around the token
    // opacity so the skeleton reads as "in motion, waiting".
    Animated.timing(opacity, {
      toValue: TOKENS.skeletonOpacity,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: TOKENS.skeletonOpacity * 1.6, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: TOKENS.skeletonOpacity, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          height,
          width: width as any,
          borderRadius: 8,
          backgroundColor: theme.text,
          opacity,
          marginBottom: TOKENS.space.item,
        },
        style,
      ]}
    />
  );
}

export function SkeletonStack({ rows = 4 }: { rows?: number }) {
  return (
    <View style={styles.stack}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} height={48} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    padding: TOKENS.space.pad,
  },
});
