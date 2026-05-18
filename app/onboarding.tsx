// Onboarding — two parallel tracks running concurrently:
//
//   Track 1 (background): /api/onboard pipeline. Kicked off on mount,
//     polled every 5s. We never block on it; the personalization
//     steps occupy the user's attention while the pipeline runs.
//
//   Track 2 (foreground): three personalization steps with a thin
//     brass progress bar at the top.
//       Step 1 — Household type
//       Step 2 — Your Voice (tone / detail / humor with live preview)
//       Step 3 — Priorities (multi-select household focus areas)
//
// After step 3, if pipeline is still running we render an
// interstitial with cycling phrases and poll every 3s. Otherwise we
// go straight to /onboard-reveal.
//
// Both the pipeline start timestamp and the current step are
// persisted in AsyncStorage so a backgrounded app picks up where it
// left off without re-firing /api/onboard.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

const PROGRESS_DURATION_MS = 45000;
const STATUS_POLL_MS = 5000;
const INTERSTITIAL_POLL_MS = 3000;

const PIPELINE_START_KEY = 'onboard_pipeline_started_at';
const STEP_KEY = 'onboardingStep';

type Phase = 'step1' | 'step2' | 'step3' | 'interstitial';

type HouseholdType = 'single' | 'couple' | 'family' | 'rent_focus' | 'multigenerational' | 'roommates';
type OwnRent = 'own' | 'rent' | 'split';

type Tone = 'direct' | 'balanced' | 'warm';
type Detail = 'brief' | 'standard' | 'thorough';
type Humor = 'yes' | 'sometimes' | 'no';

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

const PRIORITY_OPTIONS = [
  { id: 'deadlines', label: '📅 Deadlines and renewals' },
  { id: 'kids', label: "👶 Kids' schedules" },
  { id: 'home', label: '🏠 Home maintenance' },
  { id: 'financial', label: '💰 Financial awareness' },
  { id: 'health', label: '❤️ Health and wellness' },
  { id: 'travel', label: '✈️ Travel planning' },
  { id: 'providers', label: '🔧 Service providers' },
  { id: 'deliveries', label: '📦 Deliveries and orders' },
  { id: 'essentials', label: '⚡ Just the essentials' },
];

// Big lookup table — every tone+detail+humor combo carries a
// hand-written preview sentence so the user can hear what they're
// asking for. Defined verbatim from the spec to preserve voice.
const VOICE_PREVIEW: Record<string, string> = {
  'direct+brief+yes': "HVAC tune-up due before June — Fort Lauderdale summers don't forgive procrastination.",
  'direct+brief+sometimes': 'HVAC tune-up due before June.',
  'direct+brief+no': 'HVAC tune-up due before June.',
  'direct+standard+yes': 'Your HVAC needs its annual tune-up before June — worth booking before every HVAC company in town is slammed.',
  'direct+standard+sometimes': 'Your HVAC needs its annual tune-up before June — book it soon.',
  'direct+standard+no': 'Your HVAC needs its annual tune-up before June.',
  'direct+thorough+yes': "Your HVAC is due for its annual tune-up before June. Fort Lauderdale HVAC demand spikes hard in summer — if you wait until July you'll pay premium rates and wait two weeks.",
  'direct+thorough+sometimes': 'Your HVAC is due for its annual tune-up before June. Demand spikes in summer so earlier is better.',
  'direct+thorough+no': 'Your HVAC is due for its annual tune-up before June. Summer demand is high so booking now is advisable.',
  'balanced+brief+yes': 'HVAC tune-up before June — the timing writes itself in South Florida.',
  'balanced+brief+sometimes': 'HVAC tune-up is due before June.',
  'balanced+brief+no': 'HVAC tune-up is due before June.',
  'balanced+standard+yes': 'Your HVAC is due for a tune-up before summer. Worth scheduling before the rush — and before the humidity has full opinions.',
  'balanced+standard+sometimes': 'Your HVAC is due for a tune-up before summer. Worth scheduling before the rush.',
  'balanced+standard+no': 'Your HVAC is due for a tune-up before summer. Worth scheduling ahead of peak demand.',
  'balanced+thorough+yes': "Your HVAC is coming up on its annual tune-up — worth getting ahead of it before Fort Lauderdale's summer arrives and every HVAC company in town disappears into the heat.",
  'balanced+thorough+sometimes': "Your HVAC is coming up on its annual tune-up — worth getting ahead of it before Fort Lauderdale's summer arrives and the schedule books out.",
  'balanced+thorough+no': 'Your HVAC is coming up on its annual tune-up. Getting ahead of it before summer peak demand is advisable.',
  'warm+brief+yes': 'HVAC tune-up coming up — South Florida summer is undefeated, so get ahead of it.',
  'warm+brief+sometimes': 'Your HVAC tune-up is coming up before summer.',
  'warm+brief+no': 'Your HVAC tune-up is coming up before summer.',
  'warm+standard+yes': 'Your HVAC is due for its tune-up before the heat arrives — and Fort Lauderdale heat is the kind that has opinions about whether your AC is ready.',
  'warm+standard+sometimes': 'Your HVAC is due for its annual tune-up before summer hits. Good time to get it sorted.',
  'warm+standard+no': 'Your HVAC is due for its annual tune-up before summer. A good time to get it scheduled.',
  'warm+thorough+yes': 'Your HVAC is coming up on its annual tune-up — worth getting ahead of it. Fort Lauderdale summers are genuinely relentless, and your AC being in good shape before June is the kind of thing that makes the whole season easier.',
  'warm+thorough+sometimes': 'Your HVAC is coming up on its annual tune-up — worth getting ahead of it before the summer heat arrives. Booking early means better availability and often better pricing too.',
  'warm+thorough+no': 'Your HVAC is coming up on its annual tune-up before summer. Scheduling ahead of peak demand is worthwhile — availability and pricing are both better in spring.',
};

export default function OnboardingScreen() {
  const [phase, setPhase] = useState<Phase>('step1');
  const [pickedType, setPickedType] = useState<HouseholdType | null>(null);
  const [ownRent, setOwnRent] = useState<OwnRent | null>(null);

  const [tone, setTone] = useState<Tone>('balanced');
  const [detail, setDetail] = useState<Detail>('standard');
  const [humor, setHumor] = useState<Humor>('sometimes');

  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [pipelineReady, setPipelineReady] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const progressMounted = useRef(false);

  // Persist current phase + load pipeline-started flag on mount.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STEP_KEY);
        if (saved === 'step1' || saved === 'step2' || saved === 'step3' || saved === 'interstitial') {
          setPhase(saved);
        }
      } catch { /* ignore */ }
    })();
    startPipeline();
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

  useEffect(() => {
    AsyncStorage.setItem(STEP_KEY, phase).catch(() => {});
  }, [phase]);

  async function startPipeline() {
    try {
      const existing = await AsyncStorage.getItem(PIPELINE_START_KEY);
      if (existing) return;
      await AsyncStorage.setItem(PIPELINE_START_KEY, String(Date.now()));
      await fetch(`${API_BASE}/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID }),
      });
    } catch { /* best-effort */ }
  }

  // Status polling — runs the whole time until pipelineReady.
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

  // Once interstitial reached AND pipeline complete → navigate.
  useEffect(() => {
    if (phase === 'interstitial' && pipelineReady) {
      const t = setTimeout(() => {
        clearOnboardingState();
        router.replace('/onboard-reveal' as never);
      }, 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, pipelineReady]);

  function clearOnboardingState() {
    AsyncStorage.multiRemove([PIPELINE_START_KEY, STEP_KEY]).catch(() => {});
  }

  // ---------- Step handlers ----------

  async function confirmStep1(t: HouseholdType, o: OwnRent) {
    setPickedType(t);
    if (t === 'rent_focus' && !ownRent) setOwnRent('rent');
    else setOwnRent(o);
    const card = TYPE_CARDS.find((c) => c.id === t);
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
    setPhase('step2');
  }

  async function confirmStep2() {
    const humorMapped = humor === 'sometimes' ? 'occasionally' : humor;
    try {
      await fetch(`${API_BASE}/signals?type=preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          preferences: {
            communicationTone: tone,
            communicationDetail: detail,
            communicationHumor: humorMapped,
          },
        }),
      });
    } catch { /* best-effort */ }
    setPhase('step3');
  }

  async function confirmStep3() {
    try {
      await fetch(`${API_BASE}/signals?type=priorities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          priorities: Array.from(picked),
        }),
      });
    } catch { /* best-effort */ }
    if (pipelineReady) {
      clearOnboardingState();
      router.replace('/onboard-reveal' as never);
    } else {
      setPhase('interstitial');
    }
  }

  function togglePriority(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const widthInterpolated = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const previewKey = `${tone}+${detail}+${humor}`;
  const preview = VOICE_PREVIEW[previewKey] || '';

  return (
    <View style={styles.container}>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: widthInterpolated }]} />
      </View>
      {pipelineReady ? <Text style={styles.readyChip}>Ready ✓</Text> : null}

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {phase === 'step1' ? (
          <Step1
            pickedType={pickedType}
            setPickedType={setPickedType}
            ownRent={ownRent}
            setOwnRent={setOwnRent}
            onContinue={(t, o) => confirmStep1(t, o)}
          />
        ) : null}

        {phase === 'step2' ? (
          <Step2
            tone={tone} setTone={setTone}
            detail={detail} setDetail={setDetail}
            humor={humor} setHumor={setHumor}
            preview={preview}
            onContinue={confirmStep2}
          />
        ) : null}

        {phase === 'step3' ? (
          <Step3
            picked={picked}
            onToggle={togglePriority}
            onContinue={confirmStep3}
          />
        ) : null}

        {phase === 'interstitial' ? (
          <InterstitialBlock pipelineReady={pipelineReady} />
        ) : null}

        {phase !== 'interstitial' ? (
          <StepDots active={phase === 'step1' ? 0 : phase === 'step2' ? 1 : 2} />
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---------- Step 1: Household type ----------

function Step1({
  pickedType, setPickedType,
  ownRent, setOwnRent,
  onContinue,
}: {
  pickedType: HouseholdType | null;
  setPickedType: (t: HouseholdType) => void;
  ownRent: OwnRent | null;
  setOwnRent: (o: OwnRent) => void;
  onContinue: (t: HouseholdType, o: OwnRent) => void;
}) {
  const canContinue = pickedType !== null && ownRent !== null;
  return (
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
              onPress={() => {
                setPickedType(c.id);
                if (c.id === 'rent_focus' && !ownRent) setOwnRent('rent');
              }}
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
        <View style={{ marginTop: 24 }}>
          <Text style={styles.smallTitle}>Do you own or rent your home?</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            {(['own', 'rent', 'split'] as OwnRent[]).map((o) => (
              <TouchableOpacity
                key={o}
                onPress={() => setOwnRent(o)}
                style={[styles.pill, ownRent === o && styles.pillActive]}>
                <Text style={[styles.pillLabel, ownRent === o && { color: BRASS, fontWeight: '600' }]}>
                  {o === 'own' ? 'Own' : o === 'rent' ? 'Rent' : 'Both'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={() => pickedType && ownRent && onContinue(pickedType, ownRent)}
        disabled={!canContinue}
        style={[styles.continueBtn, !canContinue && { opacity: 0.4 }]}>
        <Text style={styles.continueBtnText}>Continue →</Text>
      </TouchableOpacity>
    </>
  );
}

// ---------- Step 2: Your Voice with live preview ----------

function Step2({
  tone, setTone, detail, setDetail, humor, setHumor, preview, onContinue,
}: {
  tone: Tone; setTone: (t: Tone) => void;
  detail: Detail; setDetail: (d: Detail) => void;
  humor: Humor; setHumor: (h: Humor) => void;
  preview: string;
  onContinue: () => void;
}) {
  return (
    <>
      <Text style={styles.title}>How should Conductor talk to you?</Text>
      <Text style={styles.subtitle}>You can change this anytime in Your House.</Text>

      <SegRow
        label="Tone"
        options={[
          { value: 'direct', label: 'Direct' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'warm', label: 'Warm' },
        ]}
        value={tone}
        onChange={(v) => setTone(v as Tone)}
      />
      <SegRow
        label="Detail"
        options={[
          { value: 'brief', label: 'Brief' },
          { value: 'standard', label: 'Standard' },
          { value: 'thorough', label: 'Thorough' },
        ]}
        value={detail}
        onChange={(v) => setDetail(v as Detail)}
      />
      <SegRow
        label="Humor"
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'sometimes', label: 'Sometimes' },
          { value: 'no', label: 'No thanks' },
        ]}
        value={humor}
        onChange={(v) => setHumor(v as Humor)}
      />

      <View style={styles.previewCard}>
        <Text style={styles.previewLabel}>PREVIEW</Text>
        <Text style={styles.previewText}>{preview}</Text>
      </View>

      <TouchableOpacity onPress={onContinue} style={styles.continueBtn}>
        <Text style={styles.continueBtnText}>Continue →</Text>
      </TouchableOpacity>
    </>
  );
}

function SegRow({
  label, options, value, onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={styles.segLabel}>{label}</Text>
      <View style={styles.segWrap}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[styles.segPill, active && styles.segPillActive]}>
              <Text style={[styles.segPillText, active && { color: '#0f0f0f', fontWeight: '600' }]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ---------- Step 3: Priorities ----------

function Step3({
  picked, onToggle, onContinue,
}: {
  picked: Set<string>;
  onToggle: (id: string) => void;
  onContinue: () => void;
}) {
  return (
    <>
      <Text style={styles.title}>What does your household care about most?</Text>
      <Text style={styles.subtitle}>Conductor will lead with what matters to you.</Text>

      <View style={styles.priorityGrid}>
        {PRIORITY_OPTIONS.map((p) => {
          const active = picked.has(p.id);
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => onToggle(p.id)}
              style={[styles.priorityPill, active && styles.priorityPillActive]}>
              <Text style={[styles.priorityLabel, active && { color: BRASS, fontWeight: '600' }]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity onPress={onContinue} style={styles.continueBtn}>
        <Text style={styles.continueBtnText}>Continue →</Text>
      </TouchableOpacity>
    </>
  );
}

// ---------- Interstitial: cycling phrases ----------

function InterstitialBlock({ pipelineReady }: { pipelineReady: boolean }) {
  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    const cycle = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(2000),
        Animated.timing(opacity, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
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

// ---------- Step indicator dots ----------

function StepDots({ active }: { active: 0 | 1 | 2 }) {
  return (
    <View style={styles.dotsRow}>
      {[0, 1, 2].map((i) => {
        const state = i === active ? 'active' : i < active ? 'done' : 'upcoming';
        return (
          <View
            key={i}
            style={[
              styles.dot,
              state === 'active' && styles.dotActive,
              state === 'done' && styles.dotDone,
            ]}
          />
        );
      })}
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
  progressFill: { height: '100%', backgroundColor: BRASS },
  readyChip: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 36,
    right: 18,
    color: MUTED,
    fontSize: 11,
    letterSpacing: 0.4,
  },

  scroll: { paddingHorizontal: 22, paddingTop: 60, paddingBottom: 60 },
  preface: { color: MUTED, fontSize: 13, fontStyle: 'italic', marginBottom: 18, lineHeight: 20 },
  title: { color: OFF_WHITE, fontSize: 24, fontWeight: '400', lineHeight: 32, marginBottom: 12 },
  smallTitle: { color: OFF_WHITE, fontSize: 16, fontWeight: '500', marginBottom: 6 },
  subtitle: { color: MUTED, fontSize: 12, marginBottom: 24, lineHeight: 18 },

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
  cardActive: { borderColor: BRASS, backgroundColor: 'rgba(184,150,12,0.08)' },
  cardEmoji: { fontSize: 28, marginBottom: 8 },
  cardLabel: { color: OFF_WHITE, fontSize: 14, fontWeight: '600' },
  cardDesc: { color: FAINT, fontSize: 11, marginTop: 4, lineHeight: 16 },

  pill: {
    paddingVertical: 9, paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth, borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  pillActive: { borderColor: BRASS, backgroundColor: 'rgba(184,150,12,0.08)' },
  pillLabel: { color: FAINT, fontSize: 13 },

  segLabel: { color: MUTED, fontSize: 10, letterSpacing: 1.5, marginBottom: 8, fontWeight: '600' },
  segWrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 3,
  },
  segPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  segPillActive: { backgroundColor: BRASS },
  segPillText: { color: MUTED, fontSize: 12 },

  previewCard: {
    marginTop: 8,
    marginBottom: 20,
    padding: 16,
    paddingLeft: 18,
    backgroundColor: 'rgba(184,150,12,0.06)',
    borderLeftWidth: 2,
    borderLeftColor: BRASS,
    borderRadius: 8,
  },
  previewLabel: { color: MUTED, fontSize: 9, letterSpacing: 2, marginBottom: 8, fontWeight: '600' },
  previewText: { color: OFF_WHITE, fontSize: 14, lineHeight: 22, fontStyle: 'italic' },

  priorityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  priorityPill: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth, borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  priorityPillActive: { borderColor: BRASS, backgroundColor: 'rgba(184,150,12,0.08)' },
  priorityLabel: { color: OFF_WHITE, fontSize: 13 },

  continueBtn: {
    marginTop: 32,
    backgroundColor: BRASS,
    paddingVertical: 14,
    borderRadius: 26,
    alignItems: 'center',
  },
  continueBtnText: { color: '#0f0f0f', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 28,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: MUTED, backgroundColor: 'transparent',
  },
  dotActive: { backgroundColor: BRASS, borderColor: BRASS, width: 22 },
  dotDone: { borderColor: BRASS, backgroundColor: 'transparent' },

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
