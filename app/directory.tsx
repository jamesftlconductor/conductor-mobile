// Directory — a swipeable card-deck reference guide for what's in
// Conductor. Static content (24 cards across 6 sections). Reached
// from:
//   - Settings → Conductor → "Directory ?"
//   - "?" button top right of Ground / Hover / Vault / Crew /
//     Horizon / Compass / Journal
//   - Deep-link from the first-brief acknowledgment line.
//
// Entry can target a specific card via ?card=<id> or ?screen=<path>.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const FAINT = '#a8a5a0';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type DirectoryCard = {
  id: string;
  section: string;
  sectionNumber: number;
  title: string;
  body: string;
  example: string | null;
  screenLink: string | null;
};

const CARDS: DirectoryCard[] = [
  // ── Section 1 — The Basics ──
  { id: 'brief', section: 'The Basics', sectionNumber: 1, title: 'The Brief',
    body: "Every morning at 7am Conductor delivers a brief — 3 to 5 sentences about what matters most in your household today. Not everything. Not a list. Just what you actually need to know, said calmly and clearly. The brief gets smarter every day as Conductor learns your household's patterns.",
    example: "\"You have two subscription renewals this week and Mia has a field trip Monday. The Paris trip looks ready.\"",
    screenLink: '/' },
  { id: 'radar', section: 'The Basics', sectionNumber: 1, title: 'The Radar',
    body: "The Hover screen shows your household's signals as dots rotating on three rings. The inner ring needs your attention soon. The middle ring is approaching. The outer ring is on the horizon. Tap any dot to see details and take action.",
    example: "A package arriving today sits on the inner ring. A subscription renewal in three weeks sits on the outer ring.",
    screenLink: '/hover' },
  { id: 'signals', section: 'The Basics', sectionNumber: 1, title: 'Signals',
    body: "A signal is anything in your household that needs awareness or action — a delivery, a deadline, a service appointment, a renewal. Conductor finds signals in your Gmail automatically. You can also add them manually. Signals move through three states: incoming, active, and resolved.",
    example: "When you tap Rest on a signal, it moves to resolved and contributes to your household streak.",
    screenLink: '/hover' },
  { id: 'pulse', section: 'The Basics', sectionNumber: 1, title: 'The Pulse',
    body: "The Pulse is a single sentence each morning synthesizing your health, the weather, and your signal load into something true about today. It lives below your greeting on the Ground screen. Tap it to expand and see what Conductor is synthesizing.",
    example: "\"The humidity has opinions today — two urgent things need your attention before the heat builds.\"",
    screenLink: '/' },

  // ── Section 2 — Your Household ──
  { id: 'crew', section: 'Your Household', sectionNumber: 2, title: 'Crew',
    body: "Crew is everyone in your household — partners, children, pets. Each crew member has their own bio with schedule, health details, and attributed signals. When a signal belongs to a specific person, Conductor attributes it to them and narrates it that way in the brief.",
    example: "\"Mia's prescription needs refilling this week.\" — because the signal is attributed to Mia.",
    screenLink: '/crew' },
  { id: 'vault', section: 'Your Household', sectionNumber: 2, title: 'Vault',
    body: "The Vault is your household's permanent record — insurance policies, subscriptions, warranties, registrations, leases, and deadlines. Conductor populates it from your Gmail automatically. You can also scan physical documents or add items manually.",
    example: "Your car registration renewal lives in the Vault. Conductor surfaces it before it lapses.",
    screenLink: '/vault' },
  { id: 'horizon', section: 'Your Household', sectionNumber: 2, title: 'The Horizon',
    body: "The Horizon shows everything beyond the next two weeks — organized into three temporal sections: Coming Up, Further Out, and On the Edge. Tap Noted to acknowledge something without resolving it. Items move from The Horizon into the brief as they get closer.",
    example: "Your Paris trip sits in Coming Up. Your annual insurance renewal sits in Further Out.",
    screenLink: '/horizon' },
  { id: 'programme', section: 'Your Household', sectionNumber: 2, title: 'The Programme',
    body: "The Programme is a 14-day timeline showing everything Conductor is watching — signals, crew events, vault deadlines, and calendar events all on one view. It's the unified household calendar that doesn't exist anywhere else.",
    example: "Monday shows Mia's field trip, Tuesday shows a delivery arriving, Thursday shows a service appointment.",
    screenLink: '/programme' },
  { id: 'inventory', section: 'Your Household', sectionNumber: 2, title: 'Home Inventory',
    body: "Home Inventory is where you tell Conductor about your home's systems — roof, HVAC, water heater, vehicles, appliances. The more you fill in, the smarter the maintenance plan becomes. Conductor can also scan appliance labels to populate fields automatically.",
    example: "Tell Conductor your roof was installed in 2009 and it will surface an inspection reminder before hurricane season.",
    screenLink: '/inventory' },

  // ── Section 3 — Intelligence ──
  { id: 'ask', section: 'Intelligence', sectionNumber: 3, title: 'Ask Conductor',
    body: "Ask Conductor anything about your household — what's coming up, what things cost, who you've used before, how your week looks. Conductor answers from your actual household data, not general knowledge. The more Conductor knows about your home, the better the answers.",
    example: "\"Is $450 reasonable for HVAC service in Fort Lauderdale?\" — Conductor knows your market and your service history.",
    screenLink: '/' },
  { id: 'synthesis', section: 'Intelligence', sectionNumber: 3, title: 'Synthesis',
    body: "Every morning Conductor considers your health data, the weather, and your signal load simultaneously before saying anything. This is the synthesis layer — the thing that makes the brief feel like it was written by someone who knows you, not assembled from data.",
    example: "Bad sleep plus high humidity plus a busy signal day produces: 'Stay ahead of hydration today.'",
    screenLink: '/' },
  { id: 'patterns', section: 'Intelligence', sectionNumber: 3, title: 'Patterns',
    body: "Over time Conductor learns how your household operates — which signals you resolve quickly, which ones you let sit, what days are typically busy, what seasonal patterns recur. After 90 days the brief voice reflects this knowledge naturally.",
    example: "After three months Conductor knows your Amazon orders typically arrive in 2 days — so a 5-day delay is notable.",
    screenLink: '/' },
  { id: 'network', section: 'Intelligence', sectionNumber: 3, title: 'The Network',
    body: "The Network connects your household to family households you trust. You choose what to share — from emergency-only awareness to full signal visibility. Connected households appear quietly in your brief when something needs attention.",
    example: "\"Your parents' household has a deadline approaching this week.\" — surfaced because you're connected.",
    screenLink: '/network' },

  // ── Section 4 — Planning ──
  { id: 'maintenance', section: 'Planning', sectionNumber: 4, title: 'Home Maintenance Plan',
    body: "Once Conductor knows your home's systems, it generates an annual maintenance schedule with Fort Lauderdale seasonal timing and real cost ranges. Each item can be added to your signal radar with one tap. The plan updates annually.",
    example: "\"HVAC tune-up — due before June. Book now — South Florida HVAC fills up fast before summer.\"",
    screenLink: '/maintenance' },
  { id: 'transition', section: 'Planning', sectionNumber: 4, title: 'Life Transitions',
    body: "When something big changes — a new baby, a new home, a health diagnosis, a job change — Conductor adjusts. Tell it what happened and it seeds the right Vault items, adjusts its tone, and watches for the deadlines specific to that transition.",
    example: "A new home transition seeds 14 Vault items automatically — from mail forwarding to the first property tax payment.",
    screenLink: '/transition' },
  { id: 'caught', section: 'Planning', sectionNumber: 4, title: 'Caught Moments',
    body: "When Conductor catches something that was close to slipping — a deadline handled within 72 hours of lapsing, a conflict resolved, a birthday remembered — it acknowledges it. These are recorded in your Memory Journal and surface in the Week in Review.",
    example: "\"Conductor caught the vehicle registration before it lapsed — handled with 2 days to spare.\"",
    screenLink: '/journal' },
  { id: 'weekinreview', section: 'Planning', sectionNumber: 4, title: 'Week in Review',
    body: "Every Sunday evening the Clearance brief includes a Week in Review — a warm, honest paragraph about how the household did this week. Signals handled, deadlines caught, streak status. It gets more personal as Conductor knows you better.",
    example: "\"Seven signals this week. Six handled, one carried forward. The streak is holding at 12 days.\"",
    screenLink: '/' },

  // ── Section 5 — Communication ──
  { id: 'notifications', section: 'Communication', sectionNumber: 5, title: 'Notifications',
    body: "Conductor sends three types of push notifications — the morning Takeoff at 7am, the evening Clearance at 9pm, and follow-ups when a signal's ETA passes without action. Midday check-ins are optional and off by default.",
    example: "A follow-up fires one hour after your HVAC appointment window passes: \"Your appointment window just passed — did it happen?\"",
    screenLink: '/settings' },
  { id: 'sms', section: 'Communication', sectionNumber: 5, title: 'SMS Updates',
    body: "Conductor can text anyone connected to your household — family members, contractors, neighbors — whether they have the app or not. They can reply with simple keywords (DONE, YES, NO) and Conductor updates the signal automatically.",
    example: "Text your contractor: \"Confirming your appointment Thursday at 2pm. Reply CONFIRM to confirm.\"",
    screenLink: '/communicate' },
  { id: 'relay', section: 'Communication', sectionNumber: 5, title: 'Signal Relay',
    body: "Household members — including children with Conductor Junior — can add signals directly. A child can tell Conductor they need school supplies and it appears immediately in the parent's brief, attributed to that child.",
    example: "Mia adds \"Need colored pencils by Friday\" → parent gets: \"[MIA ADDED] School supplies needed by Friday\"",
    screenLink: '/junior' },

  // ── Section 6 — Privacy & Data ──
  { id: 'reads', section: 'Privacy & Data', sectionNumber: 6, title: 'What Conductor Reads',
    body: "Conductor reads your Gmail to find signals, your Google Calendar for conflict detection, and Apple Health for synthesis. It never reads emails that don't generate signals and never stores email content — only the structured signal it extracts.",
    example: "An Amazon shipping email becomes a delivery signal. The email content is immediately discarded.",
    screenLink: '/privacy-dashboard' },
  { id: 'never', section: 'Privacy & Data', sectionNumber: 6, title: 'What Conductor Never Does',
    body: "Conductor never sells your data. Never shares your household information without explicit permission. Never reads emails that don't generate signals. Never stores health data on external servers. The brief is generated from your data — not from data about other households.",
    example: "Your household's signals are yours. They never train models or inform other households without your permission.",
    screenLink: '/privacy-dashboard' },
  { id: 'network-privacy', section: 'Privacy & Data', sectionNumber: 6, title: 'The Network and Privacy',
    body: "Network connections only see what you explicitly share with them. Permission levels are set by you and can be changed or revoked at any time. Watchful connections see only signal load. Open connections see signal descriptions. Emergency-only connections see nothing unless something urgent arises.",
    example: "Your parents on Watchful level see: \"2 signals in motion.\" Nothing more unless you change it.",
    screenLink: '/network' },
  { id: 'controls', section: 'Privacy & Data', sectionNumber: 6, title: 'Your Data Controls',
    body: "You can export all your household data as a JSON file at any time. You can delete your account and all associated data permanently. You can see exactly which emails generated which signals in the Privacy Dashboard. Your data is yours.",
    example: "Settings → Privacy & Data → Export my data downloads everything Conductor knows about your household.",
    screenLink: '/privacy-dashboard' },
];

const SECTION_PILLS: { label: string; section: string | 'all' }[] = [
  { label: 'All', section: 'all' },
  { label: 'Basics', section: 'The Basics' },
  { label: 'Household', section: 'Your Household' },
  { label: 'Intelligence', section: 'Intelligence' },
  { label: 'Planning', section: 'Planning' },
  { label: 'Communication', section: 'Communication' },
  { label: 'Privacy', section: 'Privacy & Data' },
];

// Map screenLink → friendly name for the "Open X →" link.
const SCREEN_NAMES: Record<string, string> = {
  '/': 'Ground',
  '/hover': 'Hover',
  '/vault': 'Vault',
  '/crew': 'Crew',
  '/horizon': 'Horizon',
  '/programme': 'Programme',
  '/inventory': 'Home Inventory',
  '/maintenance': 'Maintenance plan',
  '/transition': 'Life Transitions',
  '/journal': 'Memory Journal',
  '/network': 'Network',
  '/communicate': 'Email composer',
  '/junior': 'Conductor Junior',
  '/settings': 'Settings',
  '/privacy-dashboard': 'Privacy Dashboard',
};

export default function DirectoryScreen() {
  const params = useLocalSearchParams<{ card?: string; screen?: string }>();
  const { width } = useWindowDimensions();
  const cardWidth = width - 40; // 20px peek on each side
  const listRef = useRef<FlatList<DirectoryCard>>(null);

  const [activeIndex, setActiveIndex] = useState(0);

  // Resolve an initial card from params on mount.
  const initialIndex = useMemo(() => {
    if (params?.card) {
      const idx = CARDS.findIndex((c) => c.id === params.card);
      if (idx >= 0) return idx;
    }
    if (params?.screen) {
      const idx = CARDS.findIndex((c) => c.screenLink === params.screen);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [params?.card, params?.screen]);

  useEffect(() => {
    if (initialIndex > 0) {
      setActiveIndex(initialIndex);
      // Defer scrollToIndex past first layout pass.
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      }, 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / cardWidth);
    if (i !== activeIndex && i >= 0 && i < CARDS.length) {
      setActiveIndex(i);
    }
  }, [cardWidth, activeIndex]);

  function jumpToSection(section: string | 'all') {
    let target = 0;
    if (section !== 'all') {
      const idx = CARDS.findIndex((c) => c.section === section);
      if (idx >= 0) target = idx;
    }
    setActiveIndex(target);
    listRef.current?.scrollToIndex({ index: target, animated: true });
  }

  const activeCard = CARDS[activeIndex];
  const activeSectionCards = CARDS.filter((c) => c.section === activeCard?.section);
  const positionInSection = activeSectionCards.findIndex((c) => c.id === activeCard?.id);

  return (
    <View style={styles.container}>
      <View style={styles.headerWrap}>
        <TouchableOpacity onPress={() => router.back()} style={styles.topBack}>
          <Text style={styles.topBackText}>← Return</Text>
        </TouchableOpacity>
        <Text style={styles.counter}>{activeIndex + 1} of {CARDS.length}</Text>
      </View>

      <Text style={styles.title}>Directory</Text>
      <Text style={styles.subtitle}>Your guide to Conductor</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}>
        {SECTION_PILLS.map((p) => {
          const isActive =
            p.section === 'all'
              ? false
              : activeCard?.section === p.section;
          return (
            <TouchableOpacity
              key={p.label}
              onPress={() => jumpToSection(p.section)}
              style={[styles.pill, isActive && styles.pillActive]}>
              <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <FlatList
        ref={listRef}
        data={CARDS}
        keyExtractor={(c) => c.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 20 }}
        getItemLayout={(_, index) => ({
          length: cardWidth,
          offset: cardWidth * index,
          index,
        })}
        renderItem={({ item }) => (
          <View style={[styles.cardOuter, { width: cardWidth }]}>
            <View style={styles.card}>
              <Text style={styles.cardSection}>{item.section.toUpperCase()}</Text>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <View style={styles.brassDivider} />
              <Text style={styles.cardBody}>{item.body}</Text>
              {item.example ? (
                <Text style={styles.cardExample}>{item.example}</Text>
              ) : null}
              {item.screenLink ? (
                <TouchableOpacity
                  onPress={() => {
                    router.back();
                    setTimeout(() => router.push(item.screenLink as any), 30);
                  }}
                  style={styles.openLinkRow}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.openLink}>
                    Open {SCREEN_NAMES[item.screenLink] || item.screenLink} →
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
      />

      <View style={styles.dotsRow}>
        {activeSectionCards.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === positionInSection && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, paddingTop: 60 },
  headerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  topBack: { paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, fontSize: 13, letterSpacing: 0.3 },
  counter: { color: MUTED, fontSize: 10, letterSpacing: 1 },

  title: {
    color: OFF_WHITE,
    fontSize: 28,
    fontWeight: '300',
    letterSpacing: 0.2,
    paddingHorizontal: 22,
    marginTop: 8,
  },
  subtitle: {
    color: MUTED,
    fontSize: 13,
    marginTop: 4,
    paddingHorizontal: 22,
  },

  pillRow: {
    paddingHorizontal: 22,
    paddingVertical: 18,
    gap: 8,
  },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  pillActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184,150,12,0.10)',
  },
  pillText: { color: FAINT, fontSize: 12, letterSpacing: 0.3 },
  pillTextActive: { color: BRASS, fontWeight: '600' },

  cardOuter: { paddingHorizontal: 8 },
  card: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    borderRadius: 16,
    padding: 24,
    minHeight: 360,
  },
  cardSection: {
    color: MUTED,
    fontSize: 9,
    letterSpacing: 2,
  },
  cardTitle: {
    color: OFF_WHITE,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 8,
  },
  brassDivider: {
    height: 1,
    backgroundColor: 'rgba(184,150,12,0.45)',
    marginVertical: 12,
  },
  cardBody: {
    color: OFF_WHITE,
    fontSize: 14,
    lineHeight: 22,
  },
  cardExample: {
    color: MUTED,
    fontStyle: 'italic',
    fontSize: 13,
    marginTop: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: BRASS,
    lineHeight: 20,
  },
  openLinkRow: { marginTop: 18 },
  openLink: { color: BRASS, fontSize: 12, letterSpacing: 0.4, fontWeight: '500' },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dotActive: {
    backgroundColor: BRASS,
    width: 18,
  },
});
