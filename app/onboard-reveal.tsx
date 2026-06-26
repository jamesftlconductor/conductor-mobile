// Onboard reveal — shown once at the end of the onboarding sequence.
// Fetches the reveal payload that the worker compiled at finalize
// time. Each "card" fades in sequentially with a small delay,
// producing the moment-of-recognition that follows the slow trust
// sequence in app/onboarding.tsx.
//
// If the reveal isn't available yet (slow worker, expired TTL,
// connection error), the screen falls through to a neutral "ready"
// message and proceeds to (tabs) — onboarding should never be
// blocked on the reveal payload.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PulsingCMark } from '@/components/PulsingCMark';
import { useUserId } from '@/hooks/useUserId';
import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_MS = 12000;
const CARD_STAGGER_MS = 900;
const CARD_FADE_MS = 700;

type Reveal = {
  compiledAt: string;
  signalsFound: number;
  activeSignals: number;
  vaultItemsFound: number;
  crewMembersFound: number;
  calendarEventsFound: number;
  providersFound: number;
  upcomingDeadlines: { description: string; eta: string; sender?: string | null }[];
  mostUrgent: { description: string; eta: string } | null;
  birthdaysFound: { name: string; kind: string; when: string }[];
  highlights: string[];
};

type VaultPreviewItem = {
  id: string;
  description?: string;
  provider?: string | null;
  category?: string;
};

// Coarse emoji per vault category — mirrors the vault screen's display
// buckets closely enough for a glanceable hero preview.
function vaultEmoji(category?: string): string {
  const c = (category || '').toLowerCase();
  if (c.includes('insur') || c.includes('protection')) return '🛡';
  if (c.includes('subscription')) return '🔄';
  if (c.includes('lease') || c.includes('registration')) return '🔑';
  if (c.includes('warrant')) return '🔧';
  if (c.includes('medical') || c.includes('health')) return '💊';
  if (c.includes('financ')) return '💰';
  if (c.includes('home')) return '🏠';
  return '📄';
}

function formatEta(eta: string): string {
  const ms = Date.parse(eta);
  if (isNaN(ms)) return '';
  const days = Math.round((ms - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function OnboardRevealScreen() {
  const userId = useUserId();
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  if (!userId) return null;
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [error, setError] = useState(false);
  const [cardCount, setCardCount] = useState(0);
  const [vaultPreview, setVaultPreview] = useState<VaultPreviewItem[]>([]);
  // Verification step — shown after the reveal cards. Confirms the top things
  // Conductor found before proceeding.
  const [verifying, setVerifying] = useState(false);
  const [householdName, setHouseholdName] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem('householdName')
      .then((n) => { if (typeof n === 'string' && n.trim()) setHouseholdName(n.trim()); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function poll() {
      try {
        const res = await fetch(
          `${API_BASE}/onboard?action=reveal&userId=${userId}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (data && data.reveal) {
          setReveal(data.reveal as Reveal);
          return;
        }
      } catch (err) {
        console.warn('[reveal] fetch failed:', err);
      }
      if (cancelled) return;
      if (Date.now() - startedAt < POLL_MAX_MS) {
        setTimeout(poll, POLL_INTERVAL_MS);
      } else {
        setError(true);
      }
    }
    poll();
    return () => { cancelled = true; };
  }, []);

  // When the reveal reports vault items, pull the real records so we can
  // lead the screen with them (the reveal payload only carries a count).
  useEffect(() => {
    if (!reveal || reveal.vaultItemsFound <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=vault&userId=${userId}&sort=urgency`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const items: VaultPreviewItem[] = Array.isArray(data?.items) ? data.items : [];
        setVaultPreview(items.slice(0, 5));
      } catch {
        // best-effort — the totals card still reports the count
      }
    })();
    return () => { cancelled = true; };
  }, [reveal]);

  const cards: { title: string; body: string }[] = [];
  if (reveal) {
    if (reveal.highlights.length > 0) {
      for (const h of reveal.highlights.slice(0, 4)) {
        cards.push({ title: h, body: '' });
      }
    }
    if (reveal.mostUrgent) {
      cards.push({
        title: 'Most pressing thing',
        body: `${reveal.mostUrgent.description} — ${formatEta(reveal.mostUrgent.eta)}`,
      });
    }
    if (reveal.upcomingDeadlines.length > 1) {
      const others = reveal.upcomingDeadlines
        .slice(1, 3)
        .map((d) => `${d.description} (${formatEta(d.eta)})`)
        .join(' · ');
      if (others) {
        cards.push({ title: 'Also on the radar', body: others });
      }
    }
    if (reveal.birthdaysFound.length > 0) {
      const b = reveal.birthdaysFound[0];
      cards.push({
        title: `${b.name}'s ${b.kind}`,
        body: formatEta(b.when),
      });
    }
    const totals: string[] = [];
    if (reveal.signalsFound > 0) totals.push(`${reveal.signalsFound} signals`);
    if (reveal.vaultItemsFound > 0) totals.push(`${reveal.vaultItemsFound} vault items`);
    if (reveal.crewMembersFound > 0) totals.push(`${reveal.crewMembersFound} in the crew`);
    if (totals.length > 0) {
      cards.push({ title: 'In total', body: totals.join(' · ') });
    }
  }

  // Stagger card reveal.
  useEffect(() => {
    if (!reveal || cards.length === 0) return;
    const timers: any[] = [];
    for (let i = 0; i < cards.length; i++) {
      timers.push(
        setTimeout(() => setCardCount((n) => Math.max(n, i + 1)), i * CARD_STAGGER_MS)
      );
    }
    return () => { for (const t of timers) clearTimeout(t); };
  }, [reveal, cards.length]);

  // Error path: still let the user through.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => router.replace('/onboard-first-intro' as never), 1500);
    return () => clearTimeout(t);
  }, [error]);

  if (error || (reveal && cards.length === 0)) {
    return (
      <View style={styles.container}>
        <Text style={styles.readyText}>Conductor is ready.</Text>
      </View>
    );
  }

  if (!reveal) {
    return (
      <View style={styles.container}>
        <Text style={styles.workingText}>Just finishing up…</Text>
      </View>
    );
  }

  if (verifying) {
    const verifyItems: { label: string; value: string }[] = [];
    verifyItems.push({ label: 'Household', value: householdName || 'Your household' });
    for (const v of vaultPreview.slice(0, 3)) {
      verifyItems.push({ label: 'Vault item', value: v.description || v.provider || 'Saved item' });
    }
    for (const d of (reveal?.upcomingDeadlines || []).slice(0, 3)) {
      verifyItems.push({ label: 'Signal', value: `${d.description} — ${formatEta(d.eta)}` });
    }
    return (
      <View style={styles.container}>
        <View style={styles.revealLogo}>
          <PulsingCMark size={48} />
        </View>
        <Text style={styles.header}>Does this look right?</Text>
        <View style={styles.cardStack}>
          {verifyItems.map((it, i) => (
            <View key={i} style={styles.verifyRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.verifyLabel}>{it.label}</Text>
                <Text style={styles.verifyValue} numberOfLines={2}>{it.value}</Text>
              </View>
              <Text style={styles.verifyCheck}>✓</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity
          onPress={() => router.replace('/onboard-first-intro' as never)}
          activeOpacity={0.85}
          style={styles.verifyCta}>
          <Text style={styles.ctaText}>Looks good →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Brand C mark crowning the reveal, centered near the top. Pulses and
          carries the chosen logoColor (PulsingCMark tints itself). */}
      <View style={styles.revealLogo}>
        <PulsingCMark size={56} />
      </View>
      {vaultPreview.length > 0 ? <VaultHero items={vaultPreview} /> : null}
      <Text style={styles.header}>Here's what I found</Text>
      <View style={styles.cardStack}>
        {cards.slice(0, cardCount).map((card, i) => (
          <FadeInCard key={i} title={card.title} body={card.body} />
        ))}
      </View>
      {cardCount >= cards.length && (
        <>
          <FadeInCta onPress={() => setVerifying(true)} />
          <TouchableOpacity
            onPress={() => router.replace('/transition' as never)}
            style={styles.transitionLink}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.transitionLinkText}>
              Something big just happened? Tell Conductor →
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// Vault hero — leads the reveal when the pipeline surfaced vault items.
// The most tangible "it already knows my life" moment, so it goes first.
function VaultHero({ items }: { items: VaultPreviewItem[] }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: CARD_FADE_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: CARD_FADE_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);
  return (
    <Animated.View style={[styles.vaultHero, { opacity, transform: [{ translateY }] }]}>
      <Text style={styles.vaultHeroLead}>
        The Conductor found your insurance policies, subscriptions, and documents.
      </Text>
      <View style={styles.vaultList}>
        {items.map((it) => (
          <View key={it.id} style={styles.vaultRow}>
            <Text style={styles.vaultEmoji}>{vaultEmoji(it.category)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.vaultTitle} numberOfLines={1}>
                {it.description || it.provider || 'Document'}
              </Text>
              {it.provider && it.description ? (
                <Text style={styles.vaultSub} numberOfLines={1}>
                  {it.provider}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
      <TouchableOpacity
        onPress={() => router.push('/vault' as never)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.vaultAddMore}>Tap to add more →</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

function FadeInCard({ title, body }: { title: string; body: string }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: CARD_FADE_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: CARD_FADE_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);
  return (
    <Animated.View style={[styles.card, { opacity, transform: [{ translateY }] }]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {body ? <Text style={styles.cardBody}>{body}</Text> : null}
    </Animated.View>
  );
}

function FadeInCta({ onPress }: { onPress: () => void }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 800,
      delay: 400,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, []);
  return (
    <Animated.View style={{ opacity, marginTop: 32 }}>
      <TouchableOpacity onPress={onPress} style={styles.ctaBtn}>
        <Text style={styles.ctaText}>Begin</Text>
      </TouchableOpacity>
    </Animated.View>
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
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    // Hero layout: deliberate generous top padding for the
    // moment-of-recognition reveal. Preserved intentionally.
    paddingHorizontal: 28,
    paddingTop: 100,
    paddingBottom: 60,
  },
  revealLogo: {
    alignItems: 'center',
    marginBottom: 24,
  },
  header: {
    // Intentionally light/large hero type — not the standard
    // TOKENS.type.header weight. Only the color is normalized.
    color: theme.text,
    fontSize: 22,
    fontWeight: '300',
    letterSpacing: 0.3,
    marginBottom: 28,
  },
  vaultHero: {
    padding: 20,
    borderRadius: TOKENS.card.borderRadius,
    borderWidth: 1,
    borderColor: accentColor,
    backgroundColor: theme.surface,
    marginBottom: 24,
  },
  vaultHeroLead: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 23,
    marginBottom: 16,
  },
  vaultList: { gap: 12, marginBottom: 14 },
  vaultRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vaultEmoji: { fontSize: 18, width: 24, textAlign: 'center' },
  vaultTitle: { color: theme.text, ...TOKENS.type.body, fontWeight: '500' },
  vaultSub: { color: theme.muted, ...TOKENS.type.secondary },
  vaultAddMore: {
    color: accentColor,
    ...TOKENS.type.secondary,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  cardStack: { gap: 14 },
  card: {
    padding: 18,
    borderRadius: TOKENS.card.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  cardTitle: { color: theme.text, ...TOKENS.type.body, fontWeight: '500', marginBottom: 4 },
  cardBody: { color: theme.muted, ...TOKENS.type.secondary, lineHeight: 19 },
  workingText: {
    // Hero waiting state — large light type, centered. Preserved.
    color: theme.muted,
    fontSize: 16,
    fontWeight: '300',
    textAlign: 'center',
    marginTop: 200,
  },
  readyText: {
    // Hero fallback state — large light type. Preserved.
    color: theme.text,
    fontSize: 22,
    fontWeight: '300',
    textAlign: 'center',
    marginTop: 200,
  },
  ctaBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 28,
    paddingVertical: 14,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: accentColor,
  },
  transitionLink: {
    marginTop: 20,
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  transitionLinkText: {
    color: theme.muted,
    fontSize: 12,
    fontStyle: 'italic',
    letterSpacing: 0.2,
  },
  ctaText: { color: '#0f0f0f', ...TOKENS.type.body, fontWeight: '600', letterSpacing: 0.5 },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: TOKENS.card.borderRadius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  verifyLabel: {
    color: theme.muted,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  verifyValue: { color: theme.text, fontSize: 14, lineHeight: 19 },
  verifyCheck: { color: accentColor, fontSize: 18, fontWeight: '700' },
  verifyCta: {
    marginTop: 22,
    alignSelf: 'center',
    backgroundColor: accentColor,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 24,
  },
  });
}
