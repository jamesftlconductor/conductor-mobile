// Household profile setup — captures household shape (single/couple/
// family/roommates/multigenerational/other) + own/rent. Posts to
// /api/signals?type=profile, then either router.replace to the next
// onboarding step or router.back() if invoked from Settings.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useUserId } from '@/hooks/useUserId';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const FAINT = '#a8a5a0';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

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
          <Text style={styles.ownRentTitle}>Do you own or rent your home?</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 22, paddingTop: 80, paddingBottom: 60 },
  topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, fontSize: 13, letterSpacing: 0.3 },
  title: { color: OFF_WHITE, fontSize: 24, fontWeight: '400', marginTop: 14, lineHeight: 32 },
  subtitle: { color: MUTED, fontSize: 13, marginTop: 6, marginBottom: 28 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    width: '48%',
    padding: 18,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    minHeight: 130,
  },
  cardActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184,150,12,0.08)',
  },
  cardEmoji: { fontSize: 28, marginBottom: 8 },
  cardLabel: { color: OFF_WHITE, fontSize: 14, fontWeight: '600' },
  cardDesc: { color: FAINT, fontSize: 11, marginTop: 4, lineHeight: 16 },

  ownRentBlock: { marginTop: 28 },
  ownRentTitle: {
    color: OFF_WHITE, fontSize: 14, fontWeight: '500', marginBottom: 12,
  },
  ownRentRow: { flexDirection: 'row', gap: 8 },
  ownRentPill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  ownRentPillActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184,150,12,0.08)',
  },
  ownRentLabel: { color: FAINT, fontSize: 13 },

  continueBtn: {
    marginTop: 36,
    backgroundColor: BRASS,
    paddingVertical: 16,
    borderRadius: 26,
    alignItems: 'center',
  },
  continueBtnText: {
    color: '#0f0f0f',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
