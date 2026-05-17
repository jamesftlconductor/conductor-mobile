// Memory Journal — longitudinal view of the household's signal
// resolution history. Each entry is a row in the memory log
// (resolved / held / expired). Days are headed in brass; caught
// moments get a brass left border + badge; auto-resolutions get a
// small "auto" tag.

import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { TYPE_META } from '@/components/signalTypes';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';
const FAINT = '#a8a5a0';

type Entry = {
  signalId: string | number;
  description: string;
  sender: string | null;
  type: string | null;
  action: 'resolved' | 'held' | 'expired';
  actionAt: string;
  userId: string | null;
  isCaughtMoment: boolean;
  wasAutomatic: boolean;
};

type Day = { date: string; entries: Entry[] };

type StreakData = {
  currentStreak: number;
  longestStreak: number;
  totalResolved: number;
} | null;

function formatDayHeader(dateKey: string): string {
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  if (dateKey === today) return 'TODAY';
  if (dateKey === yesterday) return 'YESTERDAY';
  const ms = Date.parse(dateKey);
  if (!isNaN(ms)) {
    return new Date(ms)
      .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
      .toUpperCase();
  }
  return dateKey.toUpperCase();
}

function actionLabel(action: string): string {
  if (action === 'resolved') return 'Rested';
  if (action === 'held') return 'Held';
  if (action === 'expired') return 'Lapsed';
  return action;
}

export default function JournalScreen() {
  const [days, setDays] = useState<Day[]>([]);
  const [streak, setStreak] = useState<StreakData>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/signals?type=journal&userId=${USER_ID}&days=30`);
      if (res.ok) {
        const d = await res.json();
        setDays(Array.isArray(d?.days) ? d.days : []);
        setStreak(d?.streakData || null);
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity
        onPress={() => router.back()}
        activeOpacity={0.6}
        style={styles.topBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.topBackText}>← Return</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Memory</Text>
      <Text style={styles.subtitle}>What Conductor has handled</Text>

      {streak && streak.currentStreak >= 0 && (
        <View style={styles.streakCard}>
          <Text style={styles.streakNumber}>{streak.currentStreak}</Text>
          <Text style={styles.streakUnit}>
            day{streak.currentStreak === 1 ? '' : 's'} running
          </Text>
        </View>
      )}

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={MUTED} />
        </View>
      )}

      {!loading && days.length === 0 && (
        <Text style={styles.empty}>
          No memory yet. Rest a signal to start your record.
        </Text>
      )}

      {!loading && days.map((day) => (
        <View key={day.date} style={styles.dayBlock}>
          <Text style={styles.dayHeader}>{formatDayHeader(day.date)}</Text>
          {day.entries.map((e, i) => {
            const meta = e.type ? TYPE_META[e.type] : null;
            const isCaught = e.isCaughtMoment;
            return (
              <View
                key={String(e.signalId) + '-' + i}
                style={[
                  styles.row,
                  isCaught && styles.rowCaught,
                ]}>
                <Text style={styles.emoji}>{meta?.emoji || '•'}</Text>
                <View style={styles.rowMain}>
                  <Text style={styles.desc} numberOfLines={2}>
                    {e.description || 'Signal'}
                  </Text>
                  <View style={styles.badgeRow}>
                    {isCaught && (
                      <Text style={styles.badgeCaught}>⚡ CAUGHT</Text>
                    )}
                    {e.wasAutomatic && (
                      <Text style={styles.badgeAuto}>auto</Text>
                    )}
                  </View>
                </View>
                <Text style={styles.actionLabel}>{actionLabel(e.action)}</Text>
              </View>
            );
          })}
        </View>
      ))}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 22, paddingTop: 60 },
  topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, fontSize: 13, letterSpacing: 0.3 },
  title: { color: OFF_WHITE, fontSize: 28, fontWeight: '300', marginTop: 14, letterSpacing: 0.2 },
  subtitle: { color: MUTED, fontSize: 13, marginTop: 6, marginBottom: 20 },
  streakCard: {
    alignItems: 'center',
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    marginBottom: 22,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(184, 150, 12, 0.35)',
    backgroundColor: 'rgba(184, 150, 12, 0.03)',
  },
  streakNumber: { color: BRASS, fontSize: 30, fontWeight: '700', lineHeight: 36 },
  streakUnit: { color: MUTED, fontSize: 11, marginTop: 2, letterSpacing: 0.3 },
  loading: { paddingVertical: 60, alignItems: 'center' },
  empty: { color: MUTED, fontSize: 14, fontStyle: 'italic', textAlign: 'center', paddingVertical: 80 },
  dayBlock: { marginBottom: 18 },
  dayHeader: {
    color: BRASS,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 10,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 10,
    borderRadius: 6,
  },
  rowCaught: {
    borderLeftWidth: 2,
    borderLeftColor: BRASS,
    backgroundColor: 'rgba(184, 150, 12, 0.04)',
  },
  emoji: { fontSize: 16, width: 22, textAlign: 'center' },
  rowMain: { flex: 1 },
  desc: { color: OFF_WHITE, fontSize: 13, lineHeight: 18 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  badgeCaught: {
    color: BRASS,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  badgeAuto: {
    color: MUTED,
    fontSize: 9,
    letterSpacing: 0.5,
    fontStyle: 'italic',
  },
  actionLabel: {
    color: FAINT,
    fontSize: 11,
    fontStyle: 'italic',
    minWidth: 50,
    textAlign: 'right',
  },
});
