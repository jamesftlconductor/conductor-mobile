// Weekly Symphony — visualizes the household's seven daily achievements
// as a row of instruments. Each day either earned (full color, faint
// glow) or unearned (muted outline). The "Hear your week" affordance
// renders on Sunday only; tapping triggers the parent's onPlay
// callback. Audio playback itself is deferred — expo-av isn't in the
// install yet — so the button surfaces a placeholder toast on tap.
//
// Layout: horizontal row of 7 slots, evenly distributed. Each slot is
// a stacked instrument glyph + day label.

import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';

export type WeeklyAchievements = {
  instruments: {
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
    sunday: boolean;
  };
  instrumentsEarned: number;
  symphonyVariation: 'full' | 'major' | 'moderate' | 'sparse' | 'minimal';
  symphonyKey: 'major' | 'minor';
  soundSequence: string[];
  weekStart?: string;
};

const DAYS: { key: keyof WeeklyAchievements['instruments']; emoji: string; label: string }[] = [
  { key: 'monday',    emoji: '🥁', label: 'Mon' },
  { key: 'tuesday',   emoji: '🎸', label: 'Tue' },
  { key: 'wednesday', emoji: '🎹', label: 'Wed' },
  { key: 'thursday',  emoji: '🪕', label: 'Thu' },
  { key: 'friday',    emoji: '🎻', label: 'Fri' },
  { key: 'saturday',  emoji: '🎺', label: 'Sat' },
  { key: 'sunday',    emoji: '🎤', label: 'Sun' },
];

export function WeeklySymphony({
  achievements,
  onPlay,
  playing = false,
  isSunday = false,
}: {
  achievements: WeeklyAchievements;
  onPlay?: () => void;
  playing?: boolean;
  isSunday?: boolean;
}) {
  const { theme, accentColor } = useTheme();

  // Sunday pulse — the sunday voice slot gently pulses when it's
  // actually Sunday today. Drops to a single opacity hold the rest
  // of the week so the row reads as a static record.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isSunday) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.5, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isSunday, pulse]);

  return (
    <View style={{ marginVertical: 18 }}>
      <Text
        style={{
          color: theme.muted,
          fontSize: 9,
          letterSpacing: 2,
          fontWeight: '600',
          marginBottom: 10,
        }}>
        {isSunday ? "THIS WEEK'S SYMPHONY" : 'BUILDING THIS WEEK'}
      </Text>
      <View style={styles.row}>
        {DAYS.map((d) => {
          const earned = achievements.instruments[d.key];
          const isSundayCell = d.key === 'sunday' && isSunday;
          return (
            <View key={d.key} style={styles.cell}>
              <Animated.Text
                style={[
                  styles.glyph,
                  { opacity: earned ? 1 : 0.3 },
                  isSundayCell && earned ? { opacity: pulse } : null,
                ]}>
                {d.emoji}
              </Animated.Text>
              <Text
                style={{
                  color: earned ? accentColor : theme.muted,
                  fontSize: 9,
                  letterSpacing: 0.5,
                  marginTop: 4,
                  fontWeight: earned ? '600' : '400',
                }}>
                {d.label}
              </Text>
            </View>
          );
        })}
      </View>
      <Text
        style={{
          color: theme.muted,
          fontSize: 11,
          textAlign: 'center',
          marginTop: 8,
        }}>
        {achievements.instrumentsEarned} of 7 instruments
        {achievements.symphonyKey === 'minor' ? ' · minor key' : ''}
      </Text>
      {isSunday ? (
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onPlay?.();
          }}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[
            styles.playBtn,
            { borderColor: accentColor },
            playing ? { backgroundColor: accentColor } : null,
          ]}>
          <Text style={{ color: playing ? '#0f0f0f' : accentColor, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 }}>
            {playing ? 'Playing…' : '▶ Hear your week'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
  },
  glyph: {
    fontSize: 24,
  },
  playBtn: {
    alignSelf: 'center',
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 22,
    borderWidth: 1,
  },
});
