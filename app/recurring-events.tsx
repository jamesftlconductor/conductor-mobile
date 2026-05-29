// Annual Calendar — household-level recurring events Conductor
// surfaces each year. Pulls from /api/signals?type=recurringEvents
// which auto-seeds defaults on first read. Grouped by category;
// each row has an active toggle. Bottom sheet to add custom events;
// swipe to delete.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useUserId } from '@/hooks/useUserId';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonStack } from '@/components/SkeletonRow';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

type Recurrence = 'annual' | 'quarterly' | 'monthly';
type Category = 'financial' | 'health' | 'family' | 'home' | 'work' | 'other';

type RecurringEvent = {
  id: string;
  name: string;
  description: string;
  recurrence: Recurrence;
  month: number | null;
  dayOfMonth: number | null;
  weeksBefore: number;
  category: Category;
  active: boolean;
};

const CATEGORY_ORDER: { id: Category; label: string; emoji: string }[] = [
  { id: 'financial', label: 'FINANCIAL', emoji: '💰' },
  { id: 'health', label: 'HEALTH', emoji: '❤️' },
  { id: 'family', label: 'FAMILY', emoji: '👨‍👩‍👧' },
  { id: 'home', label: 'HOME', emoji: '🏠' },
  { id: 'work', label: 'WORK', emoji: '💼' },
  { id: 'other', label: 'OTHER', emoji: '📅' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatTiming(ev: RecurringEvent): string {
  if (ev.recurrence === 'annual') {
    if (ev.month) return `Annual — surfaces in ${MONTH_NAMES[ev.month - 1]}`;
    return 'Annual';
  }
  if (ev.recurrence === 'quarterly') return 'Quarterly';
  return 'Monthly';
}

export default function RecurringEventsScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [userId, setUserId] = useState<string>('');
  const [events, setEvents] = useState<RecurringEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const activeUserId = useUserId();
  useEffect(() => {
    setUserId(activeUserId || '');
  }, [activeUserId]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=recurringEvents&userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (Array.isArray(data?.events)) setEvents(data.events);
    } catch { /* best-effort */ }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  async function toggleActive(ev: RecurringEvent) {
    const nextActive = !ev.active;
    setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, active: nextActive } : e)));
    try {
      await fetch(`${API_BASE}/signals?type=recurringEvents`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, id: ev.id, active: nextActive }),
      });
    } catch {
      // Roll back on failure
      setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, active: ev.active } : e)));
    }
  }

  async function deleteEvent(ev: RecurringEvent) {
    Alert.alert(
      'Remove event?',
      `Remove "${ev.name}" from your annual calendar?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setEvents((prev) => prev.filter((e) => e.id !== ev.id));
            try {
              await fetch(`${API_BASE}/signals?type=recurringEvents`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, id: ev.id }),
              });
            } catch { /* best-effort */ }
          },
        },
      ]
    );
  }

  const grouped = useMemo(() => {
    const map: Record<Category, RecurringEvent[]> = {
      financial: [], health: [], family: [], home: [], work: [], other: [],
    };
    for (const e of events) {
      const cat = (CATEGORY_ORDER.find((c) => c.id === e.category) ? e.category : 'other') as Category;
      map[cat].push(e);
    }
    return map;
  }, [events]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Annual Calendar" subtitle="Events Conductor surfaces each year" />
      <ScrollView contentContainerStyle={styles.scroll}>

        {loading ? (
          <SkeletonStack rows={5} />
        ) : events.length === 0 ? (
          <EmptyState
            message="No recurring events yet. Add the dates that come around every year — renewals, checkups, anniversaries — and Conductor will surface them in time."
            actionLabel="Add custom event"
            onAction={() => setAddOpen(true)}
          />
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const list = grouped[cat.id];
            if (list.length === 0) return null;
            return (
              <View key={cat.id} style={styles.sectionBlock}>
                <SectionLabel title={`${cat.emoji}  ${cat.label}`} />
                {list.map((ev) => (
                  <EventRow
                    key={ev.id}
                    ev={ev}
                    onToggle={() => toggleActive(ev)}
                    onDelete={() => deleteEvent(ev)}
                  />
                ))}
              </View>
            );
          })
        )}

        <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+ Add custom event</Text>
        </TouchableOpacity>
      </ScrollView>

      <AddEventSheet
        visible={addOpen}
        userId={userId}
        onClose={() => setAddOpen(false)}
        onAdded={(e) => {
          setEvents((prev) => prev.filter((x) => x.id !== e.id).concat(e));
          setAddOpen(false);
        }}
      />
    </View>
  );
}

function EventRow({
  ev, onToggle, onDelete,
}: { ev: RecurringEvent; onToggle: () => void; onDelete: () => void }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const BRASS = accentColor;
  const MUTED = theme.muted;
  return (
    <View style={[styles.eventRow, !ev.active && { opacity: 0.55 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.eventName}>{ev.name}</Text>
        <Text style={styles.eventTiming}>{formatTiming(ev)}</Text>
        {ev.description ? (
          <Text style={styles.eventDesc}>{ev.description}</Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Switch
          value={ev.active}
          onValueChange={onToggle}
          trackColor={{ false: theme.border, true: BRASS }}
          thumbColor={ev.active ? theme.background : theme.muted}
        />
        <TouchableOpacity onPress={onDelete} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={styles.eventDeleteLink}>Remove</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AddEventSheet({
  visible, userId, onClose, onAdded,
}: {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onAdded: (e: RecurringEvent) => void;
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const BRASS = accentColor;
  const MUTED = theme.muted;
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('other');
  const [recurrence, setRecurrence] = useState<Recurrence>('annual');
  const [month, setMonth] = useState<number>(1);
  const [weeksBefore, setWeeksBefore] = useState<number>(2);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName('');
    setCategory('other');
    setRecurrence('annual');
    setMonth(1);
    setWeeksBefore(2);
  }

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=recurringEvents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          event: {
            name: name.trim(),
            description: '',
            recurrence,
            month: recurrence === 'annual' ? month : null,
            dayOfMonth: 1,
            weeksBefore,
            category,
            active: true,
          },
        }),
      });
      const data = await res.json();
      if (data?.event) {
        onAdded(data.event);
        reset();
      }
    } catch { /* best-effort */ }
    finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>New recurring event</Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Anniversary trip planning"
            placeholderTextColor={MUTED}
            style={styles.input}
          />

          <Text style={styles.sheetLabel}>CATEGORY</Text>
          <View style={styles.pillRow}>
            {CATEGORY_ORDER.map((c) => (
              <TouchableOpacity
                key={c.id}
                onPress={() => setCategory(c.id)}
                style={[styles.pill, category === c.id && styles.pillActive]}>
                <Text style={[styles.pillText, category === c.id && { color: BRASS, fontWeight: '600' }]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sheetLabel}>RECURRENCE</Text>
          <View style={styles.pillRow}>
            {(['annual', 'quarterly', 'monthly'] as Recurrence[]).map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setRecurrence(r)}
                style={[styles.pill, recurrence === r && styles.pillActive]}>
                <Text style={[styles.pillText, recurrence === r && { color: BRASS, fontWeight: '600' }]}>
                  {r === 'annual' ? 'Annual' : r === 'quarterly' ? 'Quarterly' : 'Monthly'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {recurrence === 'annual' ? (
            <>
              <Text style={styles.sheetLabel}>MONTH</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                {MONTH_NAMES.map((m, i) => (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setMonth(i + 1)}
                    style={[styles.pill, month === i + 1 && styles.pillActive]}>
                    <Text style={[styles.pillText, month === i + 1 && { color: BRASS, fontWeight: '600' }]}>
                      {m.slice(0, 3)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          ) : null}

          <Text style={styles.sheetLabel}>SURFACE</Text>
          <View style={styles.pillRow}>
            {[1, 2, 4, 6].map((w) => (
              <TouchableOpacity
                key={w}
                onPress={() => setWeeksBefore(w)}
                style={[styles.pill, weeksBefore === w && styles.pillActive]}>
                <Text style={[styles.pillText, weeksBefore === w && { color: BRASS, fontWeight: '600' }]}>
                  {w} week{w === 1 ? '' : 's'} before
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={add}
              disabled={saving || !name.trim()}
              style={[styles.saveBtn, (saving || !name.trim()) && { opacity: 0.5 }]}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Add'}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  const FAINT = theme.muted;
  const BRASS = accentColor;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 60 },
  topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, ...TOKENS.type.secondary, letterSpacing: 0.3 },
  title: { color: OFF_WHITE, ...TOKENS.type.header, fontWeight: '300', marginTop: 14 },
  subtitle: { color: MUTED, ...TOKENS.type.secondary, marginTop: 4, marginBottom: 28 },

  sectionBlock: { marginBottom: 28 },

  eventRow: {
    flexDirection: 'row',
    padding: TOKENS.card.padding,
    borderRadius: TOKENS.card.borderRadius,
    minHeight: 44,
    marginBottom: 10,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  eventName: { color: OFF_WHITE, ...TOKENS.type.subheader },
  eventTiming: { color: MUTED, ...TOKENS.type.secondary, marginTop: 4 },
  eventDesc: { color: FAINT, ...TOKENS.type.secondary, fontSize: 12, marginTop: 6, lineHeight: 16 },
  eventDeleteLink: { color: MUTED, ...TOKENS.type.secondary, fontSize: 12 },

  addBtn: {
    marginTop: 12,
    backgroundColor: BRASS,
    paddingVertical: 14,
    minHeight: 44,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: theme.background, ...TOKENS.type.body, fontWeight: '600', letterSpacing: 0.5 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 22, paddingBottom: 36,
  },
  sheetTitle: { color: OFF_WHITE, ...TOKENS.type.subheader, fontSize: 18, lineHeight: 24, marginBottom: 18 },
  sheetLabel: { color: MUTED, ...TOKENS.type.label, letterSpacing: 1.5, marginTop: 16, marginBottom: 8 },
  input: {
    color: OFF_WHITE, ...TOKENS.type.body,
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: theme.inputBackground,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  pillActive: { borderColor: BRASS, backgroundColor: theme.inputBackground },
  pillText: { color: FAINT, ...TOKENS.type.secondary, fontSize: 12 },

  cancelBtn: {
    flex: 1, paddingVertical: 12, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
  },
  cancelText: { color: MUTED, ...TOKENS.type.secondary },
  saveBtn: {
    flex: 1, paddingVertical: 12, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: BRASS,
  },
  saveBtnText: { color: theme.background, ...TOKENS.type.secondary, fontWeight: '600' },
  });
}
