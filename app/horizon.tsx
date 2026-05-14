import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { metaFor, Signal, TYPE_META } from '@/components/signalTypes';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

const DAY_MS = 24 * 60 * 60 * 1000;

// Convert ETA to a "X days" label + display color. Brass for 14–90 days
// (the active horizon window), muted for further out. Deadlines that have
// drifted closer than 14 days still render with brass since they belong on
// this screen by virtue of being deadlines.
function daysOutDescription(s: Signal): { label: string; color: string } {
  const ms = s.eta ? Date.parse(s.eta) : NaN;
  if (isNaN(ms)) return { label: 'no date', color: MUTED };
  const diffMs = ms - Date.now();
  if (diffMs < 0) return { label: 'past due', color: BRASS };
  const days = Math.max(1, Math.round(diffMs / DAY_MS));
  const label = `${days} day${days === 1 ? '' : 's'}`;
  const color = days > 90 ? MUTED : BRASS;
  return { label, color };
}

// Title-case a type identifier for the category pill — "deadline" → "Deadline".
// Falls back to TYPE_META.label when available so the casing matches the legend.
function categoryLabel(type: string | undefined): string {
  if (!type) return 'Signal';
  if (TYPE_META[type]) return TYPE_META[type].label;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function categoryColor(type: string | undefined): string {
  if (type && TYPE_META[type]) return TYPE_META[type].color;
  return MUTED;
}

export default function HorizonScreen() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/signals?type=horizon&userId=${USER_ID}`);
      if (!res.ok) return;
      const data = await res.json();
      setSignals(Array.isArray(data?.signals) ? data.signals : []);
    } catch {
      // Best-effort; preserve current list on failure.
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Optimistic remove: Rest takes a row off the screen entirely; Noted
  // keeps it on the horizon (state stays "active" but it now carries a
  // notedAt stamp the backend can use later). Network failures reconcile
  // on the next pull-to-refresh.
  async function patchSignal(id: Signal['id'], state: 'resolved' | 'active', notedAt?: string) {
    if (state === 'resolved') {
      setSignals((prev) => prev.filter((s) => String(s.id) !== String(id)));
    } else if (notedAt) {
      // For "Noted", stamp locally so the row visually settles; keep it on
      // the screen but mark it acknowledged.
      setSignals((prev) =>
        prev.map((s) =>
          String(s.id) === String(id) ? { ...s, notedAt, state: 'active' } : s,
        ),
      );
    }
    try {
      await fetch(`${API_BASE}/signals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          state,
          userId: USER_ID,
          ...(notedAt ? { notedAt } : {}),
        }),
      });
    } catch {
      // Best-effort.
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={MUTED} />
      }>
      <TouchableOpacity
        onPress={() => router.back()}
        activeOpacity={0.6}
        style={styles.topBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.topBackText}>← Return</Text>
      </TouchableOpacity>
      <Text style={styles.title}>The Horizon</Text>
      <Text style={styles.subtitle}>What Conductor is watching ahead</Text>

      {loading && (
        <View style={styles.empty}>
          <ActivityIndicator color={MUTED} />
        </View>
      )}

      {!loading && signals.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>The horizon is clear.</Text>
        </View>
      )}

      {!loading &&
        signals.map((s) => {
          const meta = metaFor(s);
          const distance = daysOutDescription(s);
          const cat = categoryLabel(s.type);
          const catColor = categoryColor(s.type);
          const alreadyNoted = !!(s as Signal & { notedAt?: string }).notedAt;
          return (
            <View key={String(s.id)} style={styles.row}>
              <Text style={styles.emoji}>{meta.emoji}</Text>
              <View style={styles.rowText}>
                <Text style={styles.description} numberOfLines={2}>
                  {s.description || 'Unknown'}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.distance, { color: distance.color }]}>
                    {distance.label}
                  </Text>
                  <View
                    style={[styles.categoryPill, { backgroundColor: catColor + '33' }]}>
                    <Text style={[styles.categoryPillText, { color: catColor }]}>
                      {cat.toLowerCase()}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.notedBtn, alreadyNoted && styles.notedBtnAcknowledged]}
                  onPress={() => patchSignal(s.id, 'active', new Date().toISOString())}
                  activeOpacity={0.7}>
                  <Text style={styles.notedBtnText}>
                    {alreadyNoted ? 'Noted ✓' : 'Noted'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.restBtn]}
                  onPress={() => patchSignal(s.id, 'resolved')}
                  activeOpacity={0.7}>
                  <Text style={styles.restBtnText}>Rest</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

      <TouchableOpacity
        style={styles.vaultLink}
        onPress={() => router.push('/vault')}
        activeOpacity={0.6}>
        <Text style={styles.vaultLinkText}>View Vault →</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.backLink}
        onPress={() => router.back()}
        activeOpacity={0.6}>
        <Text style={styles.backLinkText}>Return</Text>
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
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
    gap: 12,
  },
  emoji: {
    fontSize: 24,
    lineHeight: 28,
  },
  rowText: {
    flex: 1,
    gap: 6,
  },
  description: {
    color: OFF_WHITE,
    fontSize: 15,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  distance: {
    fontSize: 12,
    letterSpacing: 0.3,
  },
  categoryPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  categoryPillText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'lowercase',
  },
  actions: {
    flexDirection: 'column',
    gap: 6,
  },
  btn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 64,
  },
  notedBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BRASS,
  },
  notedBtnAcknowledged: {
    backgroundColor: BRASS + '22',
  },
  notedBtnText: {
    color: BRASS,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  restBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  restBtnText: {
    color: OFF_WHITE,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  backLink: {
    paddingTop: 16,
    alignItems: 'center',
  },
  topBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  topBackText: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  backLinkText: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  vaultLink: {
    paddingTop: 32,
    alignItems: 'center',
  },
  vaultLinkText: {
    color: BRASS,
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: '600',
  },
});
