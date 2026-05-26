// Shareable summary card. Designed to be screenshotted by the user
// (iOS gesture: side button + volume up) and shared via the native
// share sheet, OR shared as text via React Native's built-in
// Share.share().
//
// Native image capture + auto-share to the iOS share sheet requires
// react-native-view-shot + expo-sharing — both have native binaries
// that can't ship over OTA. When those land in the next EAS build,
// swap the "Take a screenshot" hint for a one-tap capture-and-share
// button (TODO marker below).

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useUserId } from '@/hooks/useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';

type Summary = {
  period: 'week' | 'month';
  startDate: string;
  endDate: string;
  signalsRested: number;
  signalsLapsed: number;
  deadlinesCaught: number;
  birthdaysRemembered: number;
  currentStreak: number;
  longestStreak: number;
  totalResolved: number;
  topCaughtMoment: { description: string; daysBeforeExpiry: number } | null;
  householdName: string;
  generatedAt: string;
};

function formatRange(startISO: string, endISO: string): string {
  try {
    const s = new Date(startISO);
    const e = new Date(endISO);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(s)} – ${fmt(e)}`;
  } catch {
    return '';
  }
}

export default function SummaryCardScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const params = useLocalSearchParams<{ period?: string }>();
  const period = params?.period === 'month' ? 'month' : 'week';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/summary?userId=${userId}&period=${period}`
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setSummary(data);
        }
      } catch {
        // best-effort
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period]);

  async function shareText() {
    if (!summary) return;
    const periodLabel = period === 'month' ? 'this month' : 'this week';
    const lines = [
      `Conductor — ${periodLabel}:`,
      `${summary.signalsRested} signals handled`,
      `${summary.deadlinesCaught} deadlines caught`,
      `${summary.currentStreak} day streak`,
    ];
    if (summary.topCaughtMoment) {
      lines.push(
        `Caught: ${summary.topCaughtMoment.description} — ${summary.topCaughtMoment.daysBeforeExpiry} days before it lapsed.`
      );
    }
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      // user cancelled or sharing unavailable
    }
  }

  if (loading || !summary) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={BRASS} />
      </View>
    );
  }

  const periodLabel = period === 'month' ? 'This Month' : 'This Week';

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.brand}>CONDUCTOR</Text>
        <View style={styles.brassLine} />
        <Text style={styles.periodLabel}>{periodLabel.toUpperCase()}</Text>
        <Text style={styles.dateRange}>
          {formatRange(summary.startDate, summary.endDate)}
        </Text>

        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statNumber}>{summary.signalsRested}</Text>
            <Text style={styles.statLabel}>SIGNALS HANDLED</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNumber}>{summary.deadlinesCaught}</Text>
            <Text style={styles.statLabel}>DEADLINES CAUGHT</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNumber}>{summary.currentStreak}</Text>
            <Text style={styles.statLabel}>DAY STREAK</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNumber}>{summary.birthdaysRemembered}</Text>
            <Text style={styles.statLabel}>BIRTHDAYS REMEMBERED</Text>
          </View>
        </View>

        {summary.topCaughtMoment ? (
          <>
            <View style={styles.brassLine} />
            <Text style={styles.caughtText}>
              Conductor caught: {summary.topCaughtMoment.description} —{' '}
              {summary.topCaughtMoment.daysBeforeExpiry} day
              {summary.topCaughtMoment.daysBeforeExpiry === 1 ? '' : 's'} before
              it lapsed.
            </Text>
          </>
        ) : null}

        <View style={styles.bottomLine} />
        <Text style={styles.footer}>CONDUCTOR.APP</Text>
      </View>

      <Text style={styles.screenshotHint}>
        Take a screenshot to share this card.
      </Text>

      <TouchableOpacity onPress={shareText} style={styles.shareBtn} activeOpacity={0.7}>
        <Text style={styles.shareBtnText}>Share as text ✦</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()} style={styles.doneBtn} activeOpacity={0.7}>
        <Text style={styles.doneText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 32,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(184, 150, 12, 0.55)',
    borderRadius: 16,
    paddingTop: 22,
    paddingBottom: 22,
    paddingHorizontal: 22,
    alignItems: 'center',
    backgroundColor: BG,
  },
  brand: {
    color: BRASS,
    fontSize: 12,
    letterSpacing: 4,
    fontWeight: '600',
  },
  brassLine: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(184, 150, 12, 0.4)',
    marginVertical: 14,
  },
  periodLabel: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 2,
  },
  dateRange: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
    marginBottom: 18,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  statCell: {
    width: '50%',
    alignItems: 'center',
    paddingVertical: 14,
  },
  statNumber: {
    color: OFF_WHITE,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 44,
  },
  statLabel: {
    color: MUTED,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 2,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  caughtText: {
    color: OFF_WHITE,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  bottomLine: {
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(184, 150, 12, 0.4)',
    marginTop: 18,
    marginBottom: 14,
  },
  footer: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 2,
  },
  screenshotHint: {
    color: MUTED,
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 22,
    marginBottom: 18,
  },
  shareBtn: {
    backgroundColor: BRASS,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 24,
    alignSelf: 'center',
  },
  shareBtnText: {
    color: BG,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  doneBtn: { alignSelf: 'center', marginTop: 14, paddingVertical: 10 },
  doneText: { color: MUTED, fontSize: 13 },
});
