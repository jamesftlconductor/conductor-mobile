// Conductor Junior — child-facing interface. Warm, large-text, voice-first.
//
// Voice relay uses iOS/Android native dictation via the keyboard — we
// don't ship a separate STT module. Tapping the big mic button opens
// a TextInput with autoFocus, the child taps the dictation button on
// the keyboard, speaks, and we send the resulting text to
// /api/signals?type=junior-voice for Haiku intent classification.
//
// Routes: /junior (with optional ?userId override; defaults to the
// configured JUNIOR_USER_ID env baked in or the current user id from
// storage).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useUserId } from '@/hooks/useUserId';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonStack } from '@/components/SkeletonRow';
import { PulsingCMark } from '@/components/PulsingCMark';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { conductorHaptics } from './haptics';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

// Semantic success color — chore completion. Carries meaning
// independent of palette, so it does NOT flip with the theme.
const GREEN = '#86efac';

type Chore = {
  name: string;
  frequency: 'daily' | 'weekly';
  completedDates?: string[];
};

type Badge = {
  id: string;
  name: string;
  description: string;
  earnedAt?: string;
};

type JuniorData = {
  ok: boolean;
  name: string;
  streak: number;
  chores: Chore[];
  savingsGoal: { description: string; targetAmount: number; currentAmount: number } | null;
  allowanceWeekly: number | null;
  badges: Badge[];
  badgesAvailable: Badge[];
  attributedSignals: Array<{ description: string }>;
};

const CATEGORY_PROMPTS: Record<string, string> = {
  supply_needed: 'What do you need for school?',
  schedule_change: "What's changed?",
  allowance_request: 'What do you want to ask for?',
  other: 'Tell Mom & Dad…',
};

function streakMessage(n: number): string {
  if (n === 0) return 'Start your streak today!';
  if (n < 7) return 'Keep it going!';
  if (n < 14) return 'One week strong! 🔥';
  if (n < 30) return "Two weeks — you're crushing it!";
  return 'Legendary streak 🏆';
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function JuniorScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const MUTED = theme.muted;
  const [userId, setUserId] = useState<string>('');
  const [data, setData] = useState<JuniorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceCategory, setVoiceCategory] = useState<string | null>(null);
  const [voiceText, setVoiceText] = useState('');
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const activeUserId = useUserId();
  useEffect(() => {
    // Junior screen reads the active userId from the shared hook so
    // it stays in lockstep with the rest of the app. A future PIN-gate
    // could overlay a stored junior userId on top of this.
    setUserId(activeUserId || '');
  }, [activeUserId]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/signals?type=junior&userId=${encodeURIComponent(userId)}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error || `Status ${res.status}`);
        setData(null);
      } else {
        setData(json as JuniorData);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  function openVoice(category: string | null) {
    setVoiceCategory(category);
    setVoiceText('');
    setLastSent(null);
    setVoiceOpen(true);
  }

  async function sendVoice() {
    if (!voiceText.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=junior-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, transcript: voiceText.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        Alert.alert('Could not send', json?.error || `Status ${res.status}`);
        return;
      }
      conductorHaptics.signalRested();
      setLastSent(voiceText.trim());
      setVoiceText('');
      setTimeout(() => setVoiceOpen(false), 1200);
      load();
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setSending(false);
    }
  }

  async function completeChore(chore: Chore) {
    const today = todayKey();
    if ((chore.completedDates || []).includes(today)) return;
    conductorHaptics.choreDone();
    // Optimistic update
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        chores: prev.chores.map((c) =>
          c.name === chore.name
            ? { ...c, completedDates: [...(c.completedDates || []), today] }
            : c
        ),
      };
    });
    try {
      const res = await fetch(`${API_BASE}/signals?type=chore-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, choreName: chore.name, completedDate: today }),
      });
      const json = await res.json();
      if (res.ok && typeof json?.streak === 'number') {
        setData((prev) => prev ? { ...prev, streak: json.streak } : prev);
        if ([7, 14, 30].includes(json.streak)) {
          conductorHaptics.streakMilestone();
        }
      }
    } catch {
      // Network failure — reload to reconcile.
      load();
    }
  }

  if (loading && !data) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Conductor Junior" subtitle="Loading…" />
        <SkeletonStack rows={5} />
      </View>
    );
  }

  if (error === 'junior_not_configured') {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Conductor Junior" subtitle="Not set up for this account yet." />
        <EmptyState
          message="A parent can enable Junior from a child's Crew card and assign chores, allowance, and a savings goal."
        />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Conductor Junior" subtitle="Couldn't load." />
        <EmptyState
          message={error || "We couldn't reach Conductor just now. Give it another try."}
          actionLabel="Try again"
          onAction={load}
        />
      </View>
    );
  }

  const earnedIds = new Set((data.badges || []).map((b) => b.id));
  const today = todayKey();
  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <View style={styles.container}>
      <ScreenHeader title={`Hi ${data.name || 'there'}! 👋`} subtitle={todayDate} />
      <ScrollView contentContainerStyle={styles.scroll}>

      <View style={styles.streakCard}>
        <Text style={styles.streakNumber}>{data.streak}</Text>
        <Text style={styles.streakUnit}>days in a row ⚡</Text>
        <Text style={styles.streakMsg}>{streakMessage(data.streak)}</Text>
      </View>

      <TouchableOpacity
        onPress={() => openVoice(null)}
        activeOpacity={0.7}
        style={styles.voiceWrap}>
        <View style={styles.voiceCircle}>
          <Text style={styles.voiceIcon}>🎤</Text>
        </View>
        <Text style={styles.voiceLabel}>Tap to speak</Text>
        <Text style={styles.voiceHint}>or type a message to Mom & Dad</Text>
      </TouchableOpacity>

      {data.chores && data.chores.length > 0 ? (
        <View style={styles.sectionBlock}>
          <SectionLabel title="My Chores" />
          {data.chores.map((c) => {
            const done = (c.completedDates || []).includes(today);
            return (
              <TouchableOpacity
                key={c.name}
                onPress={() => completeChore(c)}
                disabled={done}
                style={[styles.choreCard, done && styles.choreCardDone]}>
                <View style={styles.choreBody}>
                  <Text style={[styles.choreName, done && styles.choreNameDone]}>
                    {c.name}
                  </Text>
                  <Text style={styles.choreFreq}>
                    {c.frequency === 'daily' ? 'Daily' : 'Weekly'}
                  </Text>
                </View>
                <View style={[styles.choreCheck, done && styles.choreCheckDone]}>
                  <Text style={styles.choreCheckText}>{done ? '✓' : ''}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      <View style={styles.sectionBlock}>
        <SectionLabel title="Tell Mom & Dad" />
        <View style={styles.categoryGrid}>
          <CategoryBtn label="📚 Need something for school" onPress={() => openVoice('supply_needed')} />
          <CategoryBtn label="📅 Schedule changed" onPress={() => openVoice('schedule_change')} />
          <CategoryBtn label="💰 Need allowance" onPress={() => openVoice('allowance_request')} />
          <CategoryBtn label="📣 Other news" onPress={() => openVoice('other')} />
        </View>
      </View>

      {data.savingsGoal ? (
        <View style={styles.sectionBlock}>
          <SectionLabel title="My Savings" />
          <View style={styles.savingsCard}>
            <View style={styles.savingsBar}>
              <View
                style={[
                  styles.savingsFill,
                  {
                    width: `${Math.min(100, Math.round(
                      (data.savingsGoal.currentAmount / Math.max(1, data.savingsGoal.targetAmount)) * 100
                    ))}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.savingsText}>
              ${data.savingsGoal.currentAmount} saved of ${data.savingsGoal.targetAmount} goal
            </Text>
            <Text style={styles.savingsGoal}>{data.savingsGoal.description}</Text>
            {data.allowanceWeekly ? (
              <Text style={styles.savingsAllowance}>
                ${data.allowanceWeekly}/week allowance
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.sectionBlock}>
        <SectionLabel title="My Badges" />
        <View style={styles.badgeGrid}>
          {(data.badgesAvailable || []).map((b) => {
            const earned = earnedIds.has(b.id);
            return (
              <View key={b.id} style={[styles.badgeCard, !earned && styles.badgeCardLocked]}>
                <Text style={[styles.badgeEmoji, !earned && { opacity: 0.3 }]}>
                  {badgeEmoji(b.id)}
                </Text>
                <Text style={[styles.badgeName, !earned && { color: MUTED }]}>
                  {b.name}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ height: 40 }} />

      <Modal visible={voiceOpen} transparent animationType="fade" onRequestClose={() => setVoiceOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setVoiceOpen(false)}>
          <Pressable style={styles.voiceModal} onPress={() => {}}>
            {lastSent ? (
              <View style={styles.sentBlock}>
                <Text style={styles.sentTitle}>Sent ✓</Text>
                <Text style={styles.sentBody}>{lastSent}</Text>
                <Text style={styles.sentMeta}>Mom & Dad will see this in their brief.</Text>
              </View>
            ) : (
              <>
                <Text style={styles.modalTitle}>
                  {voiceCategory && CATEGORY_PROMPTS[voiceCategory]
                    ? CATEGORY_PROMPTS[voiceCategory]
                    : 'Tell Conductor'}
                </Text>
                <Text style={styles.modalHint}>
                  Tap the mic on your keyboard to talk, or just type.
                </Text>
                <TextInput
                  value={voiceText}
                  onChangeText={setVoiceText}
                  placeholder="Say something…"
                  placeholderTextColor={MUTED}
                  multiline
                  autoFocus
                  style={styles.modalInput}
                />
                <View style={styles.modalBtnRow}>
                  <TouchableOpacity
                    onPress={() => setVoiceOpen(false)}
                    style={styles.modalSecondaryBtn}>
                    <Text style={styles.modalSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={sendVoice}
                    disabled={sending || !voiceText.trim()}
                    style={[
                      styles.modalPrimaryBtn,
                      (sending || !voiceText.trim()) && { opacity: 0.5 },
                    ]}>
                    {sending ? (
                      <PulsingCMark size={18} />
                    ) : (
                      <Text style={styles.modalPrimaryText}>Send</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      </ScrollView>
    </View>
  );
}

function CategoryBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  return (
    <TouchableOpacity onPress={onPress} style={styles.categoryBtn} activeOpacity={0.7}>
      <Text style={styles.categoryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function badgeEmoji(id: string): string {
  switch (id) {
    case 'first_signal': return '⭐';
    case 'week_streak': return '🔥';
    case 'saver': return '💰';
    case 'organized': return '📚';
    case 'reliable': return '🏆';
    default: return '🎖️';
  }
}

type ThemeColors = {
  background: string;
  surface: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  inputBackground: string;
};

function makeStyles(theme: ThemeColors, accentColor: string) {
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  const FAINT = theme.muted;
  const BRASS = accentColor;
  // Accent-tinted hero surfaces (streak + badges). The accent is hex,
  // so blend it onto the theme surface rather than hardcoding a brass
  // rgba — keeps the warm emphasis while flipping with the palette.
  const accentTint = (alpha: number) => accentColor + Math.round(alpha * 255).toString(16).padStart(2, '0');
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 60 },
  topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, ...TOKENS.type.secondary, letterSpacing: 0.3 },

  title: { color: OFF_WHITE, ...TOKENS.type.header, fontSize: 28, lineHeight: 34, fontWeight: '500', marginTop: 14 },
  subtitle: { color: MUTED, ...TOKENS.type.secondary, marginTop: 6 },

  streakCard: {
    marginTop: TOKENS.space.section,
    padding: 22,
    borderRadius: TOKENS.card.borderRadius,
    backgroundColor: accentTint(0.10),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accentTint(0.4),
    alignItems: 'center',
  },
  streakNumber: { color: BRASS, fontSize: 48, fontWeight: '700', lineHeight: 54 },
  streakUnit: { color: OFF_WHITE, ...TOKENS.type.secondary, marginTop: 4, letterSpacing: 0.4 },
  streakMsg: { color: FAINT, ...TOKENS.type.secondary, fontSize: 12, marginTop: 10 },

  voiceWrap: { alignItems: 'center', marginTop: 32, marginBottom: 16 },
  voiceCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: BRASS,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BRASS,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  voiceIcon: { fontSize: 32 },
  voiceLabel: { color: OFF_WHITE, ...TOKENS.type.secondary, marginTop: 12, fontWeight: '500' },
  voiceHint: { color: MUTED, ...TOKENS.type.secondary, fontSize: 11, marginTop: 4 },

  sectionBlock: { marginTop: 8 },

  choreCard: {
    flexDirection: 'row', alignItems: 'center',
    minHeight: 44,
    padding: TOKENS.card.padding, borderRadius: TOKENS.card.borderRadius, marginBottom: 10,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  choreCardDone: { backgroundColor: 'rgba(134,239,172,0.08)', borderColor: 'rgba(134,239,172,0.3)' },
  choreBody: { flex: 1 },
  choreName: { color: OFF_WHITE, ...TOKENS.type.subheader, fontWeight: '500' },
  choreNameDone: { color: FAINT, textDecorationLine: 'line-through' },
  choreFreq: { color: MUTED, ...TOKENS.type.secondary, fontSize: 11, marginTop: 4 },
  choreCheck: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1.5, borderColor: MUTED,
    alignItems: 'center', justifyContent: 'center',
  },
  choreCheckDone: { backgroundColor: GREEN, borderColor: GREEN },
  choreCheckText: { color: '#0f0f0f', fontSize: 18, fontWeight: '700' },

  categoryGrid: { gap: 10 },
  categoryBtn: {
    minHeight: 44, justifyContent: 'center',
    padding: TOKENS.card.padding, borderRadius: TOKENS.card.borderRadius,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  categoryBtnText: { color: OFF_WHITE, ...TOKENS.type.body },

  savingsCard: {
    padding: TOKENS.card.padding, borderRadius: TOKENS.card.borderRadius,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  savingsBar: { height: 10, borderRadius: 5, backgroundColor: theme.inputBackground, overflow: 'hidden' },
  savingsFill: { height: '100%', backgroundColor: BRASS },
  savingsText: { color: OFF_WHITE, ...TOKENS.type.secondary, marginTop: 12, fontWeight: '500' },
  savingsGoal: { color: MUTED, ...TOKENS.type.secondary, fontSize: 12, marginTop: 4 },
  savingsAllowance: { color: FAINT, ...TOKENS.type.secondary, fontSize: 11, marginTop: 8 },

  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeCard: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: TOKENS.card.borderRadius,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: accentTint(0.08),
    borderWidth: StyleSheet.hairlineWidth, borderColor: accentTint(0.3),
  },
  badgeCardLocked: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  badgeEmoji: { fontSize: 28, marginBottom: 6 },
  badgeName: { color: OFF_WHITE, ...TOKENS.type.label, fontWeight: '500', letterSpacing: 0, textTransform: 'none', textAlign: 'center' },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  voiceModal: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 24, paddingBottom: 36,
  },
  modalTitle: { color: OFF_WHITE, ...TOKENS.type.subheader, fontSize: 18, fontWeight: '500' },
  modalHint: { color: MUTED, ...TOKENS.type.secondary, fontSize: 11, marginTop: 6, marginBottom: 18 },
  modalInput: {
    color: OFF_WHITE, ...TOKENS.type.body, lineHeight: 22,
    paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: theme.inputBackground,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    minHeight: 100, textAlignVertical: 'top',
  },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalPrimaryBtn: {
    flex: 1, minHeight: 44, paddingVertical: 14, borderRadius: 24,
    backgroundColor: BRASS, alignItems: 'center', justifyContent: 'center',
  },
  modalPrimaryText: { color: '#0f0f0f', ...TOKENS.type.body, fontWeight: '600' },
  modalSecondaryBtn: {
    flex: 1, minHeight: 44, paddingVertical: 14, borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center',
  },
  modalSecondaryText: { color: MUTED, ...TOKENS.type.body },

  sentBlock: { paddingVertical: 30, alignItems: 'center' },
  sentTitle: { color: BRASS, fontSize: 24, fontWeight: '500' },
  sentBody: { color: OFF_WHITE, ...TOKENS.type.secondary, marginTop: 14, textAlign: 'center', fontStyle: 'italic' },
  sentMeta: { color: MUTED, ...TOKENS.type.secondary, fontSize: 11, marginTop: 12 },
  });
}
