import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { ChevronRight, Lock } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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

// Shared so the three failure paths in handleInvite (network, non-2xx,
// missing token in response) all surface identical copy. Was duplicated
// inline in three places before.
const INVITE_FAILED_MESSAGE = "Couldn't generate an invite. Try again later.";

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
  workCalendarName: string;  // Empty string = unset
  middayEnabled: boolean;    // Opt-in midday check-in push
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
  workCalendarName: '',
  middayEnabled: false,
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
    ['workCalendarName', settings.workCalendarName],
    ['middayEnabled', String(settings.middayEnabled)],
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
        workCalendarName: settings.workCalendarName.trim(),
        middayEnabled: settings.middayEnabled,
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
    'workCalendarName',
    'middayEnabled',
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
      workCalendarName: map.workCalendarName || DEFAULTS.workCalendarName,
      middayEnabled: bool('middayEnabled', DEFAULTS.middayEnabled),
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
  Alert.alert(label, 'Still coming.');
}

async function handleInviteMember() {
  try {
    const r = await fetch(`${API_BASE}/invite/generate?userId=${USER_ID}`);
    if (!r.ok) {
      Alert.alert('Invite a member', INVITE_FAILED_MESSAGE);
      return;
    }
    const data = await r.json();
    if (!data?.inviteUrl) {
      Alert.alert('Invite a member', INVITE_FAILED_MESSAGE);
      return;
    }
    await Share.share({
      message: `Join my Conductor household: ${data.inviteUrl}\n\nShare this link — it expires in 7 days.`,
      url: data.inviteUrl,
    });
  } catch {
    Alert.alert('Invite a member', INVITE_FAILED_MESSAGE);
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
  // Oura connection state — polled on focus so the row reflects whether
  // the OAuth flow completed in Safari since the last visit.
  const [ouraConnected, setOuraConnected] = useState<boolean | null>(null);
  // API key modal — shows the household's API key with a copy button.
  const [apiKeyModalVisible, setApiKeyModalVisible] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  // Household location — polled on focus so the row reflects whatever
  // detection or manual edit landed since the last visit. Stored shape
  // matches the backend response: city/state/marketRegion plus
  // lat/lon/timezone.
  const [location, setLocation] = useState<{
    city?: string;
    state?: string;
    marketRegion?: string;
    source?: string;
  } | null>(null);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [locationCityDraft, setLocationCityDraft] = useState('');
  const [locationStateDraft, setLocationStateDraft] = useState('');
  const [locationSaving, setLocationSaving] = useState(false);
  // Local draft for the work-calendar TextInput. Commits to settings (and
  // POSTs to backend) only onBlur, never per-keystroke — eliminates a race
  // condition where a partial mid-edit value could be the last POST to
  // land in Redis, and stops the firehose of per-keystroke POSTs.
  const [workCalDraft, setWorkCalDraft] = useState('');
  // "Saved" confirmation flag for the work-calendar input. Animated.Value
  // holds the opacity so the affordance can fade in immediately, hold for
  // 2s, then fade out smoothly.
  const workCalSavedOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setWorkCalDraft(s.workCalendarName);
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
      // Oura connection state — polled on focus so the row reflects
      // an OAuth flow that just completed in Safari.
      fetch(`${API_BASE}/oura/status?userId=${USER_ID}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          setOuraConnected(d.connected === true);
        })
        .catch(() => {});
      // Household location — first hit also runs IP-based auto-detection
      // server-side, so subsequent renders show a real city even if the
      // user has never manually set it.
      fetch(`${API_BASE}/signals?type=location&userId=${USER_ID}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d?.location) return;
          setLocation(d.location);
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
  function setMidday(v: boolean) { update({ ...settings, middayEnabled: v }); }

  function handleConnectOura() {
    Linking.openURL(`${API_BASE}/oura/auth?userId=${USER_ID}`);
  }

  async function handleDisconnectOura() {
    Alert.alert(
      'Disconnect Oura Ring',
      'Conductor will stop reading your daily readiness, sleep, and activity. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/oura/disconnect?userId=${USER_ID}`, { method: 'GET' });
              setOuraConnected(false);
            } catch { /* best-effort */ }
          },
        },
      ]
    );
  }

  async function handleShowApiKey() {
    setApiKeyModalVisible(true);
    setApiKeyCopied(false);
    if (apiKey) return;
    setApiKeyLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ingest/key?userId=${USER_ID}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data?.apiKey === 'string') setApiKey(data.apiKey);
    } catch {
      // Surface failure as a missing key — the modal will show a retry-
      // by-reopen affordance via the loading text.
    } finally {
      setApiKeyLoading(false);
    }
  }

  function openLocationEditor() {
    setLocationCityDraft(location?.city || '');
    setLocationStateDraft(location?.state || '');
    setLocationModalVisible(true);
  }

  async function saveLocation() {
    const city = locationCityDraft.trim();
    const state = locationStateDraft.trim().toUpperCase();
    if (!city || !state) return;
    setLocationSaving(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, city, state }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.location) setLocation(data.location);
      }
    } catch {
      // best-effort
    } finally {
      setLocationSaving(false);
      setLocationModalVisible(false);
    }
  }

  async function handleCopyApiKey() {
    if (!apiKey) return;
    // Try expo-clipboard via dynamic import; if it's not in the current
    // bundle (not yet baked into the native build), fall back silently —
    // the key is rendered in a `selectable` Text so the user can still
    // long-press to copy manually.
    try {
      const mod: { setStringAsync?: (s: string) => Promise<void> } | null =
        await (Function('return import("expo-clipboard")')() as Promise<unknown>)
          .then((m) => m as { setStringAsync?: (s: string) => Promise<void> })
          .catch(() => null);
      if (mod && typeof mod.setStringAsync === 'function') {
        await mod.setStringAsync(apiKey);
      }
    } catch {
      // ignored — fall through to the "Copied" flash anyway so the
      // user gets feedback even when programmatic copy fails.
    }
    setApiKeyCopied(true);
    setTimeout(() => setApiKeyCopied(false), 2000);
  }
  function commitWorkCalendarName() {
    const trimmed = workCalDraft.trim();
    if (trimmed === (settings.workCalendarName || '').trim()) return;
    console.log('[settings] workCalendarName commit:', JSON.stringify(trimmed));
    setWorkCalDraft(trimmed);
    update({ ...settings, workCalendarName: trimmed });
    // Flash the "Saved" confirmation. Snap to full opacity, hold ~2s, then
    // fade out over 400ms so the disappearance reads as soft rather than
    // abrupt. Native driver since we're only touching opacity.
    workCalSavedOpacity.stopAnimation();
    workCalSavedOpacity.setValue(1);
    Animated.timing(workCalSavedOpacity, {
      toValue: 0,
      duration: 400,
      delay: 2000,
      useNativeDriver: true,
    }).start();
  }
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
        <ChevronRow label="Crew" onPress={() => router.push('/crew')} />
        <Row
          label="Location"
          subtext={
            location?.city
              ? `${location.city}, ${location.state || ''}${location.source === 'manual' ? '' : ' · auto-detected'}`
              : 'Detecting…'
          }
          onPress={openLocationEditor}
          right={<ChevronRight size={18} color={MUTED} />}
        />
        <ChevronRow
          label="The Programme"
          // Cast: expo-router's typed-routes generator hasn't regenerated
          // since app/programme.tsx was added. The push resolves correctly
          // at runtime via the file-system route; the typed lookup will
          // pick it up on the next `expo start`/build.
          onPress={() => router.push('/programme' as never)}
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
        <ToggleRow
          label="Midday Check-in"
          subtext="A brief update at 1pm"
          value={settings.middayEnabled}
          onChange={setMidday}
        />

        <SectionHeader
          title="Always On"
          subtext="These appear in every brief when relevant"
        />
        <ToggleRow label="Health context" value={settings.healthEnabled} onChange={setHealth} />
        <ToggleRow label="Childcare" value={settings.childcareEnabled} onChange={setChildcare} />
        <Row
          label="In-person requirements"
          right={<Lock size={16} color={MUTED} />}
        />

        <SectionHeader
          title="What Matters Most"
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
          title="On the Horizon"
          subtext="One surprising signal from the bigger picture"
        />
        <ToggleRow label="Watching" value={settings.horizonEnabled} onChange={setHorizon} />
        <ChevronRow
          label="Frequency"
          rightText={settings.horizonFrequency}
          onPress={cycleFrequency}
        />
        {settings.horizonEnabled && (
          <ChevronRow label="View The Horizon" onPress={() => router.push('/horizon')} />
        )}

        <SectionHeader
          title="Awareness"
          subtext="What Conductor has learned"
        />
        <ChevronRow label="Compass" onPress={() => router.push('/compass')} />
        <ChevronRow
          label="Signal Filters"
          onPress={() => router.push('/signal-filters' as never)}
        />
        {ouraConnected === true ? (
          <Row
            label="Oura Ring"
            subtext="Connected"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={styles.ouraConnectedText}>✓</Text>
                <TouchableOpacity onPress={handleDisconnectOura} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.ouraDisconnectLink}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            }
          />
        ) : (
          <TouchableOpacity onPress={handleConnectOura} activeOpacity={0.6}>
            <View style={styles.ouraConnectRow}>
              <Text style={styles.ouraConnectLabel}>Oura Ring</Text>
              <Text style={styles.ouraConnectAction}>Connect Oura Ring →</Text>
            </View>
          </TouchableOpacity>
        )}
        <View style={styles.workCalRow}>
          <View style={styles.workCalHeaderRow}>
            <Text style={styles.workCalLabel}>Work Calendar</Text>
            <Animated.Text
              style={[styles.workCalSaved, { opacity: workCalSavedOpacity }]}
              pointerEvents="none">
              Saved
            </Animated.Text>
          </View>
          <TextInput
            value={workCalDraft}
            onChangeText={setWorkCalDraft}
            onBlur={commitWorkCalendarName}
            onSubmitEditing={commitWorkCalendarName}
            returnKeyType="done"
            placeholder="Calendar name (e.g. Work, Office)"
            placeholderTextColor={MUTED}
            autoCapitalize="words"
            autoCorrect={false}
            style={styles.workCalInput}
          />
          <Text style={styles.workCalHelper}>
            Helps Conductor detect scheduling conflicts
          </Text>
        </View>

        <SectionHeader title="Conductor" />
        <Row label="Conductor" subtext="Version 1.0.0" />
        <Row
          label="API Access"
          subtext="Send signals to Conductor from any service"
          onPress={handleShowApiKey}
          right={<ChevronRight size={18} color={MUTED} />}
        />
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
              <Text style={styles.doneBtnText}>Over</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={apiKeyModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setApiKeyModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setApiKeyModalVisible(false)}>
          <Pressable style={styles.apiKeySheet} onPress={() => {}}>
            <Text style={styles.apiKeySheetTitle}>API Access</Text>
            <Text style={styles.apiKeySubtext}>
              Send signals to Conductor from any service. POST to
              /api/ingest with this key in the X-Conductor-Key header.
            </Text>
            {apiKeyLoading || !apiKey ? (
              <Text style={styles.apiKeyLoading}>
                {apiKeyLoading ? 'Loading…' : 'Failed to load. Close and reopen to retry.'}
              </Text>
            ) : (
              <>
                <Text style={styles.apiKeyValue} selectable>{apiKey}</Text>
                <TouchableOpacity onPress={handleCopyApiKey} style={styles.apiKeyCopyBtn}>
                  <Text style={styles.apiKeyCopyBtnText}>
                    {apiKeyCopied ? 'Copied ✓' : 'Copy'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              onPress={() => setApiKeyModalVisible(false)}
              style={styles.apiKeyDoneBtn}>
              <Text style={styles.apiKeyDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={locationModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setLocationModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setLocationModalVisible(false)}>
          <Pressable style={styles.apiKeySheet} onPress={() => {}}>
            <Text style={styles.apiKeySheetTitle}>Location</Text>
            <Text style={styles.apiKeySubtext}>
              Conductor uses your location for weather, market rates, and
              local service providers.
            </Text>
            <View style={{ gap: 8 }}>
              <TextInput
                value={locationCityDraft}
                onChangeText={setLocationCityDraft}
                placeholder="City"
                placeholderTextColor={MUTED}
                style={styles.locationInput}
                autoCapitalize="words"
              />
              <TextInput
                value={locationStateDraft}
                onChangeText={setLocationStateDraft}
                placeholder="State (e.g. FL, NY)"
                placeholderTextColor={MUTED}
                style={styles.locationInput}
                autoCapitalize="characters"
                maxLength={2}
              />
            </View>
            <TouchableOpacity
              onPress={saveLocation}
              disabled={locationSaving || locationCityDraft.trim().length === 0 || locationStateDraft.trim().length === 0}
              style={[
                styles.apiKeyCopyBtn,
                (locationSaving || locationCityDraft.trim().length === 0 || locationStateDraft.trim().length === 0) && { opacity: 0.4 },
              ]}>
              <Text style={styles.apiKeyCopyBtnText}>
                {locationSaving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setLocationModalVisible(false)}
              style={styles.apiKeyDoneBtn}>
              <Text style={styles.apiKeyDoneBtnText}>Cancel</Text>
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
  workCalRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
  },
  workCalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  workCalLabel: {
    color: OFF_WHITE,
    fontSize: 15,
  },
  workCalSaved: {
    color: SAGE,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  workCalInput: {
    color: OFF_WHITE,
    fontSize: 14,
    paddingVertical: 6,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
  },
  workCalHelper: {
    color: MUTED,
    fontSize: 12,
    marginTop: 8,
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
  // Oura Ring row — two states (connected vs not). Connected uses the
  // shared Row component; the Connect state is a custom row so the
  // brass call-to-action text aligns right with the label.
  ouraConnectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
  },
  ouraConnectLabel: {
    color: OFF_WHITE,
    fontSize: 15,
  },
  ouraConnectAction: {
    color: BRASS,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  ouraConnectedText: {
    color: SAGE,
    fontSize: 16,
  },
  ouraDisconnectLink: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // API key modal — same backdrop pattern as the time-edit sheet, with
  // a monospace-leaning display block for the key itself plus copy +
  // done buttons.
  apiKeySheet: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    gap: 14,
  },
  apiKeySheetTitle: {
    color: OFF_WHITE,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  apiKeySubtext: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },
  apiKeyValue: {
    color: OFF_WHITE,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
    borderRadius: 8,
    marginVertical: 4,
  },
  apiKeyLoading: {
    color: MUTED,
    fontSize: 13,
    fontStyle: 'italic',
    marginVertical: 12,
  },
  apiKeyCopyBtn: {
    backgroundColor: BRASS,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  apiKeyCopyBtnText: {
    color: BG,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  apiKeyDoneBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  apiKeyDoneBtnText: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  locationInput: {
    color: OFF_WHITE,
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
  },
});
