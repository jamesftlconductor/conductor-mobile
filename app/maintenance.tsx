// Home Maintenance plan screen.
//
// Two entry modes:
//   /maintenance               → show existing plan if any,
//                                 otherwise offer a Build button.
//   /maintenance?generate=true → kick off plan generation
//                                 immediately on mount, then
//                                 display.
//
// Rendered sections:
//   - BUDGET SUMMARY card (monthly avg, annual range, peak months)
//   - Household notes (italic muted, ⚠️ prefix)
//   - One block per month with item cards
//
// Each item card has a "Add to radar →" link that POSTs the
// addToRadar action, optimistically swapping the link to "Added ✓".

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';
import { useUserId } from '@/hooks/useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

// Semantic colors that should NOT flip with the theme — these carry
// meaning (urgency, warning) independent of palette mode.
const RED = '#d97757';
const AMBER = '#f59e0b';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type Priority = 'urgent' | 'recommended' | 'optional';

type PlanItem = {
  category: string;
  task: string;
  reason: string;
  priority: Priority;
  costLow: number;
  costHigh: number;
  unit: 'one-time' | 'monthly' | 'quarterly';
  knownProvider: string | null;
  providerPhone: string | null;
  diyPossible: boolean;
};

type PlanMonth = { month: string; items: PlanItem[] };

type Plan = {
  generatedAt: string;
  location: string;
  months: PlanMonth[];
  budget: {
    monthlyAverage?: number;
    monthlyLow?: number;
    monthlyHigh?: number;
    annualLow?: number;
    annualHigh?: number;
    peakMonths?: string[];
    quietMonths?: string[];
  };
  householdNotes?: string[];
};

const CATEGORY_EMOJI: Record<string, string> = {
  hvac: '❄️', roof: '🏠', lawn: '🌿', pest: '🪲', pool: '🏊',
  vehicle: '🚗', plumbing: '🔧', electrical: '⚡', appliance: '📦',
  general: '📋',
};

function priorityColor(p: Priority, muted: string): string {
  if (p === 'urgent') return RED;
  if (p === 'recommended') return AMBER;
  return muted;
}

function priorityLabel(p: Priority): string {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function fmtUSD(n: number | undefined): string {
  if (n == null) return '?';
  return '$' + Math.round(n).toLocaleString();
}

export default function MaintenanceScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const BRASS = accentColor;
  const MUTED = theme.muted;
  const params = useLocalSearchParams<{ generate?: string }>();
  const shouldGenerate = params?.generate === 'true';

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [addedSignals, setAddedSignals] = useState<Record<string, boolean>>({});
  const [isRenter, setIsRenter] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=profile&userId=${userId}`);
        const data = await res.json();
        const housing = data?.profile?.housing;
        if (housing === 'rent' || housing === 'living_with_family') setIsRenter(true);
      } catch { /* best-effort */ }
    })();
  }, []);

  const titleText = isRenter ? 'Your Maintenance' : 'Home Maintenance';

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/maintenance?userId=${userId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.plan) setPlan(data.plan as Plan);
    } catch { /* best-effort */ }
    finally { setLoading(false); }
  }, []);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', userId: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert('Could not build plan', data?.error || `Status ${res.status}`);
        return;
      }
      if (data?.plan) setPlan(data.plan as Plan);
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    load().then(() => {
      // Auto-kick generation when caller passes ?generate=true.
      // Skipped if a plan already came back from the load.
      if (shouldGenerate) {
        setTimeout(() => {
          if (!plan) generate();
        }, 50);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addToRadar(item: PlanItem, month: string) {
    const key = `${month}|${item.task}`;
    setAddedSignals((m) => ({ ...m, [key]: true }));
    try {
      await fetch(`${API_BASE}/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addToRadar',
          userId: userId,
          task: item.task,
          month,
          category: item.category,
          costLow: item.costLow,
          costHigh: item.costHigh,
        }),
      });
    } catch {
      // Best-effort; even on failure leave the ✓ — next refresh
      // will show the radar state of record.
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={BRASS} />
      </View>
    );
  }

  if (generating || (!plan && shouldGenerate)) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={BRASS} />
        <Text style={styles.workingText}>Building your plan…</Text>
        <Text style={styles.workingSub}>
          Conductor is sketching out your year of maintenance.
        </Text>
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.container}>
        <ScreenHeader title={titleText} subtitle="No plan yet." />
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyHint}>
              Conductor can build a 12-month maintenance plan from your home inventory
              and your location's seasonal patterns.
            </Text>
            <TouchableOpacity onPress={generate} style={styles.primaryBtn} activeOpacity={0.7}>
              <Text style={styles.primaryBtnText}>Build plan</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  const genDate = (() => {
    try { return new Date(plan.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }); }
    catch { return ''; }
  })();

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={titleText}
        subtitle={`${plan.location}${isRenter ? ' · Renter' : ''}${genDate ? ` · Generated ${genDate}` : ''}`}
      />
      <ScrollView contentContainerStyle={styles.scroll}>

      <View style={styles.budgetCard}>
        <Text style={styles.budgetHeadline}>
          ~{fmtUSD(plan.budget?.monthlyLow ?? plan.budget?.monthlyAverage)}–{fmtUSD(plan.budget?.monthlyHigh ?? plan.budget?.monthlyAverage)}
          <Text style={styles.budgetUnit}>/month</Text>
        </Text>
        <Text style={styles.budgetAnnual}>
          {fmtUSD(plan.budget?.annualLow)}–{fmtUSD(plan.budget?.annualHigh)} annually
        </Text>
        {plan.budget?.peakMonths && plan.budget.peakMonths.length > 0 ? (
          <Text style={styles.budgetPeak}>
            Peak months: {plan.budget.peakMonths.join(', ')}
          </Text>
        ) : null}
      </View>

      {(plan.householdNotes || []).length > 0 ? (
        <View style={styles.notesBlock}>
          {plan.householdNotes!.map((n, i) => (
            <Text key={i} style={styles.noteLine}>⚠️  {n}</Text>
          ))}
        </View>
      ) : null}

      {plan.months.map((m) => (
        <View key={m.month} style={styles.monthBlock}>
          <Text style={styles.monthHeader}>{m.month.toUpperCase()}</Text>
          {m.items.length === 0 ? (
            <Text style={styles.monthQuiet}>Quiet month — nothing scheduled.</Text>
          ) : (
            m.items.map((it, idx) => {
              const addedKey = `${m.month}|${it.task}`;
              const added = !!addedSignals[addedKey];
              return (
                <View key={idx} style={styles.itemCard}>
                  <View style={styles.itemHeaderRow}>
                    <Text style={styles.itemEmoji}>
                      {CATEGORY_EMOJI[it.category] || '📋'}
                    </Text>
                    <Text style={styles.itemTask}>{it.task}</Text>
                    <Text style={[styles.priorityBadge, { color: priorityColor(it.priority, theme.muted) }]}>
                      {priorityLabel(it.priority)}
                    </Text>
                  </View>
                  <Text style={styles.itemReason}>{it.reason}</Text>
                  <Text style={styles.itemCost}>
                    {fmtUSD(it.costLow)}–{fmtUSD(it.costHigh)}
                    {it.unit && it.unit !== 'one-time' ? ` ${it.unit}` : ''}
                  </Text>
                  {it.knownProvider ? (
                    <TouchableOpacity
                      onPress={() => it.providerPhone && Linking.openURL(`tel:${it.providerPhone}`)}
                      disabled={!it.providerPhone}>
                      <Text style={styles.itemProvider}>📞  {it.knownProvider}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <View style={styles.itemFooterRow}>
                    {it.diyPossible ? (
                      <Text style={styles.diyBadge}>DIY possible</Text>
                    ) : <View />}
                    <TouchableOpacity
                      onPress={() => addToRadar(it, m.month)}
                      disabled={added}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Text style={[styles.addRadarLink, added && { color: MUTED }]}>
                        {added ? 'Added ✓' : 'Add to radar →'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
      ))}
      </ScrollView>
    </View>
  );
}

type ThemeColors = { background: string; surface: string; text: string; muted: string };

function makeStyles(theme: ThemeColors, accentColor: string) {
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  const FAINT = theme.muted;
  const BRASS = accentColor;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 80 },
  topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, fontSize: 13, letterSpacing: 0.3 },
  title: { color: OFF_WHITE, fontSize: 28, fontWeight: '300', marginTop: 14, letterSpacing: 0.2 },
  subtitle: { color: MUTED, fontSize: 12, marginTop: 4, marginBottom: 22 },
  budgetCard: {
    padding: 18,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(184, 150, 12, 0.35)',
    backgroundColor: 'rgba(184, 150, 12, 0.03)',
    marginBottom: 18,
  },
  budgetHeadline: { color: BRASS, fontSize: 24, fontWeight: '700', letterSpacing: -0.3, lineHeight: 28 },
  budgetUnit: { color: MUTED, fontSize: 14, fontWeight: '400' },
  budgetAnnual: { color: FAINT, fontSize: 13, marginTop: 6 },
  budgetPeak: { color: MUTED, fontSize: 11, marginTop: 8, letterSpacing: 0.3 },
  notesBlock: { marginBottom: 24, gap: 8 },
  noteLine: { color: FAINT, fontSize: 12, fontStyle: 'italic', lineHeight: 19 },
  monthBlock: { marginBottom: 22 },
  monthHeader: {
    color: BRASS,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '600',
    marginBottom: 10,
  },
  monthQuiet: { color: MUTED, fontSize: 12, fontStyle: 'italic', paddingVertical: 6 },
  itemCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 10,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  itemEmoji: { fontSize: 18 },
  itemTask: { color: OFF_WHITE, fontSize: 14, fontWeight: '600', flex: 1 },
  priorityBadge: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  itemReason: { color: FAINT, fontSize: 12, fontStyle: 'italic', lineHeight: 17, marginBottom: 6 },
  itemCost: { color: MUTED, fontSize: 11, marginBottom: 6 },
  itemProvider: { color: BRASS, fontSize: 12, marginBottom: 6 },
  itemFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  diyBadge: { color: MUTED, fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' },
  addRadarLink: { color: BRASS, fontSize: 12, letterSpacing: 0.3 },
  emptyWrap: { paddingVertical: 40, alignItems: 'center', gap: 24 },
  emptyHint: { color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: BRASS,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
  },
  primaryBtnText: { color: BG, fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
  workingText: { color: OFF_WHITE, fontSize: 14, marginTop: 16, fontWeight: '500' },
  workingSub: { color: MUTED, fontSize: 12, marginTop: 6, paddingHorizontal: 40, textAlign: 'center' },
  });
}
