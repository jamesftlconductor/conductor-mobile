// Household profile setup — captures household shape (single/couple/
// family/roommates/multigenerational/other) + own/rent. Posts to
// /api/signals?type=profile, then either router.replace to the next
// onboarding step or router.back() if invoked from Settings.

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useUserId } from '@/hooks/useUserId';
import { SectionLabel } from '@/components/SectionLabel';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

type HouseholdType =
  | 'single'
  | 'couple'
  | 'family'
  | 'rent_focus'
  | 'multigenerational'
  | 'roommates';

type OwnRent = 'own' | 'rent' | 'split' | null;

const TYPE_CARDS: { id: HouseholdType; emoji: string; label: string; desc: string; mappedType: string }[] = [
  { id: 'single', emoji: '👤', label: 'Just me', desc: 'Personal intelligence, your way', mappedType: 'single' },
  { id: 'couple', emoji: '👫', label: 'Couple', desc: 'Coordinated household awareness', mappedType: 'couple' },
  { id: 'family', emoji: '👨‍👩‍👧', label: 'Family with kids', desc: 'Schedules, crew, and more', mappedType: 'family' },
  { id: 'rent_focus', emoji: '🏠', label: 'Renting', desc: 'Lease tracking and apartment life', mappedType: 'single' },
  { id: 'multigenerational', emoji: '👴', label: 'Multiple generations', desc: 'Health-forward household intelligence', mappedType: 'multigenerational' },
  { id: 'roommates', emoji: '🏢', label: 'Roommates', desc: 'Shared life, separate worlds', mappedType: 'roommates' },
];

export default function ProfileSetupScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const BRASS = accentColor;
  const params = useLocalSearchParams<{ next?: string }>();
  const [userId, setUserId] = useState<string>('');
  const [pickedType, setPickedType] = useState<HouseholdType | null>(null);
  const [ownOrRent, setOwnOrRent] = useState<OwnRent>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeUserId = useUserId();
  useEffect(() => {
    setUserId(activeUserId || '');
  }, [activeUserId]);

  // Renting card pre-selects rent for the second question — it's
  // already implied by the choice, but we surface the second question
  // anyway so a renter who's a roommate can still split.
  function pickType(t: HouseholdType) {
    setPickedType(t);
    if (t === 'rent_focus' && !ownOrRent) setOwnOrRent('rent');
  }

  const canContinue = pickedType !== null && ownOrRent !== null;

  async function submit() {
    if (!canContinue) return;
    const card = TYPE_CARDS.find((c) => c.id === pickedType);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          type: card?.mappedType || 'other',
          ownOrRent: ownOrRent === 'split' ? 'rent' : ownOrRent,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        Alert.alert('Could not save', json?.error || `Status ${res.status}`);
        return;
      }
      if (params?.next) router.replace(params.next as any);
      else router.back();
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {!params?.next ? (
        <TouchableOpacity onPress={() => router.back()} style={styles.topBack}>
          <Text style={styles.topBackText}>← Return</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.title}>Tell Conductor about your household</Text>
      <Text style={styles.subtitle}>This helps personalize your experience.</Text>

      <View style={styles.grid}>
        {TYPE_CARDS.map((c) => {
          const active = pickedType === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              onPress={() => pickType(c.id)}
              activeOpacity={0.7}
              style={[styles.card, active && styles.cardActive]}>
              <Text style={styles.cardEmoji}>{c.emoji}</Text>
              <Text style={[styles.cardLabel, active && { color: BRASS }]}>{c.label}</Text>
              <Text style={styles.cardDesc}>{c.desc}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {pickedType ? (
        <View style={styles.ownRentBlock}>
          <SectionLabel title="Do you own or rent?" />
          <View style={styles.ownRentRow}>
            {(['own', 'rent', 'split'] as OwnRent[]).map((o) => (
              <TouchableOpacity
                key={o}
                onPress={() => setOwnOrRent(o)}
                style={[styles.ownRentPill, ownOrRent === o && styles.ownRentPillActive]}>
                <Text
                  style={[
                    styles.ownRentLabel,
                    ownOrRent === o && { color: BRASS, fontWeight: '600' },
                  ]}>
                  {o === 'own' ? 'Own' : o === 'rent' ? 'Rent' : 'Both (split)'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={submit}
        disabled={!canContinue || submitting}
        style={[styles.continueBtn, (!canContinue || submitting) && { opacity: 0.4 }]}>
        <Text style={styles.continueBtnText}>
          {submitting ? 'Saving…' : 'Continue →'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
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
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  const FAINT = theme.muted;
  const BRASS = accentColor;
  // Accent-tinted selection state, blended onto theme so it flips
  // with the palette rather than hardcoding a brass rgba.
  const accentTint = (alpha: number) => accentColor + Math.round(alpha * 255).toString(16).padStart(2, '0');
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { paddingHorizontal: 20, paddingTop: 80, paddingBottom: 60 },
  topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, ...TOKENS.type.secondary, letterSpacing: 0.3 },
  title: { color: OFF_WHITE, ...TOKENS.type.header, fontSize: 24, lineHeight: 32, fontWeight: '400', marginTop: 14 },
  subtitle: { color: MUTED, ...TOKENS.type.secondary, marginTop: 6, marginBottom: 28 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    width: '48%',
    padding: TOKENS.card.padding,
    borderRadius: TOKENS.card.borderRadius,
    marginBottom: 12,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    minHeight: 130,
  },
  cardActive: {
    borderColor: BRASS,
    backgroundColor: accentTint(0.08),
  },
  cardEmoji: { fontSize: 28, marginBottom: 8 },
  cardLabel: { color: OFF_WHITE, ...TOKENS.type.body, fontWeight: '600' },
  cardDesc: { color: FAINT, ...TOKENS.type.label, fontSize: 11, fontWeight: '400', letterSpacing: 0.1, textTransform: 'none', lineHeight: 16, marginTop: 4 },

  ownRentBlock: { marginTop: 8 },
  ownRentRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  ownRentPill: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  ownRentPillActive: {
    borderColor: BRASS,
    backgroundColor: accentTint(0.08),
  },
  ownRentLabel: { color: FAINT, ...TOKENS.type.secondary },

  continueBtn: {
    marginTop: 36,
    minHeight: 44,
    backgroundColor: BRASS,
    paddingVertical: 16,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnText: {
    color: '#0f0f0f',
    ...TOKENS.type.body,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  });
}
