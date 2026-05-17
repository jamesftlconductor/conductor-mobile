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

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';

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
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [error, setError] = useState(false);
  const [cardCount, setCardCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function poll() {
      try {
        const res = await fetch(
          `${API_BASE}/onboard?action=reveal&userId=${USER_ID}`
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
    const t = setTimeout(() => router.replace('/(tabs)'), 1500);
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

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Here's what I found</Text>
      <View style={styles.cardStack}>
        {cards.slice(0, cardCount).map((card, i) => (
          <FadeInCard key={i} title={card.title} body={card.body} />
        ))}
      </View>
      {cardCount >= cards.length && (
        <FadeInCta onPress={() => router.replace('/(tabs)')} />
      )}
    </View>
  );
}

function FadeInCard({ title, body }: { title: string; body: string }) {
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 28,
    paddingTop: 100,
    paddingBottom: 60,
  },
  header: {
    color: OFF_WHITE,
    fontSize: 22,
    fontWeight: '300',
    letterSpacing: 0.3,
    marginBottom: 28,
  },
  cardStack: { gap: 14 },
  card: {
    padding: 18,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  cardTitle: { color: OFF_WHITE, fontSize: 15, fontWeight: '500', marginBottom: 4 },
  cardBody: { color: MUTED, fontSize: 13, lineHeight: 19 },
  workingText: {
    color: MUTED,
    fontSize: 16,
    fontWeight: '300',
    textAlign: 'center',
    marginTop: 200,
  },
  readyText: {
    color: OFF_WHITE,
    fontSize: 22,
    fontWeight: '300',
    textAlign: 'center',
    marginTop: 200,
  },
  ctaBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: BRASS,
  },
  ctaText: { color: '#0f0f0f', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
});
