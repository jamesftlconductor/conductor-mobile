// Brand loading screen — the wordmark centered on the screen background with
// a rotating, fading catchphrase beneath it. Replaces the generic spinner for
// the more deliberate, on-brand waits (e.g. generating the morning brief).
//
// Pass context="network" to lock the network-specific line; otherwise the
// general lines rotate every few seconds. The wordmark carries the user's
// chosen logoColor, matching the rest of the brand surface.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/app/theme';

const GENERAL_PHRASES = [
  "It's safe to look away.",
  'Everything considered.',
  'Always watching. Never intruding.',
];
const NETWORK_PHRASE = 'Same baton, different orchestra.';
const ROTATE_MS = 2800;

export function WordmarkLoader({ context }: { context?: 'network' | string }) {
  const { theme, logoColor } = useTheme();
  const phrases = useMemo(
    () => (context === 'network' ? [NETWORK_PHRASE] : GENERAL_PHRASES),
    [context],
  );
  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    setIdx(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
    if (phrases.length <= 1) return;
    const interval = setInterval(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 400,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || cancelled) return;
        setIdx((n) => (n + 1) % phrases.length);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    }, ROTATE_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [opacity, phrases]);

  return (
    <View style={[styles.wrap, { backgroundColor: theme.background }]}>
      <Image
        source={require('../assets/wordmark.png')}
        resizeMode="contain"
        tintColor={logoColor}
        style={styles.wordmark}
      />
      <Animated.Text style={[styles.phrase, { color: theme.muted, opacity }]}>
        {phrases[idx]}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  wordmark: {
    width: 200,
    height: 73,
  },
  phrase: {
    marginTop: 18,
    fontSize: 14,
    letterSpacing: 0.3,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
