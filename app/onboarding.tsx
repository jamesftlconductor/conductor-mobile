import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const PHRASES = [
  'Reading the shape of your year.',
  "Finding what's already in motion.",
  'Learning what your weeks look like.',
  'Noting what renews and what expires.',
  'Watching for what tends to slip through.',
  'Getting acquainted with your household.',
  'Connecting the signals around you.',
  'Almost ready to think alongside you.',
];

const TRUST =
  'We read your emails to understand your household. We store what we learn — not the emails themselves.';

type Step = { kind: 'phrase'; text: string } | { kind: 'trust'; text: string };

// After phrase 4 and before phrase 5, the trust statement gets its own cycle.
const SEQUENCE: Step[] = [
  { kind: 'phrase', text: PHRASES[0] },
  { kind: 'phrase', text: PHRASES[1] },
  { kind: 'phrase', text: PHRASES[2] },
  { kind: 'phrase', text: PHRASES[3] },
  { kind: 'trust',  text: TRUST },
  { kind: 'phrase', text: PHRASES[4] },
  { kind: 'phrase', text: PHRASES[5] },
  { kind: 'phrase', text: PHRASES[6] },
  { kind: 'phrase', text: PHRASES[7] },
];

const FADE_MS = 500;
const HOLD_MS = 3500;
const STEP_MS = FADE_MS + HOLD_MS; // 4000ms before fade-out begins
const READY_HOLD_MS = 2000;

export default function OnboardingScreen() {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;

  // Slow logo pulse, 2.5s cycle.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, {
          toValue: 1.08,
          duration: 1250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1.0,
          duration: 1250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [logoScale]);

  // Phrase cycle: fade in (500ms), hold (3500ms), fade out (500ms), advance.
  useEffect(() => {
    if (done) return;
    let cancelled = false;

    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();

    const fadeOutTimer = setTimeout(() => {
      if (cancelled) return;
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (cancelled || !finished) return;
        if (index < SEQUENCE.length - 1) {
          setIndex((i) => i + 1);
        } else {
          setDone(true);
        }
      });
    }, STEP_MS);

    return () => {
      cancelled = true;
      clearTimeout(fadeOutTimer);
    };
  }, [index, done, opacity]);

  // Final state: fade in "Conductor is ready.", hold 2s, navigate.
  useEffect(() => {
    if (!done) return;
    let cancelled = false;

    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();

    const navTimer = setTimeout(() => {
      if (!cancelled) router.replace('/onboard-reveal' as never);
    }, FADE_MS + READY_HOLD_MS);

    return () => {
      cancelled = true;
      clearTimeout(navTimer);
    };
  }, [done, opacity]);

  const current = SEQUENCE[index];
  const textStyle = done
    ? styles.readyText
    : current.kind === 'trust'
    ? styles.trustText
    : styles.phraseText;
  const text = done ? 'Conductor is ready.' : current.text;

  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Animated.View
          style={[styles.logo, { transform: [{ scale: logoScale }] }]}>
          <Text style={styles.logoMark}>C</Text>
        </Animated.View>

        <View style={styles.textArea}>
          <Animated.Text style={[textStyle, { opacity }]}>{text}</Animated.Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#f0ede8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 48,
  },
  logoMark: {
    color: '#0f0f0f',
    fontSize: 32,
    fontWeight: '700',
  },
  textArea: {
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phraseText: {
    color: '#f0ede8',
    fontSize: 17,
    fontWeight: '300',
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: 26,
    maxWidth: 280,
  },
  trustText: {
    color: '#5a5855',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.2,
    maxWidth: 280,
  },
  readyText: {
    color: '#f0ede8',
    fontSize: 20,
    fontWeight: '300',
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: 28,
  },
});
