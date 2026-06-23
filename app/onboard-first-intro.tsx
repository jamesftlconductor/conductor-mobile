// First-use introduction — three swipeable cards shown exactly once,
// after the onboard reveal and before the user lands on Ground. Teaches
// the three core affordances: the morning Brief, the Radar, and Ask the
// Conductor. The "seen" flag lives in AsyncStorage so it never repeats.
//
// The screen self-guards: if the flag is already set (e.g. the user
// somehow navigates back here), it replaces straight to (tabs).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';

export const FIRST_INTRO_KEY = 'conductor:firstIntroductionSeen';

const CARDS = ['brief', 'radar', 'conductor'] as const;

export default function OnboardFirstIntroScreen() {
  const { theme, accentColor } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Guard: if the intro was already seen, skip straight to Ground.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(FIRST_INTRO_KEY);
        if (cancelled) return;
        if (seen === 'true') {
          router.replace('/(tabs)');
          return;
        }
      } catch {
        // best-effort — show the intro
      }
      if (!cancelled) setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function finish() {
    try {
      await AsyncStorage.setItem(FIRST_INTRO_KEY, 'true');
    } catch {
      // best-effort — still proceed
    }
    router.replace('/(tabs)');
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(p);
  }

  function next() {
    if (page >= CARDS.length - 1) {
      finish();
      return;
    }
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });
  }

  // Don't flash the cards before we know whether to skip.
  if (!checked) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  }

  const isLast = page === CARDS.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}>
        <IntroCard
          width={width}
          insetTop={insets.top}
          title="The Brief"
          copy={
            'Every morning at 7am, The Conductor delivers your household brief.\n\nHealth. Weather. Signals. All considered.'
          }
          theme={theme}
          accentColor={accentColor}>
          <SampleBrief theme={theme} accentColor={accentColor} />
        </IntroCard>

        <IntroCard
          width={width}
          insetTop={insets.top}
          title="The Radar"
          copy={
            'Your household in motion. Everything that needs attention, organized by urgency.\n\nTap any signal to act.'
          }
          theme={theme}
          accentColor={accentColor}>
          <RadarVisual accentColor={accentColor} theme={theme} />
        </IntroCard>

        <IntroCard
          width={width}
          insetTop={insets.top}
          title="Ask The Conductor"
          copy={
            'Tap the minimap from any screen to ask anything.\n\nThe Conductor knows your household.'
          }
          theme={theme}
          accentColor={accentColor}>
          <ConductorVisual accentColor={accentColor} theme={theme} />
        </IntroCard>
      </ScrollView>

      <View style={{ paddingHorizontal: 28, paddingBottom: insets.bottom + 28 }}>
        {/* Pagination dots */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 24,
          }}>
          {CARDS.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === page ? 20 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === page ? accentColor : theme.border,
              }}
            />
          ))}
        </View>

        <TouchableOpacity
          onPress={next}
          activeOpacity={0.8}
          style={{
            alignSelf: 'center',
            paddingHorizontal: 32,
            paddingVertical: 14,
            minHeight: 48,
            justifyContent: 'center',
            borderRadius: 26,
            backgroundColor: isLast ? accentColor : 'transparent',
            borderWidth: isLast ? 0 : 1,
            borderColor: theme.border,
          }}>
          <Text
            style={{
              ...TOKENS.type.body,
              fontWeight: '600',
              letterSpacing: 0.4,
              color: isLast ? '#0f0f0f' : theme.text,
            }}>
            {isLast ? 'Get started →' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  inputBackground: string;
};

function IntroCard({
  width,
  insetTop,
  title,
  copy,
  theme,
  accentColor,
  children,
}: {
  width: number;
  insetTop: number;
  title: string;
  copy: string;
  theme: ThemeColors;
  accentColor: string;
  children: React.ReactNode;
}) {
  void accentColor;
  return (
    <View style={{ width, paddingHorizontal: 28, paddingTop: insetTop + 64 }}>
      <View
        style={{
          height: 220,
          borderRadius: TOKENS.card.borderRadius,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          marginBottom: 36,
        }}>
        {children}
      </View>
      <Text
        style={{
          color: theme.text,
          fontSize: 26,
          fontWeight: '300',
          letterSpacing: 0.3,
          marginBottom: 16,
        }}>
        {title}
      </Text>
      <Text style={{ color: theme.muted, fontSize: 16, fontWeight: '300', lineHeight: 24 }}>
        {copy}
      </Text>
    </View>
  );
}

// Card 1 visual — a miniature morning brief with one tappable signal.
function SampleBrief({ theme, accentColor }: { theme: ThemeColors; accentColor: string }) {
  return (
    <View style={{ width: '82%' }}>
      <Text style={{ color: theme.muted, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>
        TUESDAY · 7:00 AM
      </Text>
      <Text style={{ color: theme.text, fontSize: 13, lineHeight: 20, fontWeight: '300' }}>
        Good morning. Calm day ahead — light rain clearing by noon. Maya's{' '}
        <Text style={{ color: accentColor, textDecorationLine: 'underline' }}>
          dentist appointment
        </Text>{' '}
        is at 3pm, and your car insurance renews Friday.
      </Text>
    </View>
  );
}

// Card 2 visual — concentric rings with a couple of pulsing accent dots.
function RadarVisual({ accentColor, theme }: { accentColor: string; theme: ThemeColors }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const ringSizes = [160, 110, 60];

  return (
    <View style={{ width: 160, height: 160, alignItems: 'center', justifyContent: 'center' }}>
      {ringSizes.map((sz) => (
        <View
          key={sz}
          style={{
            position: 'absolute',
            width: sz,
            height: sz,
            borderRadius: sz / 2,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        />
      ))}
      <Text style={{ color: accentColor, fontSize: 14, fontWeight: '600' }}>C</Text>
      {/* Two signal dots on the rings */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 20,
          right: 36,
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: accentColor + '40',
          borderWidth: 1,
          borderColor: accentColor,
          transform: [{ scale }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          bottom: 34,
          left: 40,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: accentColor + '40',
          borderWidth: 1,
          borderColor: accentColor,
          transform: [{ scale }],
        }}
      />
    </View>
  );
}

// Card 3 visual — the minimap C, with a sheet rising from the bottom.
function ConductorVisual({ accentColor, theme }: { accentColor: string; theme: ThemeColors }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(400),
        Animated.timing(rise, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(900),
        Animated.timing(rise, {
          toValue: 0,
          duration: 500,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [rise]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [90, 0] });
  const sheetOpacity = rise.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.6, 1] });

  return (
    <View style={{ width: 180, height: 180, alignItems: 'center' }}>
      {/* Minimap C, top-right */}
      <View
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 36,
          height: 36,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: accentColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text style={{ color: accentColor, fontSize: 15, fontWeight: '600' }}>C</Text>
      </View>
      {/* Rising sheet */}
      <Animated.View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 12,
          right: 12,
          height: 96,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          backgroundColor: theme.background,
          borderWidth: 1,
          borderColor: theme.border,
          paddingHorizontal: 14,
          paddingTop: 14,
          opacity: sheetOpacity,
          transform: [{ translateY }],
        }}>
        <View
          style={{
            alignSelf: 'center',
            width: 34,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.border,
            marginBottom: 12,
          }}
        />
        <View
          style={{
            height: 32,
            borderRadius: 16,
            backgroundColor: theme.inputBackground,
            borderWidth: 1,
            borderColor: theme.border,
            justifyContent: 'center',
            paddingHorizontal: 14,
          }}>
          <Text style={{ color: theme.muted, fontSize: 13 }}>Ask anything…</Text>
        </View>
      </Animated.View>
    </View>
  );
}
