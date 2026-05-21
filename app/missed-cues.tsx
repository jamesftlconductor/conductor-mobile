import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { useTheme } from '@/app/theme';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { metaFor, Signal } from '@/components/signalTypes';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const AMBER = '#f59e0b';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Same logic the missedcues server endpoint uses for ordering: prefer
// lastUpdate (locale string from import.js / PATCH handler), fall back to
// signal.id (a Date.now() timestamp at import time). Returns label + color.
// The color thresholds match what the user requested — amber past 48h,
// brass past 7d, muted under 48h (carriedForward signals can land here
// younger than 48h via the carriedForward branch on the server).
function ageDescription(s: Signal, accentColor: string, muted: string): { label: string; color: string } {
  const lastMs = s.lastUpdate ? Date.parse(s.lastUpdate) : NaN;
  let ageMs = NaN;
  if (!isNaN(lastMs)) ageMs = Date.now() - lastMs;
  else if (typeof s.id === 'number' && s.id > 0) ageMs = Date.now() - s.id;

  if (isNaN(ageMs) || ageMs < 0) {
    return { label: 'unresolved', color: muted };
  }

  const days = Math.floor(ageMs / DAY_MS);
  const hours = Math.floor(ageMs / HOUR_MS);
  let label: string;
  if (days >= 1) label = `${days} day${days === 1 ? '' : 's'} unresolved`;
  else label = `${Math.max(1, hours)} hr${hours === 1 ? '' : 's'} unresolved`;

  let color: string;
  if (ageMs > 7 * DAY_MS) color = accentColor;
  else if (ageMs > 48 * HOUR_MS) color = AMBER;
  else color = muted;

  return { label, color };
}

export default function MissedCuesScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const BRASS = accentColor;
  const MUTED = theme.muted;
  const OFF_WHITE = theme.text;
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/signals?type=missedcues&userId=${USER_ID}`);
      if (!res.ok) return;
      const data = await res.json();
      setSignals(Array.isArray(data?.signals) ? data.signals : []);
    } catch {
      // Best-effort — keep current list on transient failures.
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

  // Optimistic remove so the row disappears immediately. PATCH happens after;
  // on failure the next pull-to-refresh will reconcile.
  async function patchSignal(id: Signal['id'], state: 'resolved' | 'active') {
    setSignals((prev) => prev.filter((s) => String(s.id) !== String(id)));
    try {
      await fetch(`${API_BASE}/signals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, state, userId: USER_ID }),
      });
    } catch {
      // Best-effort; reconcile on next refresh.
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={MUTED} />
      }>
      <Text style={styles.title}>Missed Cues</Text>
      <Text style={styles.subtitle}>Signals that went unresolved</Text>

      {loading && (
        <View style={styles.empty}>
          <ActivityIndicator color={MUTED} />
        </View>
      )}

      {!loading && signals.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Nothing missed. You&apos;re clear.</Text>
        </View>
      )}

      {!loading &&
        signals.map((s) => {
          const meta = metaFor(s);
          const age = ageDescription(s, accentColor, theme.muted);
          return (
            <View key={String(s.id)} style={styles.row}>
              <Text style={styles.emoji}>{meta.emoji}</Text>
              <View style={styles.rowText}>
                <Text style={styles.description} numberOfLines={2}>
                  {s.description || 'Unknown'}
                </Text>
                {!!s.sender && (
                  <Text style={styles.sender} numberOfLines={1}>
                    {s.sender}
                  </Text>
                )}
                <Text style={[styles.age, { color: age.color }]}>{age.label}</Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.restBtn]}
                  onPress={() => patchSignal(s.id, 'resolved')}
                  activeOpacity={0.7}>
                  <Text style={styles.restBtnText}>Rest</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.holdBtn]}
                  onPress={() => patchSignal(s.id, 'active')}
                  activeOpacity={0.7}>
                  <Text style={styles.holdBtnText}>Hold</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

      <TouchableOpacity
        style={styles.backLink}
        onPress={() => router.back()}
        activeOpacity={0.6}>
        <Text style={styles.backLinkText}>Return</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

type ThemeColors = { background: string; surface: string; text: string; muted: string };

function makeStyles(theme: ThemeColors, accentColor: string) {
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  const BRASS = accentColor;
  return StyleSheet.create({
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
    gap: 2,
  },
  description: {
    color: OFF_WHITE,
    fontSize: 15,
    lineHeight: 20,
  },
  sender: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  age: {
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.3,
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
    minWidth: 56,
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
  holdBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  holdBtnText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
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
}
