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
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';
import { useUserId } from '@/hooks/useUserId';
import { TOKENS } from '@/utils/designTokens';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

// Module-level palette consts — retained for the connect-gate +
// interstitial, which were intentionally NOT migrated to theme.
// Step screens use makeStepStyles(theme, accentColor) instead.
const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const FAINT = '#a8a5a0';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  inputBackground: string;
};

// Convert an accent hex to an rgba tint at the given opacity — used
// for the soft active-state fills on step-screen cards/pills.
function accentRgba(accentColor: string, opacity: number): string {
  const hex = accentColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

type StepStyles = ReturnType<typeof makeStepStyles>;

const PROGRESS_DURATION_MS = 45000;
const STATUS_POLL_MS = 5000;
const INTERSTITIAL_POLL_MS = 3000;

const PIPELINE_START_KEY = 'onboard_pipeline_started_at';
const STEP_KEY = 'onboardingStep';

type Phase = 'joining' | 'language' | 'step1' | 'step2' | 'step3' | 'step4' | 'interstitial';
type Language = 'en' | 'es';

type Who = 'solo' | 'couple' | 'family' | 'multigenerational' | 'investment_property';
type Housing = 'own' | 'rent' | 'living_with_family';
type Modifier = 'has_pets' | 'co_parent' | 'health_needs' | 'major_change' | 'students' | 'work_from_home';

type Tone = 'direct' | 'balanced' | 'warm';
type Detail = 'brief' | 'standard' | 'thorough';
type Humor = 'yes' | 'sometimes' | 'no';

const WHO_CARDS: { id: Who; emoji: string; label: string; sub?: string }[] = [
  { id: 'solo', emoji: '👤', label: 'Just me' },
  { id: 'couple', emoji: '👫', label: 'Two adults', sub: 'Couple or partners' },
  { id: 'family', emoji: '👨‍👩‍👧', label: 'With children', sub: 'Kids in the household' },
  { id: 'multigenerational', emoji: '👴', label: 'Multiple generations', sub: 'Parents or grandparents too' },
  { id: 'investment_property', emoji: '🏢', label: 'Investment Property', sub: 'Rental or vacation property' },
];

const HOUSING_CARDS: { id: Housing; emoji: string; label: string }[] = [
  { id: 'own', emoji: '🏠', label: 'Own' },
  { id: 'rent', emoji: '🏢', label: 'Rent' },
  { id: 'living_with_family', emoji: '🏡', label: 'Living with family' },
];

const MODIFIER_OPTIONS: { id: Modifier; label: string }[] = [
  { id: 'has_pets', label: 'We have pets' },
  { id: 'co_parent', label: 'I co-parent (shared custody)' },
  { id: 'health_needs', label: 'Someone has ongoing health needs' },
  { id: 'major_change', label: "We're going through a major life change" },
  { id: 'students', label: "We're students" },
  { id: 'work_from_home', label: 'We work from home' },
];

// Interstitial copy — categorized so the cycler can rotate through
// different beats (what Conductor is doing → privacy reassurance →
// product expectation → trust). The rotation by category ensures the
// user never sees the same category twice in a row even with single-
// phrase pools, and that the texture of the wait feels intentional
// rather than a four-string carousel.
type InterstitialPhrase = { category: 'doing' | 'privacy' | 'personality' | 'reassurance'; text: string };

const INTERSTITIAL_PHRASES: InterstitialPhrase[] = [
  // What Conductor is actually doing right now.
  { category: 'doing', text: 'Reading your inbox for signals that matter.' },
  { category: 'doing', text: 'Looking for deadlines, renewals, and things that need attention.' },
  { category: 'doing', text: 'Checking your calendar for conflicts and upcoming events.' },
  { category: 'doing', text: 'Finding your service providers and adding them to your household.' },
  { category: 'doing', text: "Building your household's signal picture for the first time." },
  // Privacy / trust.
  { category: 'privacy', text: 'Conductor reads signals. It never stores the content of your emails.' },
  { category: 'privacy', text: 'Your data lives in your household. Never shared, never sold.' },
  { category: 'privacy', text: 'Everything Conductor sees is in service of your morning brief. Nothing else.' },
  // Brand personality + what to expect.
  { category: 'personality', text: 'Tomorrow morning at 7am, your first brief arrives.' },
  { category: 'personality', text: 'The Conductor is thorough. This first scan sets the foundation.' },
  { category: 'personality', text: 'Most households surface 15-30 signals on day one.' },
  { category: 'personality', text: 'The brief gets smarter every day as Conductor learns your household.' },
  // Reassurance about the wait itself.
  { category: 'reassurance', text: 'This only happens once. Future syncs run quietly in the background.' },
  { category: 'reassurance', text: 'Almost there. The first scan is the most thorough one.' },
  { category: 'reassurance', text: 'Worth the wait. The Conductor is building something specific to your household.' },
];

const INTERSTITIAL_CATEGORY_ORDER: InterstitialPhrase['category'][] = [
  'doing', 'privacy', 'personality', 'reassurance',
];

const INTERSTITIAL_CATEGORY_LABEL: Record<InterstitialPhrase['category'], string> = {
  doing: 'CONNECTING',
  privacy: 'PRIVACY',
  personality: 'WHAT TO EXPECT',
  reassurance: 'ALMOST THERE',
};

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

// Hobby keys must mirror api/signals.js HOBBY_KEYS exactly. Backend
// silently drops anything not in that set, so a typo here surfaces as
// "selected pill disappears after save."
const HOBBY_OPTIONS = [
  { id: 'water',    label: '🌊 Water' },
  { id: 'music',    label: '🎵 Music' },
  { id: 'food',     label: '🍽️ Food' },
  { id: 'golf',     label: '⛳ Golf' },
  { id: 'fitness',  label: '🏋️ Fitness' },
  { id: 'art',      label: '🎨 Art' },
  { id: 'travel',   label: '✈️ Travel' },
  { id: 'sports',   label: '🏈 Sports' },
  { id: 'outdoors', label: '🌱 Outdoors' },
  { id: 'film',     label: '🎬 Film' },
  { id: 'wine',     label: '🍷 Wine & Spirits' },
  { id: 'cycling',  label: '🚴 Cycling' },
  { id: 'books',    label: '📚 Books' },
  { id: 'gaming',   label: '🎮 Gaming' },
  { id: 'wellness', label: '🧘 Wellness' },
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

type HouseholdPreview = {
  householdId: string;
  householdName: string | null;
  memberCount: number;
  signalCount: number;
  vaultCount: number;
  crewCount: number;
};

export default function OnboardingScreen() {
  // userId arrives via the deep-link from /api/success after OAuth.
  // Until then this screen renders a Connect CTA so the user has a
  // path forward — without OAuth they cannot reach the personalization
  // steps because the pipeline + status calls all require a userId.
  const userId = useUserId();
  const { theme, accentColor } = useTheme();
  const stepStyles = useMemo(() => makeStepStyles(theme, accentColor), [theme, accentColor]);
  // Initial phase is 'language' so the screen renders something
  // immediately. The async mount effect may switch to 'joining' if
  // it detects an invite code; until it resolves, the user sees the
  // language picker (or saved phase) — never a blank or spinner.
  const [phase, setPhase] = useState<Phase>('language');
  const [language, setLanguage] = useState<Language>('en');
  const [who, setWho] = useState<Who | null>(null);
  const [housing, setHousing] = useState<Housing | null>(null);
  const [modifiers, setModifiers] = useState<Set<Modifier>>(new Set());
  const [joinPreview, setJoinPreview] = useState<HouseholdPreview | null>(null);
  const [joining, setJoining] = useState(false);

  const [tone, setTone] = useState<Tone>('balanced');
  const [detail, setDetail] = useState<Detail>('standard');
  const [humor, setHumor] = useState<Humor>('sometimes');

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hobbiesPicked, setHobbiesPicked] = useState<Set<string>>(new Set());

  const [pipelineReady, setPipelineReady] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const progressMounted = useRef(false);

  // Mount: fork between joining-existing flow (invite code present
  // or joinType flag set) and full new-household onboarding. Wrapped
  // in try/catch so an AsyncStorage failure can't take down the
  // screen before it renders — the ErrorBoundary in _layout.tsx is
  // the last line of defense. Gated on userId so the Connect CTA
  // shows first when OAuth hasn't completed yet.
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        let invite: string | null = null;
        let joinType: string | null = null;
        let savedPhase: string | null = null;
        try { invite = await AsyncStorage.getItem('inviteCode'); } catch { /* skip */ }
        try { joinType = await AsyncStorage.getItem('joinType'); } catch { /* skip */ }
        try { savedPhase = await AsyncStorage.getItem(STEP_KEY); } catch { /* skip */ }

        if (joinType === 'joining_existing' || invite) {
          // Joining flow — fetch the preview for the target household.
          // If no householdId is known, render the joining screen with
          // partial data; user still gets a meaningful "you're joining"
          // moment.
          let householdIdToJoin: string | null = null;
          try { householdIdToJoin = await AsyncStorage.getItem('joinHouseholdId'); } catch { /* skip */ }
          try {
            const q = householdIdToJoin
              ? `&householdId=${encodeURIComponent(householdIdToJoin)}`
              : `&userId=${encodeURIComponent(userId)}`;
            const res = await fetch(`${API_BASE}/onboard?action=householdPreview${q}`);
            const data = await res.json();
            if (data?.ok) {
              setJoinPreview({
                householdId: data.householdId,
                householdName: data.householdName || null,
                memberCount: data.memberCount || 1,
                signalCount: data.signalCount || 0,
                vaultCount: data.vaultCount || 0,
                crewCount: data.crewCount || 0,
              });
            }
          } catch { /* best-effort */ }
          setPhase('joining');
          return;
        }

        // Resume mid-flow if a saved phase exists, else start at language.
        if (
          savedPhase === 'step1' ||
          savedPhase === 'step2' ||
          savedPhase === 'step3' ||
          savedPhase === 'step4' ||
          savedPhase === 'interstitial' ||
          savedPhase === 'language'
        ) {
          setPhase(savedPhase);
        } else {
          setPhase('language');
        }
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
      } catch {
        // Last-resort fallback: drop into the normal language picker
        // so the user can still continue if the detection logic blew up.
        setPhase('language');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
        body: JSON.stringify({ userId: userId }),
      });
    } catch { /* best-effort */ }
  }

  // Status polling — runs the whole time until pipelineReady.
  // Gated on userId so it doesn't fire before OAuth completes.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || pipelineReady) return;
      try {
        const res = await fetch(`${API_BASE}/onboard?userId=${userId}`);
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
  }, [phase, pipelineReady, progress, userId]);

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

  async function confirmJoin() {
    if (joining) return;
    setJoining(true);
    try {
      // Record the join outcome locally so Ground knows the user
      // landed via the join path. No backend call needed — the
      // OAuth callback already linked the user to the household.
      await AsyncStorage.multiSet([
        ['joinType', 'joined_existing'],
        ['onboardingStep', 'done'],
      ]);
      await AsyncStorage.multiRemove(['inviteCode', PIPELINE_START_KEY]);
    } catch { /* best-effort */ }
    router.replace('/' as never);
  }

  async function confirmStep1(w: Who, h: Housing, mods: Modifier[], name: string | null) {
    setWho(w);
    setHousing(h);
    try {
      await fetch(`${API_BASE}/signals?type=profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          who: w,
          housing: h,
          modifiers: mods,
          householdName: name,
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
          userId: userId,
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
          userId: userId,
          priorities: Array.from(picked),
        }),
      });
    } catch { /* best-effort */ }
    // Hobbies is the new final personalization step — always show it
    // before kicking the user into the interstitial / reveal. Even if
    // pipeline is already done, we want them to see this screen so
    // the joie-de-vivre layer gets a chance to set itself.
    setPhase('step4');
  }

  // Save hobbies (or skip), then continue. Mirrors the confirmStep3
  // pipeline-ready branch — straight to reveal if ready, otherwise
  // interstitial.
  async function confirmStep4(skipped: boolean) {
    if (!skipped) {
      try {
        await fetch(`${API_BASE}/signals?type=hobbies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: userId,
            hobbies: Array.from(hobbiesPicked),
          }),
        });
      } catch { /* best-effort */ }
    }
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

  function toggleHobby(id: string) {
    setHobbiesPicked((prev) => {
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

  // Connect-gate: until OAuth completes and the deep-link populates
  // userId in AsyncStorage, render only the Connect CTA. After the
  // deep-link fires, useUserId emits the resolved id and the next
  // render falls through to the normal onboarding flow.
  if (!userId) {
    return (
      <View style={styles.connectContainer}>
        <View style={styles.connectLogo}>
          <Text style={styles.connectLogoMark}>C</Text>
        </View>
        <Text style={styles.connectTitle}>Conductor</Text>
        <Text style={styles.connectSubtitle}>Your household, orchestrated.</Text>
        <View style={styles.connectDivider} />
        <Text style={styles.connectBody}>
          Connect your Gmail and Google Calendar. Conductor reads your
          signals and delivers a calm morning brief — what&apos;s arriving,
          what&apos;s scheduled, what matters today.
        </Text>
        <TouchableOpacity
          style={styles.connectButton}
          onPress={() => Linking.openURL(`${API_BASE}/auth`).catch(() => {})}>
          <Text style={styles.connectButtonText}>Connect your household</Text>
        </TouchableOpacity>
        <Text style={styles.connectPrivacy}>
          We only read what you choose to share. Your emails stay private.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: widthInterpolated }]} />
      </View>
      {pipelineReady ? <Text style={styles.readyChip}>Ready ✓</Text> : null}

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {phase === 'joining' ? (
          <JoiningStep
            preview={joinPreview}
            joining={joining}
            onJoin={confirmJoin}
            s={stepStyles}
            theme={theme}
            accentColor={accentColor}
          />
        ) : null}

        {phase === 'language' ? (
          <LanguageStep
            language={language}
            s={stepStyles}
            theme={theme}
            accentColor={accentColor}
            onPick={async (lang) => {
              setLanguage(lang);
              try {
                await fetch(`${API_BASE}/signals?type=preferences`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: userId, preferences: { language: lang } }),
                });
              } catch { /* best-effort */ }
              setPhase('step1');
            }}
          />
        ) : null}

        {phase === 'step1' ? (
          <Step1
            who={who} setWho={setWho}
            housing={housing} setHousing={setHousing}
            modifiers={modifiers} setModifiers={setModifiers}
            onContinue={(w, h, mods, name) => confirmStep1(w, h, mods, name)}
            s={stepStyles}
            theme={theme}
            accentColor={accentColor}
          />
        ) : null}

        {phase === 'step2' ? (
          <Step2
            tone={tone} setTone={setTone}
            detail={detail} setDetail={setDetail}
            humor={humor} setHumor={setHumor}
            preview={preview}
            onContinue={confirmStep2}
            s={stepStyles}
            accentColor={accentColor}
          />
        ) : null}

        {phase === 'step3' ? (
          <Step3
            picked={picked}
            onToggle={togglePriority}
            onContinue={confirmStep3}
            s={stepStyles}
            accentColor={accentColor}
          />
        ) : null}

        {phase === 'step4' ? (
          <Step4
            picked={hobbiesPicked}
            onToggle={toggleHobby}
            onContinue={() => confirmStep4(false)}
            onSkip={() => confirmStep4(true)}
            s={stepStyles}
            theme={theme}
            accentColor={accentColor}
          />
        ) : null}

        {phase === 'interstitial' ? (
          <InterstitialBlock pipelineReady={pipelineReady} progress={progress} />
        ) : null}

        {phase === 'step1' || phase === 'step2' || phase === 'step3' || phase === 'step4' ? (
          <StepDots
            s={stepStyles}
            active={
              phase === 'step1' ? 0
              : phase === 'step2' ? 1
              : phase === 'step3' ? 2
              : 3
            }
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------- Joining existing household ----------

function JoiningStep({
  preview, joining, onJoin, s, theme,
}: {
  preview: HouseholdPreview | null;
  joining: boolean;
  onJoin: () => void;
  s: StepStyles;
  theme: ThemeColors;
  accentColor: string;
}) {
  // Build the finding rows we'll reveal in sequence. Always include a
  // name row (with a friendly fallback); the count rows surface only
  // when their count is non-zero so a brand-new household doesn't
  // show "0 signals in motion".
  const findings = useMemo(() => {
    if (!preview) return [];
    const rows: { emoji: string; text: string }[] = [];
    if (preview.signalCount > 0) {
      rows.push({ emoji: '📦', text: `${preview.signalCount} signals in motion` });
    }
    if (preview.vaultCount > 0) {
      rows.push({ emoji: '⚠️', text: `${preview.vaultCount} deadlines being watched` });
    }
    if (preview.crewCount > 0) {
      rows.push({ emoji: '👥', text: `${preview.crewCount} crew members` });
    }
    rows.push({ emoji: '🏠', text: preview.householdName || 'A household awaits' });
    return rows;
  }, [preview]);

  // Staggered fade-in: each row appears 800ms after the previous.
  const opacities = useRef<Animated.Value[]>([]).current;
  while (opacities.length < findings.length) {
    opacities.push(new Animated.Value(0));
  }

  useEffect(() => {
    const STAGGER_MS = 800;
    const FADE_MS = 600;
    findings.forEach((_, i) => {
      Animated.timing(opacities[i], {
        toValue: 1,
        duration: FADE_MS,
        delay: i * STAGGER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings.length]);

  const titleName = preview?.householdName || 'a household';

  return (
    <View style={{ paddingTop: 24 }}>
      <Text style={s.title}>You&apos;re joining {titleName}</Text>
      <Text style={[s.subtitle, { marginBottom: 32 }]}>
        Here&apos;s what Conductor has found
      </Text>

      <View style={{ gap: TOKENS.space.item, marginBottom: 28 }}>
        {findings.map((row, i) => (
          <Animated.View
            key={`${row.emoji}-${i}`}
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: TOKENS.listItem.minHeight,
                padding: TOKENS.card.padding,
                borderRadius: TOKENS.card.borderRadius,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.border,
                backgroundColor: theme.surface,
              },
              { opacity: opacities[i] || new Animated.Value(0) },
            ]}>
            <Text style={{ fontSize: 22, marginRight: 14 }}>{row.emoji}</Text>
            <Text style={{ color: theme.text, ...TOKENS.type.body, flex: 1 }}>{row.text}</Text>
          </Animated.View>
        ))}
      </View>

      <Text style={[s.subtitle, { fontStyle: 'italic', marginBottom: 24 }]}>
        Your voice preferences are yours — customize anytime in Your House.
      </Text>

      <TouchableOpacity
        onPress={onJoin}
        disabled={joining}
        style={[s.continueBtn, joining && { opacity: 0.5 }]}>
        <Text style={s.continueBtnText}>
          {joining ? 'Joining…' : `Join ${titleName} →`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------- Language picker ----------

function LanguageStep({
  language, onPick, s, theme, accentColor,
}: {
  language: Language;
  onPick: (l: Language) => void;
  s: StepStyles;
  theme: ThemeColors;
  accentColor: string;
}) {
  return (
    <>
      <Text style={[s.title, { marginTop: 20 }]}>Choose your language</Text>
      <Text style={[s.subtitle, { marginBottom: 24 }]}>Elige tu idioma</Text>
      <View style={{ gap: TOKENS.space.item }}>
        {[
          { id: 'en' as Language, flag: '🇺🇸', label: 'English' },
          { id: 'es' as Language, flag: '🇪🇸', label: 'Español' },
        ].map((o) => {
          const active = language === o.id;
          return (
            <TouchableOpacity
              key={o.id}
              onPress={() => onPick(o.id)}
              activeOpacity={0.7}
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: TOKENS.listItem.minHeight,
                  paddingVertical: 20,
                  paddingHorizontal: 18,
                  borderRadius: TOKENS.card.borderRadius,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                },
                active && { borderColor: accentColor, backgroundColor: accentRgba(accentColor, 0.08) },
              ]}>
              <Text style={{ fontSize: 28, marginRight: 16 }}>{o.flag}</Text>
              <Text style={{ color: theme.text, ...TOKENS.type.subheader }}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

// ---------- Step 1: Who + Housing + Modifiers ----------

function Step1({
  who, setWho,
  housing, setHousing,
  modifiers, setModifiers,
  onContinue,
  s, theme, accentColor,
}: {
  who: Who | null;
  setWho: (w: Who) => void;
  housing: Housing | null;
  setHousing: (h: Housing) => void;
  modifiers: Set<Modifier>;
  setModifiers: (s: Set<Modifier>) => void;
  onContinue: (w: Who, h: Housing, mods: Modifier[], name: string | null) => void;
  s: StepStyles;
  theme: ThemeColors;
  accentColor: string;
}) {
  const [showModifiers, setShowModifiers] = useState(false);
  const [householdName, setHouseholdName] = useState('');
  const canContinue = who !== null && housing !== null;

  function toggleMod(id: Modifier) {
    const next = new Set(modifiers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setModifiers(next);
  }

  return (
    <>
      <Text style={s.preface}>
        While Conductor reads your household — tell us a little about yourself.
      </Text>

      <Text style={s.title}>Who lives in your household?</Text>
      <View style={s.grid}>
        {WHO_CARDS.map((c) => {
          const active = who === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              onPress={() => setWho(c.id)}
              activeOpacity={0.7}
              style={[s.card, active && s.cardActive]}>
              <Text style={s.cardEmoji}>{c.emoji}</Text>
              <Text style={[s.cardLabel, active && { color: accentColor }]}>{c.label}</Text>
              {c.sub ? <Text style={s.cardDesc}>{c.sub}</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {who ? (
        <View style={{ marginTop: 28 }}>
          <Text style={s.smallTitle}>Do you own or rent?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            {HOUSING_CARDS.map((h) => {
              const active = housing === h.id;
              return (
                <TouchableOpacity
                  key={h.id}
                  onPress={() => setHousing(h.id)}
                  activeOpacity={0.7}
                  style={[s.housingBtn, active && s.housingBtnActive]}>
                  <Text style={s.housingEmoji}>{h.emoji}</Text>
                  <Text style={[
                    s.housingLabel,
                    active && { color: accentColor, fontWeight: '600' },
                  ]}>{h.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {who && housing ? (
        <View style={{ marginTop: 24 }}>
          <TouchableOpacity
            onPress={() => setShowModifiers((v) => !v)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={s.modifierToggle}>
              {showModifiers ? 'Anything else? −' : 'Anything else? +'}
            </Text>
          </TouchableOpacity>
          {showModifiers ? (
            <View style={s.modifierGrid}>
              {MODIFIER_OPTIONS.map((m) => {
                const active = modifiers.has(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => toggleMod(m.id)}
                    style={[s.modifierPill, active && s.modifierPillActive]}>
                    <Text style={[
                      s.modifierLabel,
                      active && { color: accentColor, fontWeight: '600' },
                    ]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      {who && housing ? (
        <View style={{ marginTop: 24 }}>
          <Text style={s.smallTitle}>What do you call your household?</Text>
          <Text style={[s.subtitle, { marginBottom: 8 }]}>
            Optional. Appears in your Week in Review and shareable cards.
          </Text>
          <TextInput
            value={householdName}
            onChangeText={setHouseholdName}
            placeholder="e.g. The Mounts House, Apt 4B"
            placeholderTextColor={theme.muted}
            style={{
              color: theme.text,
              ...TOKENS.type.body,
              minHeight: TOKENS.listItem.minHeight,
              paddingVertical: 12,
              paddingHorizontal: 14,
              backgroundColor: theme.inputBackground,
              borderRadius: 10,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
            }}
          />
        </View>
      ) : null}

      <TouchableOpacity
        onPress={() =>
          who && housing && onContinue(
            who, housing, Array.from(modifiers),
            householdName.trim() || null
          )
        }
        disabled={!canContinue}
        style={[s.continueBtn, !canContinue && { opacity: 0.4 }]}>
        <Text style={s.continueBtnText}>Continue →</Text>
      </TouchableOpacity>
    </>
  );
}

// ---------- Step 2: Your Voice with live preview ----------

function Step2({
  tone, setTone, detail, setDetail, humor, setHumor, preview, onContinue, s, accentColor,
}: {
  tone: Tone; setTone: (t: Tone) => void;
  detail: Detail; setDetail: (d: Detail) => void;
  humor: Humor; setHumor: (h: Humor) => void;
  preview: string;
  onContinue: () => void;
  s: StepStyles;
  accentColor: string;
}) {
  return (
    <>
      <Text style={s.title}>How should Conductor talk to you?</Text>
      <Text style={s.subtitle}>You can change this anytime in Your House.</Text>

      <SegRow
        label="Tone"
        options={[
          { value: 'direct', label: 'Direct' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'warm', label: 'Warm' },
        ]}
        value={tone}
        onChange={(v) => setTone(v as Tone)}
        s={s}
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
        s={s}
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
        s={s}
      />

      <View style={s.previewCard}>
        <Text style={s.previewLabel}>PREVIEW</Text>
        <Text style={s.previewText}>{preview}</Text>
      </View>

      <TouchableOpacity onPress={onContinue} style={s.continueBtn}>
        <Text style={s.continueBtnText}>Continue →</Text>
      </TouchableOpacity>
    </>
  );
}

function SegRow({
  label, options, value, onChange, s,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  s: StepStyles;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={s.segLabel}>{label}</Text>
      <View style={s.segWrap}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[s.segPill, active && s.segPillActive]}>
              <Text style={[s.segPillText, active && { color: '#0f0f0f', fontWeight: '600' }]}>
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
  picked, onToggle, onContinue, s, accentColor,
}: {
  picked: Set<string>;
  onToggle: (id: string) => void;
  onContinue: () => void;
  s: StepStyles;
  accentColor: string;
}) {
  return (
    <>
      <Text style={s.title}>What does your household care about most?</Text>
      <Text style={s.subtitle}>Conductor will lead with what matters to you.</Text>

      <View style={s.priorityGrid}>
        {PRIORITY_OPTIONS.map((p) => {
          const active = picked.has(p.id);
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => onToggle(p.id)}
              style={[s.priorityPill, active && s.priorityPillActive]}>
              <Text style={[s.priorityLabel, active && { color: accentColor, fontWeight: '600' }]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity onPress={onContinue} style={s.continueBtn}>
        <Text style={s.continueBtnText}>Continue →</Text>
      </TouchableOpacity>
    </>
  );
}

// ---------- Step 4: Hobbies (joie-de-vivre) ----------

function Step4({
  picked, onToggle, onContinue, onSkip, s, theme, accentColor,
}: {
  picked: Set<string>;
  onToggle: (id: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  s: StepStyles;
  theme: ThemeColors;
  accentColor: string;
}) {
  return (
    <>
      <Text style={s.title}>What does your household love?</Text>
      <Text style={s.subtitle}>
        Conductor will watch for opportunities, not just obligations.
      </Text>

      <View style={s.priorityGrid}>
        {HOBBY_OPTIONS.map((h) => {
          const active = picked.has(h.id);
          return (
            <TouchableOpacity
              key={h.id}
              onPress={() => onToggle(h.id)}
              style={[s.priorityPill, active && s.priorityPillActive]}>
              <Text style={[s.priorityLabel, active && { color: accentColor, fontWeight: '600' }]}>
                {h.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity onPress={onContinue} style={s.continueBtn}>
        <Text style={s.continueBtnText}>Continue →</Text>
      </TouchableOpacity>

      {/* Quiet "skip" affordance — same pattern as other onboarding
          escapes. Tinted muted so it doesn't compete with Continue. */}
      <TouchableOpacity
        onPress={onSkip}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{ marginTop: 14, alignItems: 'center' }}>
        <Text style={{ color: theme.muted, ...TOKENS.type.secondary }}>
          Just the essentials for now →
        </Text>
      </TouchableOpacity>
    </>
  );
}

// ---------- Interstitial: cycling phrases ----------
//
// Rebuilt to use the wait time meaningfully:
//   - Phrases cycle every ~3.7s (350ms fade out + 3000ms hold +
//     350ms fade in), smooth opacity transition between each.
//   - Rotates through four categories in order so the user gets a
//     rhythm of "what Conductor's doing → privacy → expectation →
//     reassurance" — never two phrases from the same category back
//     to back.
//   - Within each category, picks a random phrase, excluding the
//     phrase shown last time that category was visited.
//   - Conductor mark pulses gently (scale + opacity loop) so the
//     screen never feels frozen.
//   - Progress line at the bottom is driven off the screen-level
//     progress Animated.Value so the user sees the pipeline
//     advancing alongside the prose.

function InterstitialBlock({
  pipelineReady,
  progress,
}: {
  pipelineReady: boolean;
  progress: Animated.Value;
}) {
  // Bucket phrases by category once per mount — the lookup happens
  // every cycle so memoizing keeps re-renders cheap.
  const phrasesByCategory = useMemo(() => {
    const m: Record<InterstitialPhrase['category'], InterstitialPhrase[]> = {
      doing: [], privacy: [], personality: [], reassurance: [],
    };
    for (const p of INTERSTITIAL_PHRASES) m[p.category].push(p);
    return m;
  }, []);

  // Track which category to draw from next + the last phrase index
  // shown for each category. lastByCategory prevents the same phrase
  // repeating when a category comes back around.
  const categoryIdxRef = useRef(0);
  const lastByCategoryRef = useRef<Record<InterstitialPhrase['category'], number>>({
    doing: -1, privacy: -1, personality: -1, reassurance: -1,
  });
  const [phrase, setPhrase] = useState<InterstitialPhrase>(() => {
    const cat = INTERSTITIAL_CATEGORY_ORDER[0];
    const pool = phrasesByCategory[cat];
    return pool[0];
  });

  const opacity = useRef(new Animated.Value(0)).current;
  const markScale = useRef(new Animated.Value(1)).current;
  const markOpacity = useRef(new Animated.Value(0.85)).current;

  function pickNext(): InterstitialPhrase {
    const cat = INTERSTITIAL_CATEGORY_ORDER[categoryIdxRef.current];
    const pool = phrasesByCategory[cat];
    const last = lastByCategoryRef.current[cat];
    // Random index in pool, excluding the index used last time.
    let nextLocal: number;
    if (pool.length === 1) {
      nextLocal = 0;
    } else {
      do { nextLocal = Math.floor(Math.random() * pool.length); }
      while (nextLocal === last);
    }
    lastByCategoryRef.current[cat] = nextLocal;
    categoryIdxRef.current = (categoryIdxRef.current + 1) % INTERSTITIAL_CATEGORY_ORDER.length;
    return pool[nextLocal];
  }

  // Phrase-cycle loop. Fade in → hold → fade out → swap phrase → repeat.
  useEffect(() => {
    let cancelled = false;
    const cycle = () => {
      if (cancelled) return;
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(opacity, { toValue: 0, duration: 350, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (cancelled || !finished) return;
        setPhrase(pickNext());
        cycle();
      });
    };
    cycle();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gentle pulse on the Conductor mark — 2.4s loop, scale 1→1.06,
  // opacity 0.85→1. Native driver so it doesn't compete with JS.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(markScale, { toValue: 1.06, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(markScale, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(markOpacity, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(markOpacity, { toValue: 0.85, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [markScale, markOpacity]);

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.interstitialWrap}>
      <Animated.View
        style={[
          styles.interstitialMark,
          { transform: [{ scale: markScale }], opacity: markOpacity },
        ]}>
        <Text style={styles.interstitialMarkText}>C</Text>
      </Animated.View>

      {pipelineReady ? (
        <Text style={styles.interstitialReady}>Ready.</Text>
      ) : (
        <Animated.View style={{ opacity }}>
          <Text style={styles.interstitialCategory}>
            {INTERSTITIAL_CATEGORY_LABEL[phrase.category]}
          </Text>
          <Text style={styles.interstitialPhrase}>{phrase.text}</Text>
        </Animated.View>
      )}

      <View style={styles.interstitialProgressTrack}>
        <Animated.View
          style={[styles.interstitialProgressFill, { width: progressWidth }]}
        />
      </View>
    </View>
  );
}

// ---------- Step indicator dots ----------

function StepDots({ active, s }: { active: 0 | 1 | 2 | 3; s: StepStyles }) {
  return (
    <View style={s.dotsRow}>
      {[0, 1, 2, 3].map((i) => {
        const state = i === active ? 'active' : i < active ? 'done' : 'upcoming';
        return (
          <View
            key={i}
            style={[
              s.dot,
              state === 'active' && s.dotActive,
              state === 'done' && s.dotDone,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  connectContainer: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  connectLogo: {
    width: 56,
    height: 56,
    backgroundColor: OFF_WHITE,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  connectLogoMark: { color: BG, fontSize: 28, fontWeight: '700' },
  connectTitle: { color: OFF_WHITE, fontSize: 26, fontWeight: '500', marginBottom: 6 },
  connectSubtitle: { color: FAINT, fontSize: 13, marginBottom: 24 },
  connectDivider: {
    width: 32,
    height: StyleSheet.hairlineWidth,
    backgroundColor: SOFT_BORDER,
    marginBottom: 24,
  },
  connectBody: {
    color: FAINT,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 12,
  },
  connectButton: {
    backgroundColor: BRASS,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    marginBottom: 22,
  },
  connectButtonText: { color: BG, fontSize: 15, fontWeight: '600' },
  connectPrivacy: {
    color: MUTED,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 24,
  },

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

  interstitialWrap: {
    paddingVertical: 60,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    minHeight: 360,
  },
  interstitialMark: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: BRASS,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BRASS,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  interstitialMarkText: {
    color: BG,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  interstitialCategory: {
    color: BRASS,
    fontSize: 10,
    letterSpacing: 2.4,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  interstitialPhrase: {
    color: OFF_WHITE,
    fontSize: 17,
    fontWeight: '300',
    textAlign: 'center',
    letterSpacing: 0.3,
    lineHeight: 26,
    maxWidth: 300,
  },
  interstitialReady: {
    color: BRASS,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  interstitialProgressTrack: {
    width: '70%',
    maxWidth: 240,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: 8,
  },
  interstitialProgressFill: {
    height: '100%',
    backgroundColor: BRASS,
  },
});

// Step-screen styles — theme-aware + token-driven. The connect-gate
// and interstitial deliberately stay on the module-level `styles`
// above (hardcoded dark palette); only the personalization steps flow
// through here so they flip correctly in light mode and reach the
// shared design standard.
function makeStepStyles(theme: ThemeColors, accentColor: string) {
  const activeTint = accentRgba(accentColor, 0.08);
  return StyleSheet.create({
    preface: {
      color: theme.muted,
      ...TOKENS.type.secondary,
      fontStyle: 'italic',
      marginBottom: 18,
    },
    title: {
      color: theme.text,
      ...TOKENS.type.header,
      marginBottom: 12,
    },
    smallTitle: {
      color: theme.text,
      ...TOKENS.type.subheader,
      marginBottom: 6,
    },
    subtitle: {
      color: theme.muted,
      ...TOKENS.type.secondary,
      marginBottom: 24,
    },

    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    card: {
      width: '48%',
      padding: TOKENS.card.padding,
      borderRadius: TOKENS.card.borderRadius,
      marginBottom: TOKENS.space.item,
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      minHeight: 130,
    },
    cardActive: { borderColor: accentColor, backgroundColor: activeTint },
    cardEmoji: { fontSize: 28, marginBottom: 8 },
    cardLabel: { color: theme.text, ...TOKENS.type.body, fontWeight: '600' },
    cardDesc: { color: theme.muted, ...TOKENS.type.secondary, marginTop: 4 },

    housingBtn: {
      flex: 1,
      paddingVertical: 16,
      paddingHorizontal: 10,
      borderRadius: TOKENS.card.borderRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      minHeight: TOKENS.listItem.minHeight,
    },
    housingBtnActive: { borderColor: accentColor, backgroundColor: activeTint },
    housingEmoji: { fontSize: 22, marginBottom: 6 },
    housingLabel: { color: theme.text, ...TOKENS.type.secondary, textAlign: 'center' },

    modifierToggle: {
      color: accentColor,
      ...TOKENS.type.secondary,
      fontWeight: '500',
      paddingVertical: 4,
    },
    modifierGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    modifierPill: {
      paddingVertical: 9,
      paddingHorizontal: 14,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    modifierPillActive: { borderColor: accentColor, backgroundColor: activeTint },
    modifierLabel: { color: theme.text, ...TOKENS.type.secondary },

    segLabel: {
      color: theme.muted,
      ...TOKENS.type.label,
      letterSpacing: 1.5,
      marginBottom: 8,
    },
    segWrap: {
      flexDirection: 'row',
      backgroundColor: theme.inputBackground,
      borderRadius: 10,
      padding: 3,
    },
    segPill: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
    },
    segPillActive: { backgroundColor: accentColor },
    segPillText: { color: theme.muted, ...TOKENS.type.secondary },

    previewCard: {
      marginTop: 8,
      marginBottom: 20,
      padding: TOKENS.card.padding,
      paddingLeft: 18,
      backgroundColor: accentRgba(accentColor, 0.06),
      borderLeftWidth: 2,
      borderLeftColor: accentColor,
      borderRadius: TOKENS.card.borderRadius,
    },
    previewLabel: {
      color: theme.muted,
      ...TOKENS.type.label,
      marginBottom: 8,
    },
    previewText: { color: theme.text, ...TOKENS.type.body, lineHeight: 22, fontStyle: 'italic' },

    priorityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    priorityPill: {
      paddingVertical: 11,
      paddingHorizontal: 14,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    priorityPillActive: { borderColor: accentColor, backgroundColor: activeTint },
    priorityLabel: { color: theme.text, ...TOKENS.type.secondary },

    continueBtn: {
      marginTop: 32,
      backgroundColor: accentColor,
      paddingVertical: 14,
      borderRadius: 26,
      alignItems: 'center',
      minHeight: TOKENS.listItem.minHeight,
      justifyContent: 'center',
    },
    // Dark text on the bright accent fill — an on-accent contrast
    // color, intentionally not theme-flipped (matches the channel +
    // connect-gate CTA treatment).
    continueBtnText: { color: '#0f0f0f', ...TOKENS.type.body, fontWeight: '600', letterSpacing: 0.5 },

    dotsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
      marginTop: 28,
    },
    dot: {
      width: 8, height: 8, borderRadius: 4,
      borderWidth: 1.5, borderColor: theme.muted, backgroundColor: 'transparent',
    },
    dotActive: { backgroundColor: accentColor, borderColor: accentColor, width: 22 },
    dotDone: { borderColor: accentColor, backgroundColor: 'transparent' },
  });
}
