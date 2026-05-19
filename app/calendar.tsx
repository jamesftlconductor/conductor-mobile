// Monthly calendar — 7-col grid of the requested month with signal
// density dots (colored by crew attribution), vault-deadline triangle,
// and a tap-to-expand half-sheet that lists everything dated to the
// tapped day. Driven by GET /api/signals?type=calendar-month&month=
// YYYY-MM — see api/signals.js handleCalendarMonth for the response
// shape. Entry points: Hover legend wheel + Programme header link.

import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

import { AddSignalSheet } from '@/components/AddSignalSheet';
import { metaForRing, type Signal, TYPE_META } from '@/components/signalTypes';
import { useTheme } from './theme';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

// Crew avatar accent palette — kept in sync with hover.tsx so a member
// renders the same color on the radar and the calendar grid.
const CREW_COLORS = [
  '#b8960c', '#7c9e87', '#8b7355', '#6b8cae',
  '#a67c9e', '#ae7c7c', '#7c9eae', '#ae9e7c',
];

type CalendarSignal = {
  id: string | number;
  description: string;
  type: string;
  eta: string;
  state: string | null;
  status: string | null;
  crewMemberId: string | null;
  sender: string | null;
};

type CalendarVault = {
  id: string;
  description: string;
  category: string | null;
  renewalDate: string;
  amount: string | number | null;
};

type CalendarCrewEvent =
  | { kind: 'birthday'; memberName: string; memberType: string | null }
  | { kind: 'anniversary'; memberName: string; memberType: string | null }
  | { kind: 'event'; memberName: string; description: string; date: string };

type DayBucket = {
  signals: CalendarSignal[];
  vault: CalendarVault[];
  crewEvents: CalendarCrewEvent[];
};

type MonthResponse = {
  household: string;
  month: string;
  days: Record<string, DayBucket>;
};

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

function monthLabel(year: number, month0: number): string {
  const d = new Date(year, month0, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function weekdayLabel(year: number, month0: number, day: number): string {
  return new Date(year, month0, day).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function todayYmd(): string {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function CalendarScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const { width } = useWindowDimensions();
  const cellWidth = (width - 32) / 7; // 16px padding each side

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month0, setMonth0] = useState(now.getMonth());
  const [data, setData] = useState<MonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [addSheetEta, setAddSheetEta] = useState<string>('');
  const [crewColorMap, setCrewColorMap] = useState<Record<string, string>>({});

  const monthParam = `${year}-${pad2(month0 + 1)}`;
  const today = todayYmd();

  // Build a stable crew → color lookup so signal density dots match the
  // colors used on the Hover radar. Loaded once on mount; rebuilt only
  // if the household roster changes (rare in a session).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=crew&userId=${USER_ID}`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const list = Array.isArray(json?.crew) ? json.crew : [];
        const m: Record<string, string> = {};
        list.forEach((c: { name?: string }, i: number) => {
          const k = String(c?.name || '').toLowerCase().trim();
          if (k) m[k] = CREW_COLORS[i % CREW_COLORS.length];
        });
        setCrewColorMap(m);
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/signals?type=calendar-month&userId=${USER_ID}&month=${monthParam}`
      );
      if (!res.ok) {
        setData(null);
        return;
      }
      const json = (await res.json()) as MonthResponse;
      setData(json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [monthParam]);

  useEffect(() => { load(); }, [load]);

  function shiftMonth(delta: number) {
    let nm = month0 + delta;
    let ny = year;
    if (nm < 0) { nm = 11; ny -= 1; }
    if (nm > 11) { nm = 0; ny += 1; }
    setMonth0(nm);
    setYear(ny);
    setSelectedYmd(null);
  }

  // Day grid: pad with empty cells to align the 1st of the month under
  // its weekday header. JS getDay() returns 0=Sun, which matches our
  // WEEKDAYS array exactly.
  const firstDow = new Date(year, month0, 1).getDay();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells: ({ day: number; ymd: string } | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, ymd: ymd(year, month0, d) });
  }
  // Pad to a multiple of 7 so the bottom row stays full-width.
  while (cells.length % 7 !== 0) cells.push(null);

  const days = data?.days || {};
  const selectedBucket: DayBucket | null = selectedYmd
    ? days[selectedYmd] || { signals: [], vault: [], crewEvents: [] }
    : null;

  function dotColorFor(s: CalendarSignal): string {
    if (s.crewMemberId) {
      const k = String(s.crewMemberId).toLowerCase().trim();
      if (crewColorMap[k]) return crewColorMap[k];
    }
    return accentColor;
  }

  function openFinaleFor(s: CalendarSignal) {
    // Defer to Hover with a signalId param so the Finale modal opens
    // there — no separate Finale entry on the calendar.
    router.push({ pathname: '/(tabs)/hover', params: { signalId: String(s.id) } });
  }

  function openAddForSelectedDay() {
    if (!selectedYmd) return;
    setAddSheetEta(selectedYmd);
    setAddSheetOpen(true);
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.topBackText}>← Return</Text>
        </TouchableOpacity>
        <View style={styles.monthSwitcher}>
          <TouchableOpacity
            onPress={() => shiftMonth(-1)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.arrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{monthLabel(year, month0)}</Text>
          <TouchableOpacity
            onPress={() => shiftMonth(1)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.arrow}>→</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/programme' as never)}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.weekViewLink}>2-week view →</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={[styles.weekdayLabel, { width: cellWidth }]}>{w}</Text>
        ))}
      </View>

      {loading && !data ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.muted} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.gridScroll}>
          <View style={styles.grid}>
            {cells.map((cell, i) => {
              if (!cell) {
                return <View key={`empty-${i}`} style={[styles.cell, { width: cellWidth }]} />;
              }
              const bucket = days[cell.ymd];
              const sigCount = bucket?.signals.length || 0;
              const vaultCount = bucket?.vault.length || 0;
              const dotSignals = (bucket?.signals || []).slice(0, 3);
              const overflow = Math.max(0, sigCount - 3);
              const isToday = cell.ymd === today;
              return (
                <TouchableOpacity
                  key={cell.ymd}
                  onPress={() => setSelectedYmd(cell.ymd)}
                  activeOpacity={0.6}
                  style={[styles.cell, { width: cellWidth }]}>
                  <View
                    style={[
                      styles.dayNumWrap,
                      isToday && { backgroundColor: accentColor },
                    ]}>
                    <Text
                      style={[
                        styles.dayNum,
                        isToday && { color: theme.background, fontWeight: '700' },
                      ]}>
                      {cell.day}
                    </Text>
                  </View>
                  {vaultCount > 0 ? <View style={styles.vaultTri} /> : null}
                  {dotSignals.length > 0 ? (
                    <View style={styles.dotsRow}>
                      {dotSignals.map((s, di) => (
                        <View
                          key={`${cell.ymd}-${di}`}
                          style={[styles.dot, { backgroundColor: dotColorFor(s) }]}
                        />
                      ))}
                      {overflow > 0 ? (
                        <Text style={styles.overflow}>+{overflow}</Text>
                      ) : null}
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Day-detail half-sheet */}
      <Modal
        visible={!!selectedYmd}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedYmd(null)}>
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setSelectedYmd(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>
              {selectedYmd
                ? weekdayLabel(
                    parseInt(selectedYmd.slice(0, 4), 10),
                    parseInt(selectedYmd.slice(5, 7), 10) - 1,
                    parseInt(selectedYmd.slice(8, 10), 10)
                  )
                : ''}
            </Text>

            <ScrollView style={styles.sheetList}>
              {selectedBucket && selectedBucket.signals.length === 0
                && selectedBucket.vault.length === 0
                && selectedBucket.crewEvents.length === 0 ? (
                <Text style={styles.sheetEmpty}>Nothing scheduled.</Text>
              ) : null}

              {selectedBucket?.crewEvents.map((e, i) => {
                const label =
                  e.kind === 'birthday'
                    ? `🎂  ${e.memberName}'s birthday`
                    : e.kind === 'anniversary'
                      ? `💍  ${e.memberName}'s anniversary`
                      : `📅  ${e.memberName}: ${e.description}`;
                return (
                  <View key={`crew-${i}`} style={styles.sheetRow}>
                    <Text style={styles.sheetRowText}>{label}</Text>
                  </View>
                );
              })}

              {selectedBucket?.vault.map((v, i) => (
                <View key={`vault-${v.id || i}`} style={styles.sheetRow}>
                  <Text style={styles.sheetRowText}>⚠️  {v.description || 'Renewal'}</Text>
                  {v.amount != null ? (
                    <Text style={styles.sheetRowMeta}>${v.amount}</Text>
                  ) : null}
                </View>
              ))}

              {selectedBucket?.signals.map((s) => {
                const meta = metaForRing(s as unknown as Signal, 'middle');
                const typeMeta = TYPE_META[s.type] || meta;
                const time = (() => {
                  if (!s.eta) return null;
                  const ms = Date.parse(s.eta);
                  if (isNaN(ms)) return null;
                  // Only render time if the eta includes a time
                  // component — bare YYYY-MM-DD strings parse to
                  // midnight UTC which renders as wrong-local-time
                  // 8 PM the prior day in EDT.
                  if (!/T\d/.test(s.eta)) return null;
                  return new Date(ms).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  });
                })();
                return (
                  <TouchableOpacity
                    key={String(s.id)}
                    onPress={() => openFinaleFor(s)}
                    activeOpacity={0.6}
                    style={styles.sheetRow}>
                    <Text style={styles.sheetRowText} numberOfLines={2}>
                      {typeMeta.emoji}  {s.description || 'Signal'}
                    </Text>
                    <View style={styles.sheetRowMetaRow}>
                      {s.crewMemberId ? (
                        <View
                          style={[
                            styles.attribBadge,
                            { backgroundColor: dotColorFor(s) + '33', borderColor: dotColorFor(s) },
                          ]}>
                          <Text style={[styles.attribBadgeText, { color: dotColorFor(s) }]}>
                            {s.crewMemberId}
                          </Text>
                        </View>
                      ) : null}
                      {time ? <Text style={styles.sheetRowMeta}>{time}</Text> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={openAddForSelectedDay}
              activeOpacity={0.6}
              style={styles.addRow}>
              <Text style={styles.addRowText}>+ Add signal for this date</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <AddSignalSheet
        visible={addSheetOpen}
        userId={USER_ID}
        initialEta={addSheetEta}
        onClose={() => setAddSheetOpen(false)}
        onAdded={() => {
          setAddSheetOpen(false);
          load();
        }}
      />
    </View>
  );
}

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
};

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 60,
      paddingBottom: 12,
    },
    topBackText: { color: theme.muted, fontSize: 13, letterSpacing: 0.3, width: 60 },
    weekViewLink: {
      color: accentColor,
      fontSize: 13,
      letterSpacing: 0.3,
      fontWeight: '500',
    },
    monthSwitcher: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    monthLabel: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '600',
      letterSpacing: 0.2,
      minWidth: 130,
      textAlign: 'center',
    },
    arrow: {
      color: accentColor,
      fontSize: 18,
      fontWeight: '500',
    },
    weekdayRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      marginBottom: 6,
    },
    weekdayLabel: {
      color: theme.muted,
      fontSize: 10,
      letterSpacing: 1.5,
      textAlign: 'center',
    },
    loading: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 80,
    },
    gridScroll: {
      paddingHorizontal: 16,
      paddingBottom: 60,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      aspectRatio: 1,
      padding: 4,
      alignItems: 'center',
      borderRadius: 6,
    },
    dayNumWrap: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    dayNum: {
      color: theme.text,
      fontSize: 13,
      letterSpacing: 0.2,
    },
    vaultTri: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 0,
      height: 0,
      borderLeftWidth: 5,
      borderLeftColor: 'transparent',
      borderRightWidth: 5,
      borderRightColor: 'transparent',
      borderBottomWidth: 8,
      borderBottomColor: accentColor,
    },
    dotsRow: {
      position: 'absolute',
      bottom: 6,
      left: 6,
      right: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    overflow: {
      color: theme.muted,
      fontSize: 9,
      marginLeft: 2,
    },
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 20,
      paddingBottom: 28,
      paddingHorizontal: 22,
      maxHeight: '70%',
    },
    sheetTitle: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '600',
      letterSpacing: 0.2,
      marginBottom: 14,
    },
    sheetList: {
      maxHeight: 420,
    },
    sheetEmpty: {
      color: theme.muted,
      fontSize: 13,
      fontStyle: 'italic',
      paddingVertical: 14,
    },
    sheetRow: {
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      gap: 4,
    },
    sheetRowText: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 19,
    },
    sheetRowMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 2,
    },
    sheetRowMeta: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 0.3,
    },
    attribBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      borderWidth: 1,
    },
    attribBadgeText: {
      fontSize: 9,
      fontWeight: '600',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    addRow: {
      marginTop: 16,
      paddingVertical: 12,
      alignItems: 'center',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: accentColor,
    },
    addRowText: {
      color: accentColor,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
  });
}
