// Onboarding — two parallel tracks running concurrently:
//
//   Track 1 (background): /api/onboard pipeline. Kicked off on mount,
//     polled every 5s. We never block on it; the personalization steps
//     occupy the user's attention while the pipeline runs.
//
//   Track 2 (foreground): 3 personalization steps — household type,
//     own/rent, notifications. Each step advances when the user picks.
//
// After step 3:
//   - If pipeline already complete → straight to /onboard-reveal
//   - Else → interstitial with cycling phrases, polled every 3s.
//     Navigates to /onboard-reveal the moment status flips complete.
//
// Pipeline start time is persisted in AsyncStorage so a re-mount
// (backgrounded app, etc.) doesn't restart the pipeline.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const API_BASE = 'https://conductor-ivory.vercel.app/api';
const USER_ID = 'james_totalhome_gmail_com';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const FAINT = '#a8a5a0';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

// Progress bar fills 0 → 90% over PROGRESS_DURATION_MS. Jumps to
// 100% only when the pipeline reports complete.
const PROGRESS_DURATION_MS = 45000;
const STATUS_POLL_MS = 5000;
const INTERSTITIAL_POLL_MS = 3000;

const PIPELINE_START_KEY = 'onboard_pipeline_started_at';

type Phase = 'step1' | 'step2' | 'step3' | 'interstitial';

type HouseholdType = 'single' | 'couple' | 'family' | 'rent_focus' | 'multigenerational' | 'roommates';
type OwnRent = 'own' | 'rent' | 'split';

const TYPE_CARDS: {
  id: HouseholdType;
  emoji: string;
  label: string;
  desc: string;
  mappedType: string;
}[] = [
  { id: 'single', emoji: '👤', label: 'Just me', desc: 'Personal intelligence, your way', mappedType: 'single' },
  { id: 'couple', emoji: '👫', label: 'Couple', desc: 'Coordinated household awareness', mappedType: 'couple' },
  { id: 'family', emoji: '👨‍👩‍👧', label: 'Family with kids', desc: 'Schedules, crew, and more', mappedType: 'family' },
  { id: 'rent_focus', emoji: '🏠', label: 'Renting', desc: 'Lease tracking and apartment life', mappedType: 'single' },
  { id: 'multigenerational', emoji: '👴', label: 'Multiple generations', desc: 'Health-forward household intelligence', mappedType: 'multigenerational' },
  { id: 'roommates', emoji: '🏢', label: 'Roommates', desc: 'Shared life, separate worlds', mappedType: 'roommates' },
];

const INTERSTITIAL_PHRASES = [
  'Reading your recent emails…',
  'Building your signal picture…',
  'Checking your calendar…',
  'Almost ready…',
];

export default function OnboardingScreen() {
  const [phase, setPhase] = useState<Phase>('step1');
  const [pickedType, setPickedType] = useState<HouseholdType | null>(null);
  const [ownRent, setOwnRent] = useState<OwnRent | null>(null);
  const [notifChoice, setNotifChoice] = useState<'allow' | 'skip' | null>(null);

  const [pipelineReady, setPipelineReady] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const progressMounted = useRef(false);

  // Kick pipeline + start progress on mount.
  useEffect(() => {
    startPipeline();
    // Animate to 90% over PROGRESS_DURATION_MS. The final 10% jumps
    // only when the pipeline reports complete (or we navigate away).
    if (!progressMounted.current) {
      progressMounted.current = true;
      Animated.timing(progress, {
        toValue: 0.9,
        duration: PROGRESS_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startPipeline() {
    try {
      const existing = await AsyncStorage.getItem(PIPELINE_START_KEY);
      if (existing) {
        // Already started in a prior session — just resume polling.
        return;
      }
      await AsyncStorage.setItem(PIPELINE_START_KEY, String(Date.now()));
      await fetch(`${API_BASE}/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID }),
      });
    } catch {
      // best-effort — pipeline is also kicked from callback.tsx on
      // OAuth complete, so a network blip here isn't fatal.
    }
  }

  // Status polling — runs the whole time. Stops once pipelineReady.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || pipelineReady) return;
      try {
        const res = await fetch(`${API_BASE}/onboard?userId=${USER_ID}`);
        const data = await res.json();
        const state = data?.status?.state;
        if (state === 'complete' || state === 'completed' || data?.status?.finishedAt) {
          if (cancelled) return;
          setPipelineReady(true);
          Animated.timing(progress, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }).start();
          return;
        }
      } catch { /* keep polling */ }
      const next = phase === 'interstitial' ? INTERSTITIAL_POLL_MS : STATUS_POLL_MS;
      timer = setTimeout(poll, next);
    };
    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, pipelineReady, progress]);

  // Auto-navigate to reveal once interstitial + pipeline complete.
  useEffect(() => {
    if (phase === 'interstitial' && pipelineReady) {
      // Small delay so the user sees the 100% bar before navigating.
      const t = setTimeout(() => {
        AsyncStorage.removeItem(PIPELINE_START_KEY).catch(() => {});
        router.replace('/onboard-reveal' as never);
      }, 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, pipelineReady]);

  // ---------- Step handlers ----------

  async function confirmStep1(t: HouseholdType) {
    setPickedType(t);
    if (t === 'rent_focus') setOwnRent('rent');
    setPhase('step2');
  }

  async function confirmStep2(o: OwnRent) {
    setOwnRent(o);
    // Persist profile choice mid-flow so the brief.js voice rules
    // are in effect by the time the first brief generates.
    const card = TYPE_CARDS.find((c) => c.id === pickedType);
    try {
      await fetch(`${API_BASE}/signals?type=profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          type: card?.mappedType || 'other',
          ownOrRent: o === 'split' ? 'rent' : o,
        }),
      });
    } catch { /* best-effort */ }
    setPhase('step3');
  }

  async function confirmStep3(choice: 'allow' | 'skip') {
    setNotifChoice(choice);
    if (pipelineReady) {
      router.replace('/onboard-reveal' as never);
      AsyncStorage.removeItem(PIPELINE_START_KEY).catch(() => {});
    } else {
      setPhase('interstitial');
    }
  }

  // ---------- Render ----------

  const widthInterpolated = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      {/* Progress bar — always at the very top. */}
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: widthInterpolated }]} />
      </View>
      {pipelineReady ? (
        <Text style={styles.readyChip}>Ready ✓</Text>
      ) : null}

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {phase === 'step1' ? (
          <>
            <Text style={styles.preface}>
              While Conductor reads your household — tell us a little about yourself.
            </Text>
            <Text style={styles.title}>Which describes you best?</Text>
            <View style={styles.grid}>
              {TYPE_CARDS.map((c) => {
                const active = pickedType === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => confirmStep1(c.id)}
                    activeOpacity={0.7}
                    style={[styles.card, active && styles.cardActive]}>
                    <Text style={styles.cardEmoji}>{c.emoji}</Text>
                    <Text style={[styles.cardLabel, active && { color: BRASS }]}>{c.label}</Text>
                    <Text style={styles.cardDesc}>{c.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        {phase === 'step2' ? (
          <>
            <Text style={styles.preface}>Step 2 of 3</Text>
            <Text style={styles.title}>Do you own or rent your home?</Text>
            <View style={styles.bigChoiceColumn}>
              {(['own', 'rent', 'split'] as OwnRent[]).map((o) => (
                <TouchableOpacity
                  key={o}
                  onPress={() => confirmStep2(o)}
                  activeOpacity={0.7}
                  style={[styles.bigChoice, ownRent === o && styles.bigChoiceActive]}>
                  <Text
                    style={[
                      styles.bigChoiceLabel,
                      ownRent === o && { color: BRASS, fontWeight: '600' },
                    ]}>
                    {o === 'own' ? 'Own' : o === 'rent' ? 'Rent' : 'Both (split)'}
                  </Text>
                  <Text style={styles.bigChoiceDesc}>
                    {o === 'own'
                      ? 'Maintenance plan + full inventory'
                      : o === 'rent'
                      ? 'Lease tracking + apartment scale'
                      : 'A bit of both'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {phase === 'step3' ? (
          <>
            <Text style={styles.preface}>Step 3 of 3</Text>
            <Text style={styles.title}>Morning briefs at 7am.</Text>
            <Text style={styles.copy}>
              Conductor sends one push notification each morning — your
              brief. You can adjust quiet hours and additional reminders
              later from Your House.
            </Text>
            <View style={styles.bigChoiceColumn}>
              <TouchableOpacity
                onPress={() => confirmStep3('allow')}
                activeOpacity={0.7}
                style={[styles.bigChoice, styles.bigChoiceBrass]}>
                <Text style={styles.bigChoiceBrassLabel}>Allow notifications</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => confirmStep3('skip')}
                activeOpacity={0.6}
                style={styles.skipBtn}>
                <Text style={styles.skipBtnText}>Skip for now</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {phase === 'interstitial' ? (
          <InterstitialBlock pipelineReady={pipelineReady} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function InterstitialBlock({ pipelineReady }: { pipelineReady: boolean }) {
  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    const cycle = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (cancelled || !finished) return;
        setIdx((i) => (i + 1) % INTERSTITIAL_PHRASES.length);
        cycle();
      });
    };
    cycle();
    return () => { cancelled = true; };
  }, [opacity]);

  return (
    <View style={styles.interstitialWrap}>
      <ActivityIndicator color={BRASS} />
      <Animated.Text style={[styles.interstitialPhrase, { opacity }]}>
        {pipelineReady ? 'Ready.' : INTERSTITIAL_PHRASES[idx]}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginTop: Platform.OS === 'ios' ? 44 : 28,
  },
  progressFill: {
    height: '100%',
    backgroundColor: BRASS,
  },
  readyChip: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 36,
    right: 18,
    color: MUTED,
    fontSize: 11,
    letterSpacing: 0.4,
  },

  scroll: {
    paddingHorizontal: 22,
    paddingTop: 60,
    paddingBottom: 60,
  },
  preface: {
    color: MUTED,
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 18,
    lineHeight: 20,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 24,
    fontWeight: '400',
    lineHeight: 32,
    marginBottom: 28,
  },
  copy: {
    color: FAINT,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 28,
  },

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

  bigChoiceColumn: { gap: 12 },
  bigChoice: {
    padding: 18,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  bigChoiceActive: { borderColor: BRASS, backgroundColor: 'rgba(184,150,12,0.08)' },
  bigChoiceLabel: { color: OFF_WHITE, fontSize: 16, fontWeight: '500' },
  bigChoiceDesc: { color: FAINT, fontSize: 12, marginTop: 4 },
  bigChoiceBrass: {
    backgroundColor: BRASS,
    borderColor: BRASS,
    alignItems: 'center',
    paddingVertical: 16,
  },
  bigChoiceBrassLabel: { color: '#0f0f0f', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
  skipBtn: { paddingVertical: 14, alignItems: 'center' },
  skipBtnText: { color: MUTED, fontSize: 13 },

  interstitialWrap: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  interstitialPhrase: {
    color: OFF_WHITE,
    fontSize: 16,
    fontWeight: '300',
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: 24,
    maxWidth: 280,
  },
});
