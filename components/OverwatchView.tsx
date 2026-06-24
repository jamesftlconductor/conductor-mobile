import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';

const BG = '#070707';
const MUTED = '#5a5855';
const SUBTLE = 'rgba(240, 237, 232, 0.18)';

const PHRASES = [
  'Running a sweep of incoming signals.',
  'Watching for anything that needs your attention.',
  'Checking for changes since your last brief.',
  'Quiet tonight. Nothing urgent.',
  'Monitoring your household signals.',
  "Preparing for tomorrow's Takeoff.",
  'All signals accounted for.',
  'The pipeline is running.',
];

// Brand C mark, breathing. Replaces the old rotating radar rings as the
// Overwatch centerpiece — a slow, calm pulse (opacity + slight scale) suited
// to the overnight idle screen. c-mark.png is the gold C with its navy field
// keyed to transparency, so it floats cleanly on the dark background.
function PulsingLogo({ size }: { size: number }) {
  const { logoColor } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });

  return (
    <Animated.Image
      source={require('../assets/c-mark.png')}
      resizeMode="contain"
      style={{
        width: size,
        height: size,
        opacity,
        tintColor: logoColor,
        transform: [{ scale }],
      }}
    />
  );
}

export default function OverwatchView({ onYesterday }: { onYesterday: () => void }) {
  // Same en-US "Thursday, May 14" shape Ground uses for its header date.
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Phrase cycle: 8s for visible phrases (1s fade-in / 6s hold / 1s fade-out),
  // 10s of pure silence on every third cycle. Silence is part of the voice;
  // not every tick deserves a sentence.
  const [phraseIndex, setPhraseIndex] = useState(0);
  const phraseFade = useRef(new Animated.Value(0)).current;
  const cycleCountRef = useRef(0);

  useEffect(() => {
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let activeAnim: Animated.CompositeAnimation | null = null;

    function tick() {
      if (stopped) return;
      cycleCountRef.current += 1;
      const isSilence = cycleCountRef.current % 3 === 0;

      if (isSilence) {
        // Make sure no phrase is showing during silence.
        Animated.timing(phraseFade, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }).start();
        timeoutId = setTimeout(tick, 10000);
        return;
      }

      // Advance to the next phrase, fade in, hold, fade out, then loop.
      setPhraseIndex((prev) => (prev + 1) % PHRASES.length);
      activeAnim = Animated.sequence([
        Animated.timing(phraseFade, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(6000),
        Animated.timing(phraseFade, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]);
      activeAnim.start(({ finished }) => {
        if (finished && !stopped) tick();
      });
    }

    tick();

    return () => {
      stopped = true;
      activeAnim?.stop();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [phraseFade]);

  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <PulsingLogo size={184} />
        <Text style={styles.dateLine}>{dateLabel}</Text>
        <Animated.Text style={[styles.phrase, { opacity: phraseFade }]} numberOfLines={2}>
          {PHRASES[phraseIndex]}
        </Animated.Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerLine}>
          Sweeps run automatically. Your next Takeoff is at 7am.
        </Text>
        <TouchableOpacity onPress={onYesterday} activeOpacity={0.6} style={styles.yesterdayLink}>
          <Text style={styles.yesterdayLinkText}>Yesterday&apos;s Programme →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateLine: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.3,
    textAlign: 'center',
    marginTop: 24,
  },
  phrase: {
    color: SUBTLE,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 64,
    paddingHorizontal: 16,
    letterSpacing: 0.3,
    minHeight: 44,
  },
  footer: {
    paddingBottom: 60,
    alignItems: 'center',
  },
  footerLine: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 12,
  },
  yesterdayLink: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  yesterdayLinkText: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
