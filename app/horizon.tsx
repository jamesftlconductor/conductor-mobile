import { router } from 'expo-router';
import { HelpButton } from '@/components/HelpButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SignalFilterPills } from '@/components/SignalFilterPills';
import { useSignalFilter, applyFilter as applyMeCrewHouse } from '@/hooks/useSignalFilter';
import { SwipeableRow } from '@/components/SwipeableRow';
import { PulsingCMark } from '@/components/PulsingCMark';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Alert,
  LayoutAnimation,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';

import { metaFor, type Signal } from '@/components/signalTypes';
import { useUserId } from '@/hooks/useUserId';
import { useTheme } from './theme';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

const FAINT = '#3a3835';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const SAGE = '#86efac';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type ThemeColors = { background: string; text: string; muted: string };

const DAY_MS = 24 * 60 * 60 * 1000;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ---------- types ----------

type VaultItem = {
  id: string;
  description?: string;
  provider?: string | null;
  category?: string;
  renewalDate?: string | null;
  amount?: string | number | null;
  source?: string;
  notes?: string | null;
  handled?: boolean;
};

type CrewMember = {
  memberType?: string;
  userId?: string;
  firstName?: string;
  name?: string;
  birthday?: string;
  anniversary?: string;
  upcomingEvents?: { date?: string; description?: string }[];
};

type FilterKey = 'all' | 'travel' | 'deadlines' | 'appointments' | 'crew' | 'vault';

type Item = {
  id: string;
  kind: 'signal' | 'vault' | 'crew_event' | 'birthday' | 'anniversary';
  description: string;
  date: string;             // ISO-ish for sorting
  dateMs: number;
  emoji: string;
  ownerTag?: string;
  source: 'signal' | 'vault' | 'gmail' | 'crew';
  signalRef?: Signal;       // when kind === 'signal'
  vaultRef?: VaultItem;     // when kind === 'vault'
  // Fields the user can edit inline; populated from the signal record
  // for kind === 'signal' only.
  notes?: string | null;
  confirmationNumber?: string | null;
  notedAt?: string | null;
  signalType?: string;
};

// ---------- helpers ----------

function ymdToMs(d: string): number {
  const ms = Date.parse(d);
  return isNaN(ms) ? 0 : ms;
}

function daysUntil(ms: number): number {
  return Math.round((ms - Date.now()) / DAY_MS);
}

function formatDate(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function bucketFor(days: number): 'coming' | 'further' | 'edge' | null {
  if (days >= 14 && days <= 30) return 'coming';
  if (days > 30 && days <= 90) return 'further';
  if (days > 90) return 'edge';
  return null;
}

function bucketColor(
  bucket: 'coming' | 'further' | 'edge',
  days: number,
  accentColor: string,
  mutedColor: string,
  daysOverdue?: boolean
): string {
  if (daysOverdue) return RED;
  if (bucket === 'coming') return AMBER;
  if (bucket === 'further') return accentColor;
  return mutedColor;
}

// Progress (0-1) within the bucket's day window. Used to draw the
// proximity bar — fills as the date approaches the bucket's lower edge.
function progressWithinBucket(bucket: 'coming' | 'further' | 'edge', days: number): number {
  if (bucket === 'coming') return Math.max(0, Math.min(1, (30 - days) / (30 - 14)));
  if (bucket === 'further') return Math.max(0, Math.min(1, (90 - days) / (90 - 30)));
  // For "edge" (>90), we can't bound the window — show a faint fill at 5%
  // so the bar still looks like a progress indicator without being misleading.
  return 0.05;
}

function mmddToNextDate(mmdd: string, today: Date): Date | null {
  const m = mmdd?.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10) - 1;
  const day = parseInt(m[2], 10);
  const thisYear = new Date(today.getFullYear(), month, day);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (thisYear.getTime() < startOfToday.getTime()) {
    return new Date(today.getFullYear() + 1, month, day);
  }
  return thisYear;
}

// Build the unified item list from raw signals + vault + crew arrays.
// Filters to 14+ days only — anything closer belongs on Hover/Programme.
function buildItems(args: {
  signals: Signal[];
  vault: VaultItem[];
  crew: CrewMember[];
  today: Date;
  userId: string;
}): { items: Item[]; memberMap: Map<string, string> } {
  const { signals, vault, crew, today, userId } = args;
  const items: Item[] = [];
  const fourteen = today.getTime() + 14 * DAY_MS;

  const memberMap = new Map<string, string>();
  for (const m of crew || []) {
    if (!m) continue;
    if (m.memberType === 'member' && m.userId && m.firstName && m.userId !== userId) {
      memberMap.set(m.userId, m.firstName);
    }
  }
  const ownerTagFor = (uid?: string) => {
    if (!uid || uid === userId) return undefined;
    const name = memberMap.get(uid);
    return name ? `${name}'s` : undefined;
  };

  // Signals — include both dated items in the 14+ window AND no-date /
  // unparseable-date items (e.g. eta:"unknown" from the import
  // classifier). The latter land in the "On the Edge" bucket with a
  // synthetic far-future dateMs so they sort last and display "no date"
  // instead of a day-count. Only state=incoming/active reach this loop
  // since loadSignals already filters expired/resolved upstream.
  const FAR_FUTURE_MS = today.getTime() + 365 * DAY_MS; // synthetic edge-bucket anchor
  for (const s of signals || []) {
    if (!s) continue;
    const state = (s as Signal & { state?: string }).state;
    if (state && state !== 'incoming' && state !== 'active') continue;
    const rawMs = s.eta ? ymdToMs(s.eta) : 0;
    const hasUsableDate = rawMs >= fourteen;
    const noUsableDate = !s.eta || rawMs === 0 || (rawMs > 0 && rawMs < fourteen && rawMs < today.getTime() - 30 * DAY_MS);
    // Dated items in the near window (<14d) belong on Hover/Programme,
    // not Horizon — skip those. Items with parseable past dates >30d
    // ago are presumed stale and also skipped.
    if (!hasUsableDate && !s.eta) {
      // No eta at all — only show if the signal type warrants horizon
      // visibility (travel/deadline/reservation/service). Other types
      // without dates would clutter the edge bucket.
      if (!['travel', 'reservation', 'deadline', 'service'].includes(s.type || '')) continue;
    } else if (!hasUsableDate && s.eta && rawMs === 0) {
      // Unparseable eta string ("unknown", "TBD", etc.) — treat like
      // missing eta. Apply the same type gate.
      if (!['travel', 'reservation', 'deadline', 'service'].includes(s.type || '')) continue;
    } else if (!hasUsableDate) {
      // Parseable date but earlier than 14d out — belongs elsewhere.
      continue;
    }
    const meta = metaFor(s);
    items.push({
      id: `signal-${s.id}`,
      kind: 'signal',
      description: s.description || 'Unknown',
      date: hasUsableDate ? (s.eta || '') : '',
      dateMs: hasUsableDate ? rawMs : FAR_FUTURE_MS,
      emoji: meta.emoji,
      ownerTag: ownerTagFor((s as Signal & { userId?: string }).userId),
      source: 'gmail',
      signalRef: s,
      notes: (s as Signal & { notes?: string | null }).notes ?? null,
      confirmationNumber: (s as Signal & { confirmationNumber?: string | null }).confirmationNumber ?? null,
      notedAt: (s as Signal & { notedAt?: string | null }).notedAt ?? null,
      signalType: s.type,
    });
  }

  // Vault items
  for (const v of vault || []) {
    if (!v) continue;
    if (v.handled) continue;
    if (!v.renewalDate) continue;
    const ms = ymdToMs(v.renewalDate);
    if (!ms || ms < fourteen) continue;
    items.push({
      id: `vault-${v.id}`,
      kind: 'vault',
      description: v.description || 'Renewal',
      date: v.renewalDate,
      dateMs: ms,
      emoji: '📁',
      source: 'vault',
      vaultRef: v,
    });
  }

  // Crew events + birthdays + anniversaries
  for (const m of crew || []) {
    if (!m) continue;
    const memberEmoji = m.memberType === 'pet' ? '🐾' : '👤';
    const memberName = m.firstName || m.name || '';

    for (const ev of m.upcomingEvents || []) {
      if (!ev || !ev.date) continue;
      const ms = ymdToMs(ev.date);
      if (!ms || ms < fourteen) continue;
      items.push({
        id: `crew-${m.userId || memberName}-${ev.date}-${ev.description}`,
        kind: 'crew_event',
        description: memberName ? `${memberName}: ${ev.description || 'Event'}` : ev.description || 'Crew event',
        date: ev.date,
        dateMs: ms,
        emoji: memberEmoji,
        source: 'crew',
      });
    }

    if (m.birthday) {
      const d = mmddToNextDate(m.birthday, today);
      if (d && d.getTime() >= fourteen) {
        items.push({
          id: `bday-${memberName}-${d.toISOString().slice(0, 10)}`,
          kind: 'birthday',
          description: memberName ? `${memberName}'s birthday` : 'Birthday',
          date: d.toISOString().slice(0, 10),
          dateMs: d.getTime(),
          emoji: '🎂',
          source: 'crew',
        });
      }
    }
    if (m.anniversary) {
      const d = mmddToNextDate(m.anniversary, today);
      if (d && d.getTime() >= fourteen) {
        items.push({
          id: `anniv-${memberName}-${d.toISOString().slice(0, 10)}`,
          kind: 'anniversary',
          description: memberName ? `${memberName}'s anniversary` : 'Anniversary',
          date: d.toISOString().slice(0, 10),
          dateMs: d.getTime(),
          emoji: '💍',
          source: 'crew',
        });
      }
    }
  }

  items.sort((a, b) => a.dateMs - b.dateMs);
  return { items, memberMap };
}

// Description keywords that identify a reservation/service signal as
// travel-related (hotel bookings, flights, airport transfers, rental
// cars, etc.). A reservation with one of these strings belongs under
// the Travel filter alongside type === "travel" signals.
const TRAVEL_KEYWORDS = /\b(hotel|flight|airline|airport|airbnb|vrbo|resort|rental car|inn|lodge|booking|reservation\s+confirmation|trip\b|paris|london|tokyo|nyc|new york|los angeles|miami)\b/i;
function isTravelLike(item: Item): boolean {
  if (item.signalType === 'travel') return true;
  if (item.signalType === 'reservation' && TRAVEL_KEYWORDS.test(item.description)) return true;
  return false;
}

function matchesFilter(item: Item, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'vault') return item.kind === 'vault';
  if (filter === 'crew') return item.kind === 'crew_event' || item.kind === 'birthday' || item.kind === 'anniversary';
  if (filter === 'travel') return isTravelLike(item);
  if (filter === 'deadlines') return item.signalType === 'deadline' || item.kind === 'vault';
  if (filter === 'appointments') return item.signalType === 'appointment' || item.signalType === 'service' || item.signalType === 'reservation';
  return true;
}

// ---------- screen ----------

export default function HorizonScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const MUTED = theme.muted;
  const [signals, setSignals] = useState<Signal[]>([]);
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const { filter: meCrewHouse, setFilter: setMeCrewHouse } = useSignalFilter('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [sigRes, vaultRes, crewRes] = await Promise.allSettled([
      fetch(`${API_BASE}/signals?userId=${userId}`),
      fetch(`${API_BASE}/signals?type=vault&userId=${userId}`),
      fetch(`${API_BASE}/signals?type=crew&userId=${userId}`),
    ]);
    async function jsonOk<T>(r: PromiseSettledResult<Response>): Promise<T | null> {
      if (r.status !== 'fulfilled' || !r.value.ok) return null;
      try { return (await r.value.json()) as T; } catch { return null; }
    }
    const sig = await jsonOk<{ signals?: Signal[] }>(sigRes);
    const v = await jsonOk<{ items?: VaultItem[] }>(vaultRes);
    const c = await jsonOk<{ crew?: CrewMember[] }>(crewRes);
    setSignals(Array.isArray(sig?.signals) ? sig!.signals! : []);
    setVault(Array.isArray(v?.items) ? v!.items! : []);
    setCrew(Array.isArray(c?.crew) ? c!.crew! : []);
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const filteredSignals = useMemo(
    () => applyMeCrewHouse(signals, meCrewHouse, userId),
    [signals, meCrewHouse]
  );

  const grouped = useMemo(() => {
    const { items } = buildItems({ signals: filteredSignals, vault, crew, today: new Date(), userId });
    const filtered = items.filter((i) => matchesFilter(i, filter));
    const buckets: Record<'coming' | 'further' | 'edge', Item[]> = {
      coming: [], further: [], edge: [],
    };
    for (const it of filtered) {
      const days = daysUntil(it.dateMs);
      const b = bucketFor(days);
      if (!b) continue;
      buckets[b].push(it);
    }
    return buckets;
  }, [filteredSignals, vault, crew, filter]);

  function toggle(id: string) {
    LayoutAnimation.configureNext({
      duration: 200,
      update: { type: 'easeInEaseOut' },
    });
    setExpandedId((c) => (c === id ? null : id));
  }

  // ---------- actions ----------

  async function patchSignalField(item: Item, field: 'notes' | 'confirmationNumber', value: string) {
    if (!item.signalRef) return;
    const next = value.trim() || null;
    setSignals((prev) =>
      prev.map((s) => (String(s.id) === String(item.signalRef!.id) ? { ...s, [field]: next } : s))
    );
    try {
      await fetch(`${API_BASE}/signals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.signalRef.id, userId: userId, [field]: next }),
      });
    } catch { load(); }
  }

  async function noteItem(item: Item) {
    if (!item.signalRef) return;
    const notedAt = new Date().toISOString();
    setSignals((prev) =>
      prev.map((s) => (String(s.id) === String(item.signalRef!.id) ? { ...s, notedAt } : s))
    );
    try {
      await fetch(`${API_BASE}/signals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.signalRef.id, userId: userId, state: 'active', notedAt }),
      });
    } catch { load(); }
  }

  async function restItem(item: Item) {
    if (!item.signalRef) return;
    setSignals((prev) => prev.filter((s) => String(s.id) !== String(item.signalRef!.id)));
    try {
      await fetch(`${API_BASE}/signals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.signalRef.id, userId: userId, state: 'resolved' }),
      });
    } catch { load(); }
  }

  async function moveToVault(item: Item) {
    if (!item.signalRef) return;
    const s = item.signalRef;
    // Detect provider from sender when possible — most household signals
    // have a sender (FedEx, AMC, etc.) which doubles as the vault
    // "provider" line.
    const provider = (s as Signal & { sender?: string | null }).sender || null;
    Alert.alert(
      'Move to Vault',
      `Move "${s.description}" to your Vault? It will stop appearing on the Horizon.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/signals?type=vault`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId: userId,
                  action: 'add',
                  item: {
                    description: s.description,
                    provider,
                    renewalDate: s.eta,
                    category: 'other',
                    source: 'manual',
                  },
                }),
              });
              await fetch(`${API_BASE}/signals`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: s.id, userId: userId }),
              });
              setSignals((prev) => prev.filter((x) => String(x.id) !== String(s.id)));
              await load();
              router.push('/vault' as never);
            } catch {
              // best-effort
            }
          },
        },
      ]
    );
  }

  // ---------- render ----------

  const sectionsInOrder: { key: 'coming' | 'further' | 'edge'; label: string; sub: string; items: Item[] }[] = [
    { key: 'coming',  label: 'Coming Up',   sub: 'Getting closer. Worth keeping in mind.',     items: grouped.coming },
    { key: 'further', label: 'Further Out', sub: 'On the radar. Plenty of time.',              items: grouped.further },
    { key: 'edge',    label: 'On the Edge', sub: 'Far horizon. Conductor is watching.',         items: grouped.edge },
  ];
  const anyItems = sectionsInOrder.some((s) => s.items.length > 0);

  const filterKeys: { key: FilterKey; label: string }[] = [
    { key: 'all',          label: 'All' },
    { key: 'travel',       label: 'Travel' },
    { key: 'deadlines',    label: 'Deadlines' },
    { key: 'appointments', label: 'Appointments' },
    { key: 'crew',         label: 'Crew' },
    { key: 'vault',        label: 'Vault' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
    <ScreenHeader title="The Horizon" subtitle="What Conductor is watching ahead" screenContext="horizon" />
    <SignalFilterPills value={meCrewHouse} onChange={setMeCrewHouse} />
    <HelpButton cardId="horizon" />
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={MUTED} />
      }>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}>
        {filterKeys.map((f) => (
          <TouchableOpacity
            key={f.key}
            onPress={() => setFilter(f.key)}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
            <Text style={[styles.filterPill, filter === f.key && styles.filterPillActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.empty}>
          <PulsingCMark size={30} />
        </View>
      ) : !anyItems ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>The horizon is clear.</Text>
          <Text style={styles.emptySubtext}>
            Conductor is watching — things will surface here as they come into range.
          </Text>
        </View>
      ) : (
        sectionsInOrder
          .filter((s) => s.items.length > 0)
          .map((section) => (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionLabel}>{section.label.toUpperCase()}</Text>
              <Text style={styles.sectionSub}>{section.sub}</Text>
              <View style={styles.sectionLine} />
              {section.items.map((it) => (
                <SwipeableRow
                  key={it.id}
                  onRest={() => restItem(it)}
                  onRemove={() => moveToVault(it)}
                  removeLabel="To Vault">
                  <HorizonItemRow
                    item={it}
                    bucket={section.key}
                    expanded={expandedId === it.id}
                    onToggle={() => toggle(it.id)}
                    onPatch={(field, value) => patchSignalField(it, field, value)}
                    onNoted={() => noteItem(it)}
                    onMoveToVault={() => moveToVault(it)}
                    onRest={() => restItem(it)}
                    relatedSignals={
                      it.signalRef
                        ? signals.filter((s) =>
                            String(s.id) !== String(it.signalRef!.id) &&
                            ((s.sender && (it.signalRef as Signal & { sender?: string }).sender &&
                              s.sender === (it.signalRef as Signal & { sender?: string }).sender) ||
                              (s.type && s.type === it.signalRef!.type))
                          ).slice(0, 3)
                        : []
                    }
                  />
                </SwipeableRow>
              ))}
            </View>
          ))
      )}
    </ScrollView>
    </View>
  );
}

function HorizonItemRow({
  item, bucket, expanded, onToggle, onPatch, onNoted, onMoveToVault, onRest, relatedSignals,
}: {
  item: Item;
  bucket: 'coming' | 'further' | 'edge';
  expanded: boolean;
  onToggle: () => void;
  onPatch: (field: 'notes' | 'confirmationNumber', value: string) => void;
  onNoted: () => void;
  onMoveToVault: () => void;
  onRest: () => void;
  relatedSignals: Signal[];
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const days = daysUntil(item.dateMs);
  const color = bucketColor(bucket, days, accentColor, theme.muted);
  const progress = progressWithinBucket(bucket, days);
  const noted = !!item.notedAt;

  const sourceBadge =
    item.source === 'vault' ? '📁 Vault'
    : item.source === 'crew' ? '👤 Crew'
    : '📧 Gmail';

  // Inline-edit drafts — controlled until blur, same commit-on-blur
  // pattern the vault and work-calendar inputs use.
  const [notesDraft, setNotesDraft] = useState(item.notes || '');
  const [confDraft, setConfDraft] = useState(item.confirmationNumber || '');

  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      style={[styles.itemRow, noted && { opacity: 0.7 }]}>
      <View style={styles.itemHeaderRow}>
        <Text style={styles.itemEmoji}>{item.emoji}</Text>
        <View style={styles.itemBody}>
          <Text style={styles.itemDescription} numberOfLines={2}>
            {item.description}
          </Text>
          {item.ownerTag ? (
            <Text style={styles.itemOwner}>[{item.ownerTag}]</Text>
          ) : null}
          <View style={styles.itemMetaRow}>
            <Text style={[styles.itemDays, { color }]}>
              {item.date ? `${days}d` : 'no date'}
            </Text>
            <Text style={styles.itemSourceBadge}>{sourceBadge}</Text>
            {noted ? (
              <Text style={styles.itemNotedBadge}>
                Noted ✓ {item.notedAt ? new Date(item.notedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
              </Text>
            ) : null}
          </View>
        </View>
        <Text style={styles.itemDate}>{item.date ? formatDate(item.dateMs) : ''}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: color }]} />
      </View>

      {expanded ? (
        <View style={styles.expandedBlock}>
          {item.kind === 'signal' ? (
            <>
              <View style={styles.inlineField}>
                <Text style={styles.inlineLabel}>Confirmation #</Text>
                <TextInput
                  value={confDraft}
                  onChangeText={setConfDraft}
                  onBlur={() => {
                    if ((confDraft.trim() || null) !== (item.confirmationNumber || null)) {
                      onPatch('confirmationNumber', confDraft);
                    }
                  }}
                  placeholder="tap to add"
                  placeholderTextColor={FAINT}
                  style={styles.inlineInput}
                />
              </View>
              <View style={styles.inlineField}>
                <Text style={styles.inlineLabel}>Notes</Text>
                <TextInput
                  value={notesDraft}
                  onChangeText={setNotesDraft}
                  onBlur={() => {
                    if ((notesDraft.trim() || null) !== (item.notes || null)) {
                      onPatch('notes', notesDraft);
                    }
                  }}
                  placeholder="Add notes..."
                  placeholderTextColor={FAINT}
                  style={[styles.inlineInput, styles.inlineMultiline]}
                  multiline
                />
              </View>
              {relatedSignals.length > 0 ? (
                <View style={styles.relatedBlock}>
                  <Text style={styles.relatedLabel}>RELATED</Text>
                  {relatedSignals.map((s) => (
                    <Text key={String(s.id)} style={styles.relatedLine}>· {s.description}</Text>
                  ))}
                </View>
              ) : null}
              {noted ? (
                <Text style={styles.notedHistory}>
                  Noted on {new Date(item.notedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <TouchableOpacity onPress={onNoted} style={[styles.actionBtn, styles.actionNoted]}>
                  <Text style={styles.actionNotedText}>{noted ? 'Noted ✓' : 'Noted'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onMoveToVault} style={styles.actionVault}>
                  <Text style={styles.actionVaultText}>Move to Vault</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onRest} style={styles.actionRest}>
                  <Text style={styles.actionRestText}>Rest</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text style={styles.nonSignalNote}>
              {item.kind === 'vault' ? 'Open Vault to edit this entry.'
                : 'Crew events sync from your household — manage names and dates in Crew.'}
            </Text>
          )}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 60 },
    topBack: {
      alignSelf: 'flex-start',
      paddingVertical: 6,
      paddingHorizontal: 4,
      marginBottom: 8,
    },
    topBackText: { color: theme.muted, fontSize: 13, letterSpacing: 0.3 },
    title: {
      color: theme.text,
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.5,
      marginBottom: 6,
    },
    subtitle: {
      color: theme.muted,
      fontSize: 13,
      paddingBottom: 16,
      letterSpacing: 0.2,
    },
    filterRow: {
      paddingVertical: 4,
      gap: 8,
      flexDirection: 'row',
      marginBottom: 16,
    },
    filterPill: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: 'uppercase',
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: SOFT_BORDER,
    },
    filterPillActive: {
      color: theme.background,
      backgroundColor: accentColor,
      borderColor: accentColor,
      fontWeight: '700',
    },
    section: { marginBottom: 24 },
    sectionLabel: {
      color: accentColor,
      fontSize: 10,
      letterSpacing: 3,
      fontWeight: '600',
      marginBottom: 2,
    },
    sectionSub: { color: theme.muted, fontSize: 11, fontStyle: 'italic', marginBottom: 6 },
    sectionLine: {
      height: 1,
      backgroundColor: 'rgba(184, 150, 12, 0.25)',
      marginBottom: 8,
    },
    itemRow: {
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: SOFT_BORDER,
    },
    itemHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    itemEmoji: { fontSize: 20, lineHeight: 24, width: 28 },
    itemBody: { flex: 1, gap: 2 },
    itemDescription: { color: theme.text, fontSize: 14, lineHeight: 19 },
    itemOwner: { color: theme.muted, fontSize: 11, letterSpacing: 0.3 },
    itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 },
    itemDays: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
    itemSourceBadge: { color: theme.muted, fontSize: 9, letterSpacing: 0.5, fontWeight: '600' },
    itemNotedBadge: { color: SAGE, fontSize: 11, letterSpacing: 0.3 },
    itemDate: { color: theme.muted, fontSize: 12, letterSpacing: 0.3 },
    progressTrack: {
      height: 2,
      backgroundColor: 'rgba(255,255,255,0.05)',
      marginTop: 8,
      marginLeft: 40,
      borderRadius: 1,
      overflow: 'hidden',
    },
    progressFill: { height: 2 },
    expandedBlock: {
      paddingTop: 14,
      paddingLeft: 40,
      gap: 10,
    },
    inlineField: { gap: 3 },
    inlineLabel: {
      color: theme.muted,
      fontSize: 10,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    },
    inlineInput: {
      color: theme.text,
      fontSize: 13,
      paddingVertical: 4,
      paddingHorizontal: 0,
      borderBottomWidth: 1,
      borderBottomColor: SOFT_BORDER,
    },
    inlineMultiline: { minHeight: 50 },
    relatedBlock: { gap: 2, marginTop: 6 },
    relatedLabel: {
      color: theme.muted,
      fontSize: 10,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    relatedLine: { color: theme.muted, fontSize: 12, lineHeight: 17 },
    notedHistory: { color: SAGE, fontSize: 11, fontStyle: 'italic' },
    nonSignalNote: { color: theme.muted, fontSize: 12, fontStyle: 'italic' },
    actionRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 10,
      flexWrap: 'wrap',
    },
    actionBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
    actionNoted: { backgroundColor: accentColor },
    actionNotedText: { color: theme.background, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    actionVault: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: SOFT_BORDER },
    actionVaultText: { color: theme.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
    actionRest: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
    actionRestText: { color: RED, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, opacity: 0.7 },
    empty: { alignItems: 'center', paddingVertical: 80, gap: 8 },
    emptyText: { color: theme.muted, fontSize: 14, letterSpacing: 0.3 },
    emptySubtext: { color: theme.muted, fontSize: 12, letterSpacing: 0.3, textAlign: 'center', paddingHorizontal: 24 },
  });
}
