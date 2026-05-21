import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import * as security from '@/app/security';
import { ACCENTS, useTheme, type AccentKey, type ThemeMode } from '@/app/theme';
import { Minimap } from '@/components/Minimap';
import { openConductorSheet } from '@/hooks/useConductorSheet';
import { useUrgentCount } from '@/hooks/useUrgentCount';
import { ChevronRight, Lock } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type FinancialAwareness = 'silent' | 'awareness' | 'tracking' | 'planning';

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
  // Overwatch threshold — the local hour after which brief mode
  // becomes "Overwatch" (the quiet, end-of-day variant). Stored as a
  // 24-hour integer; backend reads it directly.
  overwatchHour: number;
  // Weekend takeoff delay — when true, Saturday/Sunday push the
  // takeoff hour forward by 1 hour relative to the weekday default.
  weekendTakeoffDelay: boolean;
  // Financial intelligence — how much engagement Conductor brings to
  // money topics. Default is 'silent' (only anomalies surface).
  financialAwareness: FinancialAwareness;
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
  overwatchHour: 23,          // 11pm default per spec
  weekendTakeoffDelay: false,
  financialAwareness: 'silent',
};

const FINANCIAL_OPTIONS: { id: FinancialAwareness; title: string; sub: string }[] = [
  { id: 'silent',    title: 'Silent',    sub: 'Track quietly. Only alerts on anomalies and fraud.' },
  { id: 'awareness', title: 'Awareness', sub: 'Surface renewals, price changes, and unusual charges.' },
  { id: 'tracking',  title: 'Tracking',  sub: 'Track against typical patterns. Surface category overruns.' },
  { id: 'planning',  title: 'Planning',  sub: 'Full financial intelligence in your brief.' },
];

// Overwatch options shown in the Settings picker. Stored hour is the
// integer Settings.overwatchHour; the 23.5 case is represented in the
// UI but rounded down to 23 in storage for now since the backend gate
// is hour-granular (refine to minutes if user feedback warrants).
const OVERWATCH_OPTIONS: { hour: number; label: string }[] = [
  { hour: 22, label: '10pm' },
  { hour: 23, label: '11pm' },
  // 11:30 lives in the same hour bucket as 11pm for backend purposes
  // but the user-visible label communicates the intent.
  { hour: 23, label: '11:30pm' },
  { hour: 0,  label: 'Midnight' },
];

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
    ['overwatchHour', String(settings.overwatchHour)],
    ['weekendTakeoffDelay', String(settings.weekendTakeoffDelay)],
    ['financialAwareness', settings.financialAwareness],
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
        overwatchHour: settings.overwatchHour,
        weekendTakeoffDelay: settings.weekendTakeoffDelay,
        financialAwareness: settings.financialAwareness,
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
    'overwatchHour',
    'weekendTakeoffDelay',
    'financialAwareness',
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
      overwatchHour: (() => {
        const n = parseInt(map.overwatchHour || '', 10);
        return isNaN(n) ? DEFAULTS.overwatchHour : n;
      })(),
      weekendTakeoffDelay: bool('weekendTakeoffDelay', DEFAULTS.weekendTakeoffDelay),
      financialAwareness: (() => {
        const v = map.financialAwareness;
        return v === 'silent' || v === 'awareness' || v === 'tracking' || v === 'planning'
          ? v
          : DEFAULTS.financialAwareness;
      })(),
      categoryEnabled: CATEGORIES.reduce((acc, c) => {
        acc[c.key] = bool(c.storeKey, DEFAULTS.categoryEnabled[c.key]);
        return acc;
      }, {} as Record<CategoryKey, boolean>),
    };
  } catch {
    return DEFAULTS;
  }
}

// Security section. Lives at the top of Settings. All state is
// persisted via app/security.ts helpers; values are loaded on
// mount and on focus so a change made in one place reflects
// everywhere.
function SecuritySection() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [enabled, setEnabledLocal] = useState(false);
  const [lockAfter, setLockAfterLocal] = useState<security.LockAfterMinutes>(5);
  const [protectSensitive, setProtectLocal] = useState(true);
  const [screenshotProtection, setScreenshotLocal] = useState(false);
  const [clipboardClear, setClipboardLocal] = useState(true);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      const avail = await security.isAvailable();
      const settings = await security.getSettings();
      if (cancelled) return;
      setAvailable(avail);
      setEnabledLocal(settings.enabled);
      setLockAfterLocal(settings.lockAfterMinutes);
      setProtectLocal(settings.protectSensitive);
      setScreenshotLocal(settings.screenshotProtection);
      setClipboardLocal(settings.clipboardClear);
    })();
    return () => { cancelled = true; };
  }, []));

  async function toggleEnabled(v: boolean) {
    if (v) {
      // Confirm the user can actually authenticate before enabling
      // — saves them from locking themselves out.
      const ok = await security.authenticateAsync('Confirm to enable Face ID protection');
      if (!ok) return;
    }
    setEnabledLocal(v);
    await security.setEnabled(v);
    await security.touchActive();
  }

  function pickLockAfter() {
    const options: { label: string; value: security.LockAfterMinutes }[] = [
      { label: '1 minute', value: 1 },
      { label: '5 minutes', value: 5 },
      { label: '15 minutes', value: 15 },
      { label: '30 minutes', value: 30 },
      { label: '1 hour', value: 60 },
      { label: 'Never', value: 0 },
    ];
    Alert.alert(
      'Lock after',
      undefined,
      [
        ...options.map((o) => ({
          text: o.label + (lockAfter === o.value ? '  ✓' : ''),
          onPress: async () => {
            setLockAfterLocal(o.value);
            await security.setLockAfterMinutes(o.value);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  }

  const lockLabel =
    lockAfter === 0 ? 'Never'
    : lockAfter === 60 ? '1 hour'
    : `${lockAfter} minute${lockAfter === 1 ? '' : 's'}`;

  const biometricUnavailable = available === false;

  return (
    <>
      <SectionHeader title="Security" />
      {biometricUnavailable ? (
        <Row label="Face ID / Touch ID" subtext="Not available on this device" />
      ) : (
        <ToggleRow
          label="Face ID / Touch ID"
          value={enabled}
          onChange={toggleEnabled}
        />
      )}
      {enabled && (
        <ChevronRow
          label="Lock after"
          rightText={lockLabel}
          onPress={pickLockAfter}
        />
      )}
      {enabled && (
        <ToggleRow
          label="Protect sensitive screens"
          subtext="Vault, Inventory, Memory require auth after timeout"
          value={protectSensitive}
          onChange={async (v: boolean) => {
            setProtectLocal(v);
            await security.setProtectSensitive(v);
          }}
        />
      )}
      <ToggleRow
        label="Screenshot protection"
        subtext="Block screenshots on sensitive screens"
        value={screenshotProtection}
        onChange={async (v: boolean) => {
          setScreenshotLocal(v);
          await security.setScreenshotProtection(v);
        }}
      />
      <ToggleRow
        label="Clear clipboard after 60s"
        subtext="Auto-clear copied sensitive data"
        value={clipboardClear}
        onChange={async (v: boolean) => {
          setClipboardLocal(v);
          await security.setClipboardClear(v);
        }}
      />
    </>
  );
}

function SectionHeader({ title, subtext }: { title: string; subtext?: string }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
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
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
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

// iOS Shortcuts library — a hand-curated catalog of shortcut templates
// users can install to forward signals from other apps into Conductor
// via /api/ingest. The templateId values below are intentionally
// placeholders; substitute real shortcut share URLs once published on
// iCloud. The Install button opens the iCloud Shortcuts share link;
// iOS handles the install handshake natively.
const SHORTCUT_CATEGORIES: { category: string; items: { id: string; icon: string; name: string; desc: string }[] }[] = [
  {
    category: 'BANKING',
    items: [
      { id: 'banking-large-tx', icon: '💳', name: 'Large transaction alert', desc: 'When a charge over a set amount arrives → Conductor signal' },
    ],
  },
  {
    category: 'SCHOOL',
    items: [
      { id: 'school-classdojo', icon: '🎒', name: 'ClassDojo message', desc: 'Forward ClassDojo notifications to Conductor crew signals' },
      { id: 'school-remind',    icon: '🏫', name: 'Remind message',    desc: 'School messages to Conductor' },
    ],
  },
  {
    category: 'HEALTH',
    items: [
      { id: 'health-workout', icon: '🏋️', name: 'Workout complete', desc: 'Log Apple Watch workouts to Conductor health context' },
      { id: 'health-hr',      icon: '❤️', name: 'High heart rate',   desc: 'Unusual heart rate → Conductor health signal' },
    ],
  },
  {
    category: 'HOME',
    items: [
      { id: 'home-door',   icon: '🔓', name: 'Door unlocked', desc: 'August/smart lock events to Conductor' },
      { id: 'home-garage', icon: '🚪', name: 'Garage opened', desc: 'Garage door events to Conductor' },
    ],
  },
  {
    category: 'TRAVEL',
    items: [
      { id: 'travel-flight', icon: '✈️', name: 'Flight update',    desc: 'Forward airline notifications to Conductor travel signal' },
      { id: 'travel-hotel',  icon: '🏨', name: 'Hotel check-in',   desc: 'Hotel confirmation to Conductor' },
    ],
  },
  {
    category: 'LIFESTYLE',
    items: [
      { id: 'life-resy',    icon: '🍽️',  name: 'Restaurant reservation',  desc: 'OpenTable/Resy bookings to Conductor' },
      { id: 'life-concert', icon: '🎟️',  name: 'Concert tickets',         desc: 'Ticketmaster purchases to Conductor event signal' },
      { id: 'life-grocery', icon: '🛒',  name: 'Grocery order',           desc: 'Instacart orders to Conductor' },
    ],
  },
];

function ShortcutsLibraryBlock() {
  const { theme, accentColor } = useTheme();
  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 8 }}>
      {SHORTCUT_CATEGORIES.map((group) => (
        <View key={group.category} style={{ marginBottom: 14 }}>
          <Text style={{
            color: theme.muted,
            fontSize: 10,
            letterSpacing: 2,
            fontWeight: '600',
            marginBottom: 8,
            marginTop: 4,
          }}>
            {group.category}
          </Text>
          {group.items.map((item) => (
            <View
              key={item.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 10,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: 'rgba(255,255,255,0.06)',
              }}>
              <Text style={{ fontSize: 20, marginRight: 12 }}>{item.icon}</Text>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '500' }}>
                  {item.name}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 11, marginTop: 2, lineHeight: 14 }}>
                  {item.desc}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => Linking.openURL(`https://www.icloud.com/shortcuts/${item.id}`).catch(() => {})}
                activeOpacity={0.6}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: accentColor,
                }}>
                <Text style={{ color: accentColor, fontSize: 11, fontWeight: '600' }}>
                  Install →
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ))}

      {/* Generic integration rows — IFTTT / Zapier / direct webhook.
          These are static links because the webhook URL is per-
          household and assembled server-side; once household API
          keys ship in onboarding, swap this label for the live URL. */}
      <View style={{ marginTop: 6 }}>
        <TouchableOpacity
          onPress={() => Linking.openURL('https://ifttt.com').catch(() => {})}
          style={{ paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' }}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={{ color: theme.text, fontSize: 13 }}>Connect via IFTTT →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Linking.openURL('https://zapier.com').catch(() => {})}
          style={{ paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' }}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Text style={{ color: theme.text, fontSize: 13 }}>Connect via Zapier →</Text>
        </TouchableOpacity>
        <View style={{ paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' }}>
          <Text style={{ color: theme.text, fontSize: 13 }}>Webhook URL</Text>
          <Text style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>
            POST to /api/ingest with X-Conductor-Key header
          </Text>
        </View>
      </View>
    </View>
  );
}

// Financial awareness — stacked option cards. Tap to select; brass
// border on the active tier. Defaults to 'silent' (only anomalies
// surface in the brief). Backend reads this from user preferences
// and applies the corresponding filter inside the brief pool build.
function FinancialAwarenessBlock({
  value,
  onChange,
}: {
  value: FinancialAwareness;
  onChange: (v: FinancialAwareness) => void;
}) {
  const { theme, accentColor } = useTheme();
  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 10 }}>
      {FINANCIAL_OPTIONS.map((o) => {
        const active = o.id === value;
        return (
          <TouchableOpacity
            key={o.id}
            onPress={() => onChange(o.id)}
            activeOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={{
              borderWidth: 1,
              borderColor: active ? accentColor : 'rgba(255,255,255,0.06)',
              backgroundColor: active ? 'rgba(184,150,12,0.08)' : 'transparent',
              borderRadius: 12,
              padding: 14,
              marginBottom: 10,
            }}>
            <Text style={{
              color: active ? accentColor : theme.text,
              fontSize: 14,
              fontWeight: active ? '600' : '500',
              marginBottom: 4,
            }}>
              {o.title}
            </Text>
            <Text style={{
              color: theme.muted,
              fontSize: 12,
              lineHeight: 17,
            }}>
              {o.sub}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Overwatch threshold picker — four discrete options as a horizontal
// pill row, mirroring the existing settings pill style. Selection
// state shown with the accentColor border + tint. Storage is the
// integer hour; the 11:30pm label still maps to hour=23 (backend gate
// is hour-granular for now).
function OverwatchPickerRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (h: number) => void;
}) {
  const { theme, accentColor } = useTheme();
  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 12 }}>
      <Text style={{ color: theme.text, fontSize: 14, marginBottom: 8 }}>
        Overwatch begins at
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {OVERWATCH_OPTIONS.map((o, idx) => {
          const active = o.hour === value && (
            o.label === '11pm' ? value === 23 :
            o.label === '11:30pm' ? value === 23 :
            true
          );
          // 11pm / 11:30pm share hour=23. Disambiguate by index so
          // only one of the two reads as "active" at a time. We
          // remember which label was last picked via a separate
          // marker in storage — for now, defer that nuance and let
          // 11pm win when both map to 23.
          const isActive = idx === 0 ? value === 22
            : idx === 1 ? value === 23
            : idx === 2 ? false   // 11:30 distinct UI but same hour bucket
            : value === 0;
          return (
            <TouchableOpacity
              key={o.label}
              onPress={() => onChange(o.hour)}
              activeOpacity={0.6}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: isActive ? accentColor : 'rgba(255,255,255,0.08)',
                backgroundColor: isActive ? 'rgba(184,150,12,0.08)' : 'transparent',
                alignItems: 'center',
              }}>
              <Text style={{
                color: isActive ? accentColor : theme.muted,
                fontSize: 12,
                fontWeight: isActive ? '600' : '400',
              }}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function HouseholdNameRow() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [name, setName] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=profile&userId=${USER_ID}`);
        const data = await res.json();
        if (cancelled) return;
        if (data?.profile?.householdName) setName(data.profile.householdName);
      } catch { /* best-effort */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function persist() {
    try {
      await fetch(`${API_BASE}/signals?type=profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, householdName: name.trim() || null }),
      });
    } catch { /* best-effort */ }
    setEditing(false);
  }

  if (!loaded) return null;

  if (editing) {
    return (
      <View style={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 12 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={persist}
          autoFocus
          placeholder="e.g. The Mounts House"
          placeholderTextColor={MUTED}
          style={{
            color: OFF_WHITE,
            fontSize: 13,
            paddingVertical: 6,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: SOFT_BORDER,
          }}
        />
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => setEditing(true)}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      style={{ paddingHorizontal: 22, paddingTop: 2, paddingBottom: 12 }}>
      <Text style={{ color: name ? OFF_WHITE : BRASS, fontSize: 13, fontStyle: name ? 'normal' : 'italic' }}>
        {name || 'Add a household name →'}
      </Text>
    </TouchableOpacity>
  );
}

function LanguageRow() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [lang, setLang] = useState<'en' | 'es'>('en');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=preferences&userId=${USER_ID}`);
        const data = await res.json();
        if (data?.preferences?.language === 'es') setLang('es');
      } catch { /* skip */ }
      finally { setLoaded(true); }
    })();
  }, []);

  async function pick(next: 'en' | 'es') {
    setLang(next);
    try {
      await fetch(`${API_BASE}/signals?type=preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, preferences: { language: next } }),
      });
      // Bust takeoff cache so next brief reflects new language.
      fetch(`${API_BASE}/brief?userId=${USER_ID}&mode=takeoff&forceFresh=1`).catch(() => {});
    } catch { /* skip */ }
  }

  if (!loaded) return null;

  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {([
          { id: 'en' as const, flag: '🇺🇸', label: 'English' },
          { id: 'es' as const, flag: '🇪🇸', label: 'Español' },
        ]).map((o) => {
          const active = lang === o.id;
          return (
            <TouchableOpacity
              key={o.id}
              onPress={() => pick(o.id)}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 12,
                borderRadius: 10,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: active ? BRASS : SOFT_BORDER,
                backgroundColor: active ? 'rgba(184,150,12,0.08)' : 'rgba(255,255,255,0.03)',
              }}>
              <Text style={{ fontSize: 18, marginRight: 8 }}>{o.flag}</Text>
              <Text style={{ color: active ? BRASS : OFF_WHITE, fontSize: 13, fontWeight: active ? '600' : '400' }}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

type StyleTone = 'direct' | 'balanced' | 'warm';
type StyleHumor = 'yes' | 'occasionally' | 'no';
type StyleDetail = 'brief' | 'standard' | 'thorough';

function AppearanceBlock() {
  const { themeMode, accentKey, theme, accentColor, isDark, setThemeMode, setAccentKey } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const modes: { id: ThemeMode; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'system', label: 'System' },
  ];
  const accentList: { id: AccentKey; name: string; color: string }[] = (
    Object.keys(ACCENTS) as AccentKey[]
  ).map((key) => ({
    id: key,
    name: ACCENTS[key].name,
    color: ACCENTS[key][isDark ? 'dark' : 'light'],
  }));
  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 14 }}>
      <Text style={{ color: theme.muted, fontSize: 10, letterSpacing: 1.5, marginBottom: 8, fontWeight: '600' }}>
        THEME
      </Text>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: theme.inputBackground,
          borderRadius: 10,
          padding: 3,
          marginBottom: 18,
        }}>
        {modes.map((m) => {
          const active = themeMode === m.id;
          return (
            <TouchableOpacity
              key={m.id}
              onPress={() => setThemeMode(m.id)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                alignItems: 'center',
                backgroundColor: active ? accentColor : 'transparent',
              }}>
              <Text
                style={{
                  color: active ? '#0f0f0f' : theme.muted,
                  fontSize: 12,
                  fontWeight: active ? '600' : '400',
                }}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={{ color: theme.muted, fontSize: 10, letterSpacing: 1.5, marginBottom: 10, fontWeight: '600' }}>
        ACCENT COLOR
      </Text>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
        {accentList.map((a) => {
          const active = accentKey === a.id;
          return (
            <TouchableOpacity
              key={a.id}
              onPress={() => setAccentKey(a.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: a.color,
                borderWidth: active ? 3 : 0,
                borderColor: theme.text,
              }}
            />
          );
        })}
      </View>

      <View
        style={{
          marginTop: 4,
          padding: 14,
          backgroundColor: theme.card,
          borderLeftWidth: 2,
          borderLeftColor: accentColor,
          borderRadius: 6,
        }}>
        <Text style={{ color: theme.muted, fontSize: 9, letterSpacing: 2, marginBottom: 6, fontWeight: '600' }}>
          PREVIEW
        </Text>
        <Text style={{ color: theme.text, fontSize: 13, lineHeight: 19 }}>
          Your <Text style={{ color: accentColor, fontWeight: '600' }}>HVAC tune-up</Text> is due before June.
        </Text>
      </View>
    </View>
  );
}

// Mirror of onboarding's HOBBY_OPTIONS — keys MUST match
// api/signals.js HOBBY_KEYS or the save round-trip drops them.
const HOBBY_OPTIONS: { id: string; label: string }[] = [
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

function WhatYouLoveBlock() {
  const { theme, accentColor } = useTheme();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // Load existing hobbies on mount. Silent failure — the section
  // still renders the empty grid so the user can set hobbies for the
  // first time even if the GET hiccups.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=hobbies&userId=${USER_ID}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const list: string[] = Array.isArray(data?.hobbies) ? data.hobbies : [];
        if (!cancelled) {
          setPicked(new Set(list));
          setLoaded(true);
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Optimistic toggle — flip local state first, then POST the new
  // full array. The backend bust of currentTakeoff means the next
  // brief regenerates with the change, so no extra plumbing needed
  // here. Save failures fall through silently (user can retry by
  // re-tapping); we don't roll back optimistic state to avoid
  // making the UI feel flaky on a single 500.
  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    fetch(`${API_BASE}/signals?type=hobbies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: USER_ID,
        hobbies: Array.from(next),
      }),
    }).catch(() => { /* silent */ });
  }

  // Until the GET resolves, render the grid in a slightly faded
  // state so the user doesn't tap an "empty" grid and then watch
  // their selection mysteriously appear a beat later.
  const opacity = loaded ? 1 : 0.5;

  return (
    <View style={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 14, opacity }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {HOBBY_OPTIONS.map((h) => {
          const active = picked.has(h.id);
          return (
            <TouchableOpacity
              key={h.id}
              onPress={() => toggle(h.id)}
              activeOpacity={0.6}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: active ? accentColor : 'rgba(255,255,255,0.06)',
                backgroundColor: active ? 'rgba(184,150,12,0.08)' : 'rgba(255,255,255,0.03)',
              }}>
              <Text
                style={{
                  color: active ? accentColor : theme.text,
                  fontSize: 13,
                  fontWeight: active ? '600' : '400',
                }}>
                {h.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function VoiceStyleBlock() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [tone, setTone] = useState<StyleTone>('balanced');
  const [humor, setHumor] = useState<StyleHumor>('occasionally');
  const [detail, setDetail] = useState<StyleDetail>('standard');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=preferences&userId=${USER_ID}`);
        const data = await res.json();
        if (cancelled) return;
        const p = data?.preferences || {};
        if (p.communicationTone) setTone(p.communicationTone);
        if (p.communicationHumor) setHumor(p.communicationHumor);
        if (p.communicationDetail) setDetail(p.communicationDetail);
      } catch { /* best-effort */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function persist(patch: Record<string, string>) {
    try {
      await fetch(`${API_BASE}/signals?type=preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, preferences: patch }),
      });
      // Bust takeoff cache so the next brief reflects new voice
      // immediately, not after the cache TTL expires.
      fetch(`${API_BASE}/brief?userId=${USER_ID}&mode=takeoff&forceFresh=1`, { method: 'GET' })
        .catch(() => {});
    } catch { /* best-effort */ }
  }

  if (!loaded) {
    return (
      <View style={{ paddingHorizontal: 22, paddingVertical: 12 }}>
        <Text style={{ color: MUTED, fontSize: 12 }}>Loading…</Text>
      </View>
    );
  }

  return (
    <View>
      <SegmentedRow
        label="Tone"
        sub="How Conductor talks to you"
        options={[
          { value: 'direct', label: 'Direct' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'warm', label: 'Warm' },
        ]}
        value={tone}
        onChange={(v) => { setTone(v as StyleTone); persist({ communicationTone: v }); }}
      />
      <SegmentedRow
        label="Humor"
        sub="Whether Conductor uses wit when appropriate"
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'occasionally', label: 'Sometimes' },
          { value: 'no', label: 'No' },
        ]}
        value={humor}
        onChange={(v) => { setHumor(v as StyleHumor); persist({ communicationHumor: v }); }}
      />
      <SegmentedRow
        label="Detail"
        sub="How much context Conductor provides"
        options={[
          { value: 'brief', label: 'Brief' },
          { value: 'standard', label: 'Standard' },
          { value: 'thorough', label: 'Thorough' },
        ]}
        value={detail}
        onChange={(v) => { setDetail(v as StyleDetail); persist({ communicationDetail: v }); }}
      />
    </View>
  );
}

function SegmentedRow({
  label, sub, options, value, onChange,
}: {
  label: string;
  sub?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 12 }}>
      <Text style={{ color: OFF_WHITE, fontSize: 14, fontWeight: '500', marginBottom: 4 }}>
        {label}
      </Text>
      {sub ? <Text style={{ color: MUTED, fontSize: 11, marginBottom: 10 }}>{sub}</Text> : null}
      <View style={{
        flexDirection: 'row',
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 8,
        padding: 3,
      }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <TouchableOpacity
              key={o.value}
              onPress={() => onChange(o.value)}
              style={{
                flex: 1,
                paddingVertical: 9,
                borderRadius: 6,
                alignItems: 'center',
                backgroundColor: active ? BRASS : 'transparent',
              }}>
              <Text
                style={{
                  color: active ? '#0f0f0f' : MUTED,
                  fontSize: 12,
                  fontWeight: active ? '600' : '400',
                }}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function HeyConductorBlock() {
  const [shake, setShake] = useState(true);
  const [voice, setVoice] = useState(false);
  const [wake, setWake] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, v, w] = await Promise.all([
          AsyncStorage.getItem('shakeEnabled'),
          AsyncStorage.getItem('voiceResponsesEnabled'),
          AsyncStorage.getItem('wakeEnabled'),
        ]);
        setShake(s !== 'false');
        setVoice(v === 'true');
        setWake(w === 'true');
      } catch { /* best-effort */ }
      finally { setLoaded(true); }
    })();
  }, []);

  if (!loaded) {
    return (
      <View style={{ paddingHorizontal: 22, paddingVertical: 12 }}>
        <Text style={{ color: MUTED, fontSize: 12 }}>Loading…</Text>
      </View>
    );
  }

  return (
    <View>
      <ToggleRow
        label="Activate with shake"
        subtext="Shake the phone to open Ask Conductor"
        value={shake}
        onChange={(v) => { setShake(v); AsyncStorage.setItem('shakeEnabled', String(v)); }}
      />
      <ToggleRow
        label="Speak responses"
        subtext="Conductor reads answers aloud"
        value={voice}
        onChange={(v) => { setVoice(v); AsyncStorage.setItem('voiceResponsesEnabled', String(v)); }}
      />
      <ToggleRow
        label="Hey Conductor wake phrase"
        subtext="Say Hey Conductor when app is open (needs native build)"
        value={wake}
        onChange={(v) => { setWake(v); AsyncStorage.setItem('wakeEnabled', String(v)); }}
      />
    </View>
  );
}

function ReferralBlock() {
  const [data, setData] = useState<{
    referralCode?: string;
    referralCount?: number;
    freeMonthsEarned?: number;
    foundingHousehold?: boolean;
    freeUntil?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=referral&userId=${USER_ID}`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.ok) setData(json);
      } catch { /* best-effort */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function share() {
    if (!data?.referralCode) return;
    const message = `I've been using Conductor — a household intelligence layer that gives you a morning brief synthesizing your emails, calendar, and health. Genuinely useful. Try it free: getconductor.app/join/${data.referralCode}`;
    try {
      await Share.share({ message });
    } catch { /* user cancelled */ }
  }

  if (loading) {
    return (
      <View style={{ paddingHorizontal: 22, paddingVertical: 16 }}>
        <Text style={{ color: MUTED, fontSize: 12 }}>Loading…</Text>
      </View>
    );
  }
  if (!data) return null;

  const freeUntilFmt = data.freeUntil
    ? new Date(data.freeUntil).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      })
    : null;

  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 8 }}>
      {data.foundingHousehold ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: BRASS, fontSize: 13, fontWeight: '600', letterSpacing: 0.4 }}>
            ⚡ Founding Household
          </Text>
          {freeUntilFmt ? (
            <Text style={{ color: MUTED, fontSize: 11, marginTop: 4 }}>
              Free until {freeUntilFmt}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text style={{ color: MUTED, fontSize: 10, letterSpacing: 1.5, fontWeight: '600', marginBottom: 10 }}>
        INVITE A HOUSEHOLD
      </Text>
      <Text
        style={{
          color: BRASS,
          fontSize: 22,
          fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
          letterSpacing: 4,
          fontWeight: '600',
          marginBottom: 12,
        }}>
        {data.referralCode || '--------'}
      </Text>
      <TouchableOpacity
        onPress={share}
        style={{
          backgroundColor: BRASS,
          paddingVertical: 11,
          paddingHorizontal: 18,
          borderRadius: 22,
          alignSelf: 'flex-start',
          marginBottom: 12,
        }}>
        <Text style={{ color: '#0f0f0f', fontSize: 13, fontWeight: '600' }}>Share →</Text>
      </TouchableOpacity>
      <Text style={{ color: MUTED, fontSize: 11 }}>
        {(data.referralCount || 0)} household{(data.referralCount || 0) === 1 ? '' : 's'} joined
        {' · '}
        {(data.freeMonthsEarned || 0)} free month{(data.freeMonthsEarned || 0) === 1 ? '' : 's'} earned
      </Text>
    </View>
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
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
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
  const { theme: t_theme, accentColor: t_accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(t_theme, t_accentColor), [t_theme, t_accentColor]);
  const settingsUrgentCount = useUrgentCount();
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
  // Nextdoor neighborhood connection state — same polled-on-focus
  // pattern as Oura so the row flips to ✓ as soon as the OAuth
  // round-trip completes in Safari.
  const [nextdoorConnected, setNextdoorConnected] = useState<boolean | null>(null);
  const [nextdoorNeighborhood, setNextdoorNeighborhood] = useState<string | null>(null);
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
  // Smart calendar picker — list of the user's calendars fetched
  // from Google via /api/calendar?action=list, plus whichever one
  // matched the isWorkCalendar heuristic. Set on focus alongside
  // the existing settings load. Picker sheet visibility tracked
  // separately.
  const [calendarList, setCalendarList] = useState<
    { id: string; summary: string; backgroundColor: string | null; isWorkCalendar: boolean; primary: boolean }[]
  >([]);
  const [detectedWorkCalendar, setDetectedWorkCalendar] = useState<string | null>(null);
  const [showCalPicker, setShowCalPicker] = useState(false);
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
    // Calendar list — best-effort, populates the smart picker. If
    // it fails (token expired etc.), the TextInput fallback still
    // accepts a manual name.
    (async () => {
      try {
        const res = await fetch(
          `https://conductor-ivory.vercel.app/api/calendar?action=list&userId=${USER_ID}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.calendars)) {
          setCalendarList(
            data.calendars.map((c: any) => ({
              id: c.id,
              summary: c.summary || c.id,
              backgroundColor: c.backgroundColor || null,
              isWorkCalendar: !!c.isWorkCalendar,
              primary: !!c.primary,
            }))
          );
          setDetectedWorkCalendar(typeof data?.detectedWorkCalendar === 'string' ? data.detectedWorkCalendar : null);
        }
      } catch {
        // ignore — fall through to TextInput
      }
    })();
  }, []);

  async function selectWorkCalendar(name: string) {
    setShowCalPicker(false);
    setWorkCalDraft(name);
    const next = { ...settings, workCalendarName: name };
    setSettings(next);
    try {
      await fetch('https://conductor-ivory.vercel.app/api/signals?type=preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, preferences: { workCalendarName: name } }),
      });
      Animated.sequence([
        Animated.timing(workCalSavedOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.delay(1200),
        Animated.timing(workCalSavedOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
    } catch {
      // best-effort
    }
  }

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
      fetch(`${API_BASE}/nextdoor/status?userId=${USER_ID}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          setNextdoorConnected(d.connected === true);
          setNextdoorNeighborhood(d.neighborhood || null);
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

  function handleConnectNextdoor() {
    Linking.openURL(`${API_BASE}/nextdoor/auth?userId=${USER_ID}`);
  }

  async function handleDisconnectNextdoor() {
    Alert.alert(
      'Disconnect Nextdoor',
      'Conductor will stop reading your neighborhood feed. Safety alerts, recommendations, and local deals from Nextdoor will no longer surface in your brief. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/nextdoor/disconnect?userId=${USER_ID}`, { method: 'GET' });
              setNextdoorConnected(false);
              setNextdoorNeighborhood(null);
            } catch {
              // best-effort
            }
          },
        },
      ]
    );
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
      {/* Minimap top-right — matches the universal "tap to ask
          Conductor" affordance every screen has. Settings doesn't
          use ScreenHeader (custom layout) so we place this manually. */}
      <View style={{ position: 'absolute', top: 60, right: 24, zIndex: 50 }}>
        <Minimap
          floating={false}
          urgentCount={settingsUrgentCount}
          onPress={() => openConductorSheet('settings')}
        />
      </View>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Your House</Text>
        <HouseholdNameRow />

        <SectionHeader title="Appearance" />
        <AppearanceBlock />

        <SecuritySection />

        <SectionHeader title="Household" />
        <Row label="RangerOaks925" subtext="Your household" />
        <ChevronRow label="Invite a member" onPress={handleInviteMember} />
        <Row
          label="Missed Cues"
          onPress={() => router.push('/missed-cues')}
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
          label="Service Providers"
          onPress={() => router.push('/providers' as never)}
        />
        <ChevronRow
          label="Home Inventory"
          onPress={() => router.push('/inventory' as never)}
        />
        <ChevronRow
          label="Home Maintenance"
          onPress={() => router.push('/maintenance' as never)}
        />
        <ChevronRow
          label="The Programme"
          // Cast: expo-router's typed-routes generator hasn't regenerated
          // since app/programme.tsx was added. The push resolves correctly
          // at runtime via the file-system route; the typed lookup will
          // pick it up on the next `expo start`/build.
          onPress={() => router.push('/programme' as never)}
        />
        <ChevronRow
          label="Annual Calendar"
          onPress={() => router.push('/recurring-events' as never)}
        />
        <ChevronRow
          label="The Network"
          onPress={() => router.push('/network' as never)}
        />
        <ChevronRow
          label="Life Transitions"
          onPress={() => router.push('/transition' as never)}
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

        <SectionHeader title="What You Love" subtext="Conductor watches for opportunities, not just obligations" />
        <WhatYouLoveBlock />

        <SectionHeader title="Financial Intelligence" subtext="How much Conductor engages with your finances" />
        <FinancialAwarenessBlock
          value={settings.financialAwareness}
          onChange={(v) => update({ ...settings, financialAwareness: v })}
        />

        <SectionHeader title="Extend with Shortcuts" subtext="Connect any app to Conductor without sharing access" />
        <ShortcutsLibraryBlock />

        <SectionHeader title="Programme" subtext="When the day opens and closes" />
        <ChevronRow
          label="Takeoff"
          rightText={format12Hour(settings.takeoffTime)}
          onPress={() => openTimeEditor('takeoffTime', 'Takeoff')}
        />
        <ToggleRow
          label="Weekend Takeoff"
          subtext="Deliver 1 hour later on weekends"
          value={settings.weekendTakeoffDelay}
          onChange={(v) => update({ ...settings, weekendTakeoffDelay: v })}
        />
        <ChevronRow
          label="Clearance"
          rightText={format12Hour(settings.clearanceTime)}
          onPress={() => openTimeEditor('clearanceTime', 'Clearance')}
        />
        <OverwatchPickerRow
          value={settings.overwatchHour}
          onChange={(h) => update({ ...settings, overwatchHour: h })}
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
          <ChevronRow label="View The Horizon" onPress={() => router.push('/horizon' as never)} />
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
        {/* Nextdoor neighborhood intelligence — connects via OAuth so
            safety alerts and recommendations surface in the brief. */}
        {nextdoorConnected === true ? (
          <Row
            label="🏘️ Nextdoor"
            subtext={nextdoorNeighborhood ? `Connected — ${nextdoorNeighborhood}` : 'Connected'}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={styles.ouraConnectedText}>✓</Text>
                <TouchableOpacity
                  onPress={handleDisconnectNextdoor}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.ouraDisconnectLink}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            }
          />
        ) : (
          <TouchableOpacity onPress={handleConnectNextdoor} activeOpacity={0.6}>
            <View style={styles.ouraConnectRow}>
              <Text style={styles.ouraConnectLabel}>🏘️ Nextdoor</Text>
              <Text style={styles.ouraConnectAction}>Connect Nextdoor →</Text>
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
          {(() => {
            const detected = detectedWorkCalendar
              ? calendarList.find((c) => c.id === detectedWorkCalendar)
              : null;
            const userOverride = (workCalDraft || '').trim();
            // Detected and not overridden — show the auto-detection
            // confirmation with a Change link.
            if (detected && !userOverride) {
              return (
                <View>
                  <Text style={styles.workCalDetected}>
                    ✓ Work calendar detected: {detected.summary}
                  </Text>
                  <TouchableOpacity onPress={() => setShowCalPicker(true)}>
                    <Text style={styles.workCalChange}>Change</Text>
                  </TouchableOpacity>
                </View>
              );
            }
            // Manual override OR nothing detected — show a tap-to-pick
            // row plus the raw TextInput as a fallback for manual entry.
            return (
              <View>
                <TouchableOpacity
                  onPress={() => setShowCalPicker(true)}
                  style={styles.workCalPickerRow}
                  activeOpacity={0.7}>
                  <Text style={styles.workCalPickerText}>
                    {userOverride || 'Choose a calendar →'}
                  </Text>
                </TouchableOpacity>
                <TextInput
                  value={workCalDraft}
                  onChangeText={setWorkCalDraft}
                  onBlur={commitWorkCalendarName}
                  onSubmitEditing={commitWorkCalendarName}
                  returnKeyType="done"
                  placeholder="Or type calendar name (e.g. Work, Office)"
                  placeholderTextColor={MUTED}
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={styles.workCalInput}
                />
              </View>
            );
          })()}
          <Text style={styles.workCalHelper}>
            Helps Conductor detect scheduling conflicts
          </Text>
        </View>

        <SectionHeader title="Language / Idioma" />
        <LanguageRow />

        <SectionHeader title="Your Voice" subtext="How Conductor talks to you" />
        <VoiceStyleBlock />

        <SectionHeader title="Hey Conductor" subtext="Hands-free interaction" />
        <HeyConductorBlock />

        <SectionHeader title="Conductor" />
        <Row label="Conductor" subtext="Version 1.0.0" />
        <Row
          label="API Access"
          subtext="Send signals to Conductor from any service"
          onPress={handleShowApiKey}
          right={<ChevronRight size={18} color={MUTED} />}
        />
        <ChevronRow
          label="Memory"
          onPress={() => router.push('/journal' as never)}
        />
        <ChevronRow
          label="Share This Week"
          onPress={() => router.push('/summary-card?period=week' as never)}
        />
        <ChevronRow
          label="Share This Month"
          onPress={() => router.push('/summary-card?period=month' as never)}
        />
        <ChevronRow
          label="How Conductor thinks"
          onPress={() => comingSoon('How Conductor thinks')}
        />
        <ChevronRow
          label="Directory"
          onPress={() => router.push('/directory' as never)}
        />
        <ChevronRow
          label="Privacy & Data"
          onPress={() => router.push('/privacy-dashboard' as never)}
        />
        <ChevronRow
          label="Household profile"
          onPress={() => router.push('/profile-setup' as never)}
        />

        <SectionHeader title="Founding Household" />
        <ReferralBlock />

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
        visible={showCalPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCalPicker(false)}>
        <Pressable style={styles.calPickerBackdrop} onPress={() => setShowCalPicker(false)}>
          <Pressable style={styles.calPickerSheet} onPress={() => {}}>
            <Text style={styles.calPickerTitle}>Select work calendar</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              <TouchableOpacity
                onPress={() => selectWorkCalendar('')}
                style={styles.calPickerRow}>
                <View style={[styles.calPickerDot, { backgroundColor: '#3a3835' }]} />
                <Text style={styles.calPickerName}>None</Text>
              </TouchableOpacity>
              {calendarList.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => selectWorkCalendar(c.summary)}
                  style={styles.calPickerRow}>
                  <View style={[styles.calPickerDot, { backgroundColor: c.backgroundColor || '#5a5855' }]} />
                  <Text style={styles.calPickerName} numberOfLines={1}>{c.summary}</Text>
                  {c.isWorkCalendar && <Text style={styles.calPickerWorkBadge}>Work</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
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

type ThemeColors = { background: string; surface: string; text: string; muted: string };
function makeStyles(theme: ThemeColors, accentColor: string) {
  const BRASS = accentColor;
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  return StyleSheet.create({
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
  workCalDetected: {
    color: '#7a9a6e',
    fontSize: 13,
    fontWeight: '500',
  },
  workCalChange: {
    color: BRASS,
    fontSize: 12,
    marginTop: 6,
  },
  workCalPickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    marginBottom: 8,
  },
  workCalPickerText: {
    color: OFF_WHITE,
    fontSize: 14,
  },
  calPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  calPickerSheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 22,
    paddingBottom: 36,
  },
  calPickerTitle: {
    color: OFF_WHITE,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  calPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  calPickerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  calPickerName: {
    color: OFF_WHITE,
    fontSize: 14,
    flex: 1,
  },
  calPickerWorkBadge: {
    color: BRASS,
    fontSize: 10,
    letterSpacing: 0.5,
    fontWeight: '600',
    textTransform: 'uppercase',
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
}
