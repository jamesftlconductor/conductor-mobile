// Opening wordmark reveal — a full-screen dark intro shown on the first open
// of the day. The wordmark fades in over ~1s, holds for 3s, then the whole
// screen fades away to reveal Ground. Gated by the caller on a stored
// per-day flag so it doesn't fire on every launch.

import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet } from 'react-native';

import { useTheme } from '@/app/theme';

const REVEAL_BG = '#0f0f0f';

export function WordmarkReveal({ onDone }: { onDone: () => void }) {
  const { logoColor } = useTheme();
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.sequence([
      // Fade the wordmark in (1s).
      Animated.timing(wordmarkOpacity, {
        toValue: 1,
        duration: 1000,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      // Hold (3s).
      Animated.delay(3000),
      // Fade the whole reveal out, transitioning smoothly to Ground.
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]);
    anim.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => anim.stop();
    // onDone is stable from the caller; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.fill, { opacity: screenOpacity }]}>
      <Animated.Image
        source={require('../assets/wordmark.png')}
        resizeMode="contain"
        tintColor={logoColor}
        style={[styles.wordmark, { opacity: wordmarkOpacity }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: REVEAL_BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  wordmark: {
    width: 240,
    height: 88,
  },
});
