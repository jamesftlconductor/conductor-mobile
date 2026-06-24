// Memory Journal — longitudinal view of the household's signal
// resolution history. Each entry is a row in the memory log
// (resolved / held / expired). Days are headed in brass; caught
// moments get a brass left border + badge; auto-resolutions get a
// small "auto" tag.

import { SecureScreen } from '@/components/SecureScreen';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { HelpButton } from '@/components/HelpButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TYPE_META } from '@/components/signalTypes';
import { PulsingCMark } from '@/components/PulsingCMark';
import { useUserId } from '@/hooks/useUserId';
import { useTheme } from './theme';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

// Module-level fallbacks — only used for ActivityIndicator color prop
// and other non-StyleSheet refs that don't need theme reactivity. The
// real theming happens through makeStyles(theme, accent) below.
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

export default function JournalScreenSecured() {
  return (
    <SecureScreen screenName="Memory">
      <JournalScreen />
    </SecureScreen>
  );
}

function JournalScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [days, setDays] = useState<Day[]>([]);
  const [streak, setStreak] = useState<StreakData>(null);
  const [loading, setLoading] = useState(true);
  const [pastYears, setPastYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [yearText, setYearText] = useState<string | null>(null);
  const [yearLoading, setYearLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, yrs] = await Promise.all([
        fetch(`${API_BASE}/signals?type=journal&userId=${userId}&days=30`),
        fetch(`${API_BASE}/signals?type=yearInReview&userId=${userId}`),
      ]);
      if (res.ok) {
        const d = await res.json();
        setDays(Array.isArray(d?.days) ? d.days : []);
        setStreak(d?.streakData || null);
      }
      if (yrs.ok) {
        const d = await yrs.json();
        setPastYears(Array.isArray(d?.years) ? d.years : []);
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  async function openYear(y: number) {
    setSelectedYear(y);
    setYearText(null);
    setYearLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/signals?type=yearInReview&userId=${userId}&year=${y}`
      );
      if (res.ok) {
        const d = await res.json();
        setYearText(typeof d?.yearInReview === 'string' ? d.yearInReview : null);
      }
    } catch {
      // best-effort
    } finally {
      setYearLoading(false);
    }
  }

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
    <ScreenHeader title="Memory" subtitle="What Conductor has handled" />
    <HelpButton cardId="caught" />
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>

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
          <PulsingCMark size={30} />
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

      {!loading && pastYears.length > 0 ? (
        <View style={styles.pastYearsBlock}>
          <Text style={styles.pastYearsLabel}>PAST YEARS</Text>
          {pastYears.map((y) => (
            <TouchableOpacity
              key={y}
              onPress={() => openYear(y)}
              style={styles.pastYearRow}
              activeOpacity={0.6}>
              <Text style={styles.pastYearText}>{y} →</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {selectedYear ? (
        <View style={styles.selectedYearWrap}>
          <View style={styles.selectedYearDivider} />
          <Text style={styles.selectedYearLabel}>{selectedYear}</Text>
          {yearLoading ? (
            <PulsingCMark size={30} />
          ) : yearText ? (
            <Text style={styles.selectedYearText}>{yearText}</Text>
          ) : (
            <Text style={styles.selectedYearEmpty}>
              No record stored for this year.
            </Text>
          )}
          <TouchableOpacity onPress={() => setSelectedYear(null)} style={styles.selectedYearClose}>
            <Text style={styles.selectedYearCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={{ height: 60 }} />
    </ScrollView>
    </View>
  );
}

// makeStyles produces a fresh StyleSheet from the current theme. The
// rgba accent overlays (border / soft fills) are kept as literals
// because they read fine in both modes — the 3–4% alpha makes them
// nearly identical when laid over either background.
function makeStyles(theme: { background: string; text: string; muted: string }, accentColor: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: 22, paddingTop: 8 },
    topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
    topBackText: { color: theme.muted, fontSize: 13, letterSpacing: 0.3 },
    title: { color: theme.text, fontSize: 28, fontWeight: '300', marginTop: 14, letterSpacing: 0.2 },
    subtitle: { color: theme.muted, fontSize: 13, marginTop: 6, marginBottom: 20 },
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
    streakNumber: { color: accentColor, fontSize: 30, fontWeight: '700', lineHeight: 36 },
    streakUnit: { color: theme.muted, fontSize: 11, marginTop: 2, letterSpacing: 0.3 },
    loading: { paddingVertical: 60, alignItems: 'center' },
    empty: { color: theme.muted, fontSize: 14, fontStyle: 'italic', textAlign: 'center', paddingVertical: 80 },
    dayBlock: { marginBottom: 18 },
    dayHeader: {
      color: accentColor,
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
      borderLeftColor: accentColor,
      backgroundColor: 'rgba(184, 150, 12, 0.04)',
    },
    emoji: { fontSize: 16, width: 22, textAlign: 'center' },
    rowMain: { flex: 1 },
    desc: { color: theme.text, fontSize: 13, lineHeight: 18 },
    badgeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
    badgeCaught: {
      color: accentColor,
      fontSize: 9,
      fontWeight: '600',
      letterSpacing: 0.5,
    },
    badgeAuto: {
      color: theme.muted,
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
    pastYearsBlock: {
      marginTop: 28,
      paddingTop: 18,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(184, 150, 12, 0.18)',
    },
    pastYearsLabel: {
      color: accentColor,
      fontSize: 10,
      letterSpacing: 2,
      fontWeight: '600',
      marginBottom: 12,
    },
    pastYearRow: {
      paddingVertical: 8,
    },
    pastYearText: {
      color: theme.text,
      fontSize: 14,
    },
    selectedYearWrap: {
      marginTop: 22,
    },
    selectedYearDivider: {
      height: 2,
      backgroundColor: 'rgba(184, 150, 12, 0.4)',
      marginBottom: 16,
    },
    selectedYearLabel: {
      color: accentColor,
      fontSize: 11,
      letterSpacing: 3,
      fontWeight: '600',
      marginBottom: 12,
    },
    selectedYearText: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 22,
    },
    selectedYearEmpty: {
      color: theme.muted,
      fontSize: 13,
      fontStyle: 'italic',
    },
    selectedYearClose: {
      marginTop: 14,
      alignSelf: 'flex-start',
      paddingVertical: 6,
    },
    selectedYearCloseText: {
      color: theme.muted,
      fontSize: 12,
    },
  });
}
