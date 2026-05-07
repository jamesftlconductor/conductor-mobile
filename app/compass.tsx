import { router } from 'expo-router';
import { useEffect, useState } from 'react';
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
const SAGE = '#86efac';
const ORANGE = '#f59e0b';
const RED = '#ef4444';

type CompassData = {
  household: string;
  sampleSize: number;
  patternsCount: number;
  totalResolved: number;
  daysSinceFirst: number;
  householdAge: number;
  topSenders: { sender: string; count: number; lastSeen: string | null }[];
  typeBreakdown: Record<string, { resolved: number; held: number; expired: number }>;
  peakDays: { day: string; count: number }[];
  averageResolutionTime: number | null;
  mostActiveCategory: string | null;
  quietestDay: string | null;
};

function formatHours(hours: number | null): string {
  if (hours == null) return '—';
  if (hours < 1) return '< 1 hour';
  if (hours < 24) return `${Math.round(hours)} hour${hours === 1 ? '' : 's'}`;
  const days = hours / 24;
  return `${days.toFixed(1)} days`;
}

function firstSeenDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// One row of the "Top Signal Sources" list. Bar width is the sender's share
// of the largest count in the list, so the heaviest sender always fills.
function SenderRow({ sender, count, max }: { sender: string; count: number; max: number }) {
  const pct = max > 0 ? Math.max(0.05, count / max) : 0;
  return (
    <View style={styles.senderRow}>
      <Text style={styles.senderName} numberOfLines={1}>
        {sender}
      </Text>
      <View style={styles.senderBarTrack}>
        <View style={[styles.senderBarFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.senderCount}>{count}</Text>
    </View>
  );
}

// Per-type stacked breakdown — three little bars (resolved / held / expired)
// next to the type label, scaled against the type's own total.
function TypeRow({
  type,
  data,
  globalMax,
}: {
  type: string;
  data: { resolved: number; held: number; expired: number };
  globalMax: number;
}) {
  const meta = TYPE_META[type];
  const total = data.resolved + data.held + data.expired;
  const totalPct = globalMax > 0 ? Math.max(0.05, total / globalMax) : 0;
  const resolvedPct = total > 0 ? data.resolved / total : 0;
  const heldPct = total > 0 ? data.held / total : 0;
  const expiredPct = total > 0 ? data.expired / total : 0;
  return (
    <View style={styles.typeRow}>
      <View style={styles.typeLabelGroup}>
        {meta ? <Text style={styles.typeEmoji}>{meta.emoji}</Text> : null}
        <Text style={styles.typeLabel}>{type}</Text>
      </View>
      <View style={styles.typeBarOuter}>
        <View style={[styles.typeBarInner, { width: `${totalPct * 100}%` }]}>
          {resolvedPct > 0 && (
            <View style={[styles.typeSegment, { flex: resolvedPct, backgroundColor: SAGE }]} />
          )}
          {heldPct > 0 && (
            <View style={[styles.typeSegment, { flex: heldPct, backgroundColor: ORANGE }]} />
          )}
          {expiredPct > 0 && (
            <View style={[styles.typeSegment, { flex: expiredPct, backgroundColor: RED }]} />
          )}
        </View>
      </View>
      <Text style={styles.typeCount}>{total}</Text>
    </View>
  );
}

// Day-of-week bar chart for the peak days card. Days are presented in
// natural Mon-Sun order regardless of the count ordering the API returns.
const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT: Record<string, string> = {
  Monday: 'M',
  Tuesday: 'T',
  Wednesday: 'W',
  Thursday: 'T',
  Friday: 'F',
  Saturday: 'S',
  Sunday: 'S',
};

function PeakDaysChart({ peakDays }: { peakDays: { day: string; count: number }[] }) {
  const max = Math.max(...peakDays.map((p) => p.count), 1);
  const ordered = DAY_ORDER.map(
    (d) => peakDays.find((p) => p.day === d) || { day: d, count: 0 },
  );
  return (
    <View style={styles.daysRow}>
      {ordered.map((p) => {
        const heightPct = (p.count / max) * 100;
        return (
          <View key={p.day} style={styles.dayColumn}>
            <View style={styles.dayBarTrack}>
              <View
                style={[
                  styles.dayBarFill,
                  { height: `${heightPct}%`, opacity: p.count > 0 ? 1 : 0.2 },
                ]}
              />
            </View>
            <Text style={styles.dayLabel}>{DAY_SHORT[p.day]}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      {children}
    </View>
  );
}

export default function CompassScreen() {
  const [data, setData] = useState<CompassData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=compass&userId=${USER_ID}`);
        if (!res.ok) return;
        const d = await res.json();
        if (!cancelled) setData(d);
      } catch {
        // best-effort
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Compass</Text>
      <Text style={styles.subtitle}>What Conductor has learned about your household</Text>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={MUTED} />
        </View>
      )}

      {!loading && data && data.householdAge < 7 && (
        <View style={styles.earlyWrap}>
          <Text style={styles.earlyTitle}>
            Compass gets smarter with time. Check back after a week of signals.
          </Text>
          <Text style={styles.earlyEmoji}>🧭</Text>
          <Text style={styles.earlyDays}>
            {data.householdAge} day{data.householdAge === 1 ? '' : 's'} since first signal
          </Text>
        </View>
      )}

      {!loading && data && data.householdAge >= 7 && (
        <>
          {/* CARD 1 — HOUSEHOLD PULSE */}
          <Card label="Household pulse">
            <Text style={styles.cardHeadline}>
              {data.totalResolved} signal{data.totalResolved === 1 ? '' : 's'} resolved since{' '}
              {firstSeenDate(data.daysSinceFirst)}
            </Text>
            <Text style={styles.cardSub}>
              Your household has been on Conductor for {data.householdAge} days
            </Text>
          </Card>

          {/* CARD 2 — TOP SIGNAL SOURCES */}
          <Card label="Where your signals come from">
            {(() => {
              const top = data.topSenders.slice(0, 5);
              const max = Math.max(...top.map((s) => s.count), 1);
              if (top.length === 0) {
                return <Text style={styles.cardEmpty}>No senders recorded yet.</Text>;
              }
              return top.map((s) => (
                <SenderRow key={s.sender} sender={s.sender} count={s.count} max={max} />
              ));
            })()}
          </Card>

          {/* CARD 3 — SIGNAL TYPE BREAKDOWN */}
          <Card label="How your household handles signals">
            {(() => {
              const types = Object.entries(data.typeBreakdown);
              if (types.length === 0) {
                return <Text style={styles.cardEmpty}>No type data yet.</Text>;
              }
              const totals = types.map(([, v]) => v.resolved + v.held + v.expired);
              const max = Math.max(...totals, 1);
              return (
                <>
                  {types.map(([type, v]) => (
                    <TypeRow key={type} type={type} data={v} globalMax={max} />
                  ))}
                  <View style={styles.legend}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: SAGE }]} />
                      <Text style={styles.legendText}>resolved</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: ORANGE }]} />
                      <Text style={styles.legendText}>held</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: RED }]} />
                      <Text style={styles.legendText}>expired</Text>
                    </View>
                  </View>
                </>
              );
            })()}
          </Card>

          {/* CARD 4 — PEAK DAYS */}
          <Card label="When things happen">
            <Text style={styles.cardHeadline}>
              Your household is most active on {data.peakDays[0]?.day || '—'}
            </Text>
            <PeakDaysChart peakDays={data.peakDays} />
            {data.quietestDay && (
              <Text style={styles.cardSub}>Quietest day: {data.quietestDay}</Text>
            )}
          </Card>

          {/* CARD 5 — RESOLUTION SPEED */}
          <Card label="How quickly your household acts">
            <Text style={styles.cardHeadline}>
              Signals typically rest within {formatHours(data.averageResolutionTime)}
            </Text>
            {data.mostActiveCategory && (
              <Text style={styles.cardSub}>
                Most active category: {data.mostActiveCategory}
              </Text>
            )}
          </Card>
        </>
      )}

      <TouchableOpacity
        style={styles.backLink}
        onPress={() => router.back()}
        activeOpacity={0.6}>
        <Text style={styles.backLinkText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 60 },
  title: {
    color: OFF_WHITE,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    color: MUTED,
    fontSize: 13,
    paddingBottom: 24,
    letterSpacing: 0.2,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },

  earlyWrap: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 24,
  },
  earlyTitle: {
    color: OFF_WHITE,
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  earlyEmoji: {
    fontSize: 36,
  },
  earlyDays: {
    color: BRASS,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '600',
  },

  card: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: BRASS + '55',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardLabel: {
    color: BRASS,
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  cardHeadline: {
    color: OFF_WHITE,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  cardSub: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    letterSpacing: 0.2,
  },
  cardEmpty: {
    color: MUTED,
    fontSize: 12,
    fontStyle: 'italic',
  },

  // Sender list
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  senderName: {
    color: OFF_WHITE,
    fontSize: 13,
    width: 110,
  },
  senderBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  senderBarFill: {
    height: '100%',
    backgroundColor: BRASS,
  },
  senderCount: {
    color: MUTED,
    fontSize: 12,
    width: 24,
    textAlign: 'right',
  },

  // Type breakdown
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  typeLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 110,
    gap: 6,
  },
  typeEmoji: {
    fontSize: 14,
  },
  typeLabel: {
    color: OFF_WHITE,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  typeBarOuter: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  typeBarInner: {
    height: '100%',
    flexDirection: 'row',
  },
  typeSegment: {
    height: '100%',
  },
  typeCount: {
    color: MUTED,
    fontSize: 12,
    width: 24,
    textAlign: 'right',
  },
  legend: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  // Peak days chart
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 80,
    marginTop: 16,
    marginBottom: 4,
  },
  dayColumn: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  dayBarTrack: {
    width: 14,
    height: 60,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 3,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  dayBarFill: {
    width: '100%',
    backgroundColor: BRASS,
  },
  dayLabel: {
    color: MUTED,
    fontSize: 10,
    marginTop: 6,
    letterSpacing: 0.5,
  },

  backLink: {
    paddingTop: 32,
    alignItems: 'center',
  },
  backLinkText: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
