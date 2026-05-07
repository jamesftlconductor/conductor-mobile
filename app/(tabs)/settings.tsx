import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { ChevronRight, Lock } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const SAGE = '#86efac';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

type CategoryKey =
  | 'finance'
  | 'travel'
  | 'health-deadlines'
  | 'relationships'
  | 'home-maintenance'
  | 'documents';

const CATEGORIES: { key: CategoryKey; label: string; storeKey: string }[] = [
  { key: 'finance',          label: 'Finance',          storeKey: 'category_financeEnabled' },
  { key: 'travel',           label: 'Travel',           storeKey: 'category_travelEnabled' },
  { key: 'health-deadlines', label: 'Health deadlines', storeKey: 'category_healthDeadlinesEnabled' },
  { key: 'relationships',    label: 'Relationships',    storeKey: 'category_relationshipsEnabled' },
  { key: 'home-maintenance', label: 'Home maintenance', storeKey: 'category_homeMaintenanceEnabled' },
  { key: 'documents',        label: 'Documents',        storeKey: 'category_documentsEnabled' },
];

const HORIZON_FREQUENCIES = ['Weekly', 'Bi-weekly', 'Monthly'] as const;
type HorizonFrequency = (typeof HORIZON_FREQUENCIES)[number];

type Settings = {
  takeoffTime: string;       // "HH:MM" 24-hour
  clearanceTime: string;     // "HH:MM" 24-hour
  healthEnabled: boolean;
  childcareEnabled: boolean;
  categoryEnabled: Record<CategoryKey, boolean>;
  horizonEnabled: boolean;
  horizonFrequency: HorizonFrequency;
};

const DEFAULTS: Settings = {
  takeoffTime: '07:00',
  clearanceTime: '21:00',
  healthEnabled: true,
  childcareEnabled: true,
  categoryEnabled: {
    finance: false,
    travel: false,
    'health-deadlines': false,
    relationships: false,
    'home-maintenance': false,
    documents: false,
  },
  horizonEnabled: true,
  horizonFrequency: 'Weekly',
};

function format12Hour(hhmm: string) {
  const [h] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
}

function shiftHour(hhmm: string, delta: number): string {
  const [h] = hhmm.split(':').map((n) => parseInt(n, 10));
  const next = ((h + delta) % 24 + 24) % 24;
  return `${String(next).padStart(2, '0')}:00`;
}

function buildFlaggedCategories(map: Record<CategoryKey, boolean>): string[] {
  return CATEGORIES.filter((c) => map[c.key]).map((c) => c.label.toLowerCase());
}

async function persistAndSync(settings: Settings) {
  // Local persistence: one key per setting per spec.
  const writes: [string, string][] = [
    ['takeoffTime', settings.takeoffTime],
    ['clearanceTime', settings.clearanceTime],
    ['healthEnabled', String(settings.healthEnabled)],
    ['childcareEnabled', String(settings.childcareEnabled)],
    ['horizonEnabled', String(settings.horizonEnabled)],
    ['horizonFrequency', settings.horizonFrequency],
    ...CATEGORIES.map(
      (c) => [c.storeKey, String(settings.categoryEnabled[c.key])] as [string, string]
    ),
  ];
  await AsyncStorage.multiSet(writes);

  // Fire-and-forget POST to backend.
  fetch(`${API_BASE}/signals?type=preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: USER_ID,
      preferences: {
        takeoffTime: settings.takeoffTime,
        clearanceTime: settings.clearanceTime,
        healthEnabled: settings.healthEnabled,
        childcareEnabled: settings.childcareEnabled,
        horizonEnabled: settings.horizonEnabled,
        horizonFrequency: settings.horizonFrequency,
        flaggedCategories: buildFlaggedCategories(settings.categoryEnabled),
        categoryEnabled: settings.categoryEnabled,
      },
    }),
  }).catch(() => {});
}

async function loadSettings(): Promise<Settings> {
  const keys = [
    'takeoffTime',
    'clearanceTime',
    'healthEnabled',
    'childcareEnabled',
    'horizonEnabled',
    'horizonFrequency',
    ...CATEGORIES.map((c) => c.storeKey),
  ];
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    const map = Object.fromEntries(pairs);
    const bool = (k: string, fallback: boolean) =>
      map[k] === null || map[k] === undefined ? fallback : map[k] === 'true';
    return {
      takeoffTime: map.takeoffTime || DEFAULTS.takeoffTime,
      clearanceTime: map.clearanceTime || DEFAULTS.clearanceTime,
      healthEnabled: bool('healthEnabled', DEFAULTS.healthEnabled),
      childcareEnabled: bool('childcareEnabled', DEFAULTS.childcareEnabled),
      horizonEnabled: bool('horizonEnabled', DEFAULTS.horizonEnabled),
      horizonFrequency:
        (HORIZON_FREQUENCIES as readonly string[]).includes(map.horizonFrequency || '')
          ? (map.horizonFrequency as HorizonFrequency)
          : DEFAULTS.horizonFrequency,
      categoryEnabled: CATEGORIES.reduce((acc, c) => {
        acc[c.key] = bool(c.storeKey, DEFAULTS.categoryEnabled[c.key]);
        return acc;
      }, {} as Record<CategoryKey, boolean>),
    };
  } catch {
    return DEFAULTS;
  }
}

function SectionHeader({ title, subtext }: { title: string; subtext?: string }) {
  return (
    <View style={styles.sectionHeaderWrap}>
      <Text style={styles.sectionHeader}>{title}</Text>
      {!!subtext && <Text style={styles.sectionSubtext}>{subtext}</Text>}
    </View>
  );
}

function Row({
  label,
  subtext,
  right,
  onPress,
  disabled,
}: {
  label: string;
  subtext?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const Wrap: React.ComponentType<any> = onPress && !disabled ? TouchableOpacity : View;
  return (
    <Wrap style={styles.row} onPress={onPress} activeOpacity={0.6}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {!!subtext && <Text style={styles.rowSubtext}>{subtext}</Text>}
      </View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </Wrap>
  );
}

function ToggleRow({
  label,
  subtext,
  value,
  onChange,
}: {
  label: string;
  subtext?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Row
      label={label}
      subtext={subtext}
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: '#2a2a2a', true: BRASS }}
          thumbColor={OFF_WHITE}
          ios_backgroundColor="#2a2a2a"
        />
      }
    />
  );
}

function ChevronRow({
  label,
  subtext,
  rightText,
  onPress,
}: {
  label: string;
  subtext?: string;
  rightText?: string;
  onPress: () => void;
}) {
  return (
    <Row
      label={label}
      subtext={subtext}
      onPress={onPress}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {!!rightText && <Text style={styles.rightText}>{rightText}</Text>}
          <ChevronRight size={18} color={MUTED} />
        </View>
      }
    />
  );
}

function comingSoon(label: string) {
  Alert.alert(label, 'Coming soon.');
}

async function handleInviteMember() {
  try {
    const r = await fetch(`${API_BASE}/invite/generate?userId=${USER_ID}`);
    if (!r.ok) {
      Alert.alert('Invite a member', "Couldn't generate an invite. Try again later.");
      return;
    }
    const data = await r.json();
    if (!data?.inviteUrl) {
      Alert.alert('Invite a member', "Couldn't generate an invite. Try again later.");
      return;
    }
    await Share.share({
      message: `Join my Conductor household: ${data.inviteUrl}\n\nShare this link — it expires in 7 days.`,
      url: data.inviteUrl,
    });
  } catch {
    Alert.alert('Invite a member', "Couldn't generate an invite. Try again later.");
  }
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [editingTime, setEditingTime] = useState<null | {
    key: 'takeoffTime' | 'clearanceTime';
    label: string;
    draft: string;
  }>(null);
  const [missedCuesCount, setMissedCuesCount] = useState(0);
  const [vaultCount, setVaultCount] = useState(0);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  // Refetch the missed-cues + vault counts whenever Settings gains focus, so
  // the badges reflect state after the user resolves/handles items on those
  // screens and navigates back.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetch(`${API_BASE}/signals?type=missedcues&userId=${USER_ID}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          setMissedCuesCount(Array.isArray(d.signals) ? d.signals.length : 0);
        })
        .catch(() => {});
      // Vault count = items with renewalDate within the next 90 days. The
      // server returns all active items; we filter client-side so the
      // threshold can change without an API tweak.
      fetch(`${API_BASE}/signals?type=vault&userId=${USER_ID}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          const cutoff = Date.now() + 90 * 24 * 60 * 60 * 1000;
          const within = (d.items || []).filter((v: { renewalDate?: string }) => {
            if (!v.renewalDate) return false;
            const ms = Date.parse(v.renewalDate);
            return !isNaN(ms) && ms <= cutoff;
          });
          setVaultCount(within.length);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, []),
  );

  function update(next: Settings) {
    setSettings(next);
    persistAndSync(next).catch(() => {});
  }

  function setHealth(v: boolean) { update({ ...settings, healthEnabled: v }); }
  function setChildcare(v: boolean) { update({ ...settings, childcareEnabled: v }); }
  function setHorizon(v: boolean) { update({ ...settings, horizonEnabled: v }); }
  function setCategory(k: CategoryKey, v: boolean) {
    update({ ...settings, categoryEnabled: { ...settings.categoryEnabled, [k]: v } });
  }
  function cycleFrequency() {
    const i = HORIZON_FREQUENCIES.indexOf(settings.horizonFrequency);
    const next = HORIZON_FREQUENCIES[(i + 1) % HORIZON_FREQUENCIES.length];
    update({ ...settings, horizonFrequency: next });
  }

  function openTimeEditor(key: 'takeoffTime' | 'clearanceTime', label: string) {
    setEditingTime({ key, label, draft: settings[key] });
  }
  function adjustDraft(delta: number) {
    setEditingTime((prev) => (prev ? { ...prev, draft: shiftHour(prev.draft, delta) } : prev));
  }
  function commitTimeEdit() {
    if (!editingTime) return;
    update({ ...settings, [editingTime.key]: editingTime.draft });
    setEditingTime(null);
  }

  if (!loaded) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        <SectionHeader title="Household" />
        <Row label="RangerOaks925" subtext="Your household" />
        <ChevronRow label="Invite a member" onPress={handleInviteMember} />
        <Row
          label="Missed Cues"
          onPress={() => router.push('/(tabs)/missed-cues')}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {missedCuesCount > 0 && (
                <View style={styles.missedBadge}>
                  <Text style={styles.missedBadgeText}>{missedCuesCount}</Text>
                </View>
              )}
              <ChevronRight size={18} color={MUTED} />
            </View>
          }
        />
        <Row
          label="Vault"
          onPress={() => router.push('/vault')}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {vaultCount > 0 && (
                <View style={styles.missedBadge}>
                  <Text style={styles.missedBadgeText}>{vaultCount}</Text>
                </View>
              )}
              <ChevronRight size={18} color={MUTED} />
            </View>
          }
        />
        <Row
          label="Connected accounts"
          right={
            <View style={styles.connectedRow}>
              <Text style={styles.connectedItem}>Gmail ✓</Text>
              <Text style={styles.connectedItem}>Calendar ✓</Text>
            </View>
          }
        />

        <SectionHeader title="Programme" subtext="When the day opens and closes" />
        <ChevronRow
          label="Takeoff"
          rightText={format12Hour(settings.takeoffTime)}
          onPress={() => openTimeEditor('takeoffTime', 'Takeoff')}
        />
        <ChevronRow
          label="Clearance"
          rightText={format12Hour(settings.clearanceTime)}
          onPress={() => openTimeEditor('clearanceTime', 'Clearance')}
        />

        <SectionHeader
          title="Always Included"
          subtext="These appear in every brief when relevant"
        />
        <ToggleRow label="Health context" value={settings.healthEnabled} onChange={setHealth} />
        <ToggleRow label="Childcare" value={settings.childcareEnabled} onChange={setChildcare} />
        <Row
          label="In-person requirements"
          right={<Lock size={16} color={MUTED} />}
        />

        <SectionHeader
          title="High Importance"
          subtext="Flag categories to prioritize in your brief"
        />
        {CATEGORIES.map((c) => (
          <ToggleRow
            key={c.key}
            label={c.label}
            value={settings.categoryEnabled[c.key]}
            onChange={(v) => setCategory(c.key, v)}
          />
        ))}

        <SectionHeader
          title="Horizon Awareness"
          subtext="One surprising signal from the bigger picture"
        />
        <ToggleRow label="Enabled" value={settings.horizonEnabled} onChange={setHorizon} />
        <ChevronRow
          label="Frequency"
          rightText={settings.horizonFrequency}
          onPress={cycleFrequency}
        />
        {settings.horizonEnabled && (
          <ChevronRow label="View The Horizon" onPress={() => router.push('/horizon')} />
        )}

        <SectionHeader title="About" />
        <Row label="Conductor" subtext="Version 1.0.0" />
        <ChevronRow
          label="How Conductor thinks"
          onPress={() => comingSoon('How Conductor thinks')}
        />
        <ChevronRow label="Privacy" onPress={() => comingSoon('Privacy')} />

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={!!editingTime}
        animationType="fade"
        transparent
        onRequestClose={() => setEditingTime(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditingTime(null)}>
          <Pressable style={styles.timeSheet} onPress={() => {}}>
            <Text style={styles.timeSheetTitle}>{editingTime?.label}</Text>
            <View style={styles.timeAdjustRow}>
              <TouchableOpacity
                style={styles.timeBtn}
                onPress={() => adjustDraft(-1)}>
                <Text style={styles.timeBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.timeDisplay}>
                {editingTime ? format12Hour(editingTime.draft) : ''}
              </Text>
              <TouchableOpacity
                style={styles.timeBtn}
                onPress={() => adjustDraft(1)}>
                <Text style={styles.timeBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.doneBtn} onPress={commitTimeEdit}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 20,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 32,
  },
  sectionHeaderWrap: {
    marginTop: 28,
    marginBottom: 4,
  },
  sectionHeader: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  sectionSubtext: {
    color: MUTED,
    fontSize: 12,
    marginTop: 6,
    letterSpacing: 0.2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
    minHeight: 52,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowLabel: {
    color: OFF_WHITE,
    fontSize: 16,
    letterSpacing: 0.2,
  },
  rowSubtext: {
    color: MUTED,
    fontSize: 12,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rightText: {
    color: MUTED,
    fontSize: 14,
    letterSpacing: 0.3,
  },
  connectedRow: {
    flexDirection: 'row',
    gap: 12,
  },
  connectedItem: {
    color: SAGE,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  missedBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: BRASS,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  missedBadgeText: {
    color: BG,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  timeSheet: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  timeSheetTitle: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 24,
  },
  timeAdjustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 24,
  },
  timeBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBtnText: {
    color: OFF_WHITE,
    fontSize: 24,
    fontWeight: '300',
    lineHeight: 28,
  },
  timeDisplay: {
    color: OFF_WHITE,
    fontSize: 24,
    fontWeight: '300',
    letterSpacing: 0.5,
  },
  doneBtn: {
    backgroundColor: OFF_WHITE,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  doneBtnText: {
    color: BG,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
