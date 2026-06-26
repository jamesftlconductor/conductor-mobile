// Opening splash — shown on the first open of the day (gated by the caller).
//
// Sequence on a full jet-black screen:
//   1. Wordmark fades in over 1s, tinted to the chosen logoColor (brass).
//   2. Holds 3s at full opacity.
//   3. A rotating catchphrase fades in underneath.
//   4. Catchphrase holds 1.5s.
//   5. The whole screen fades out, transitioning smoothly to Ground.

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTheme } from '@/app/theme';

const PHRASES = [
  "It's safe to look away.",
  'Everything considered.',
  'Always watching. Never intruding.',
];

const PHRASE_IDX_KEY = 'splashPhraseIdx';

export function WordmarkReveal({ onDone }: { onDone: () => void }) {
  const { logoColor } = useTheme();
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const phraseOpacity = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const [phrase, setPhrase] = useState(PHRASES[0]);

  // Rotate the catchphrase across launches via a persisted index.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PHRASE_IDX_KEY);
        const idx = ((parseInt(raw || '0', 10) || 0) % PHRASES.length + PHRASES.length) % PHRASES.length;
        setPhrase(PHRASES[idx]);
        AsyncStorage.setItem(PHRASE_IDX_KEY, String((idx + 1) % PHRASES.length)).catch(() => {});
      } catch { /* keep default phrase */ }
    })();
  }, []);

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.timing(wordmarkOpacity, {
        toValue: 1,
        duration: 1000,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.delay(3000),
      Animated.timing(phraseOpacity, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.delay(1500),
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 600,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]);
    anim.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => anim.stop();
    // onDone is stable; run the sequence once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View pointerEvents="none" style={[styles.fill, { opacity: screenOpacity }]}>
      <Animated.Image
        source={require('../assets/wordmark.png')}
        resizeMode="contain"
        tintColor={logoColor}
        style={[styles.wordmark, { opacity: wordmarkOpacity }]}
      />
      <Animated.Text style={[styles.phrase, { opacity: phraseOpacity }]}>{phrase}</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  wordmark: {
    width: 250,
    height: 92,
  },
  phrase: {
    marginTop: 26,
    color: '#f0ede8',
    fontSize: 14,
    letterSpacing: 0.4,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
