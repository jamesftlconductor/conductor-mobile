// Shared layout for the four Movement screens — full-page destinations reached
// by a directional swipe from The Conductor. The live WeatherBackground sits
// fixed behind a floating GlassCard whose content scrolls. Swiping in the
// OPPOSITE direction of entry (or the back affordance / hardware back) returns
// to The Conductor.

import { ReactNode, useEffect, useState } from 'react';
import { Alert, Animated, ImageBackground, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Activity, Boxes, Building2, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight,
  GraduationCap, Heart, Mail, MessageSquare, Users, Watch, Zap,
} from 'lucide-react-native';

import { useTheme } from '@/app/theme';
import { useUserId } from '@/hooks/useUserId';
import { fetchHealthSnapshot } from '@/components/HealthContext';
import { GlassCard } from '@/components/GlassCard';
import { SignalIcon } from '@/components/SignalIcon';
import { ChordIndicator } from '@/components/ChordIndicator';
import { MOVEMENTS, MovementKey, SwipeDirection } from '@/utils/movements';
import { MOVEMENT_SOURCES, SourceIconKey, SourceItem } from '@/utils/movementSources';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

// Source icon key → lucide component.
const SOURCE_ICON: Record<SourceIconKey, typeof Mail> = {
  gmail: Mail,
  inventory: Boxes,
  attom: Building2,
  shortcuts: Zap,
  email: Mail,
  calendar: Calendar,
  contacts: Users,
  crew: Users,
  classdojo: GraduationCap,
  classroom: GraduationCap,
  remind: MessageSquare,
  healthkit: Heart,
  oura: Activity,
  whoop: Activity,
  garmin: Watch,
};

// The astrolabe — the shared "intelligence layer" backdrop behind The Conductor
// and all four movements (Ground keeps the real-world weather backdrop).
const RADAR_IMG = require('../assets/conductor-radar.png');

export type MovementSignal = {
  id: string | number;
  type?: string;
  description?: string;
  sender?: string | null;
  eta?: string | null;
  status?: string;
  state?: string;
  userId?: string | null;
  crewMemberId?: string | null;
};

const OPPOSITE: Record<SwipeDirection, SwipeDirection> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function MovementScreen({
  movementKey,
  children,
}: {
  movementKey: MovementKey;
  children: ReactNode;
}) {
  const { theme, accentColor } = useTheme();
  const insets = useSafeAreaInsets();
  const movement = MOVEMENTS.find((m) => m.key === movementKey) ?? MOVEMENTS[0];

  // Return on a swipe opposite the entry direction.
  const back = OPPOSITE[movement.direction];
  const backSwipe = Gesture.Pan()
    .runOnJS(true)
    .onEnd((e) => {
      const dx = e.translationX;
      const dy = e.translationY;
      if (Math.abs(dx) < 60 && Math.abs(dy) < 60) return;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      if (back === 'down' && !horizontal && dy > 60) router.back();
      else if (back === 'up' && !horizontal && dy < -60) router.back();
      else if (back === 'left' && horizontal && dx < -60) router.back();
      else if (back === 'right' && horizontal && dx > 60) router.back();
    });

  return (
    <View style={{ flex: 1, backgroundColor: '#05080f' }}>
      {/* Astrolabe backdrop (same artwork as Hover), cover-cropped, then dimmed
          so the glass card stays readable while the rings show through/around. */}
      <ImageBackground source={RADAR_IMG} resizeMode="cover" style={StyleSheet.absoluteFillObject} />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#05080f', opacity: 0.6 }]}
      />
      <GestureDetector gesture={backSwipe}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 14,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
          }}>
          <GlassCard
            style={{ flex: 1, padding: 0 }}
            tint={movement.glassTint}
            bracketColor={movement.bracketColor ?? accentColor}>
            <View style={styles.inner}>
              <View style={styles.headerRow}>
                <TouchableOpacity
                  onPress={() => router.back()}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.backBtn}>
                  <ChevronLeft size={22} color={accentColor} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: accentColor }]}>{movement.title}</Text>
                  <Text style={[styles.subtitle, { color: theme.muted }]}>{movement.subtitle}</Text>
                </View>
                <Text style={[styles.arrowHint, { color: accentColor }]}>{movement.arrow}</Text>
              </View>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}>
                {children}
                <MovementSources movementKey={movementKey} />
              </ScrollView>
              {/* Movement jump nav — the chord with this movement enlarged; tap
                  any other mark to slide straight to it without returning to
                  The Conductor. */}
              <View style={styles.chordBar}>
                <ChordIndicator active={movementKey} size={16} gap={16} />
              </View>
            </View>
          </GlassCard>
        </View>
      </GestureDetector>
    </View>
  );
}

// ── Reusable content pieces ──────────────────────────────────────────────

export function MovementSection({ title, children }: { title: string; children: ReactNode }) {
  const { theme, accentColor } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: accentColor }]}>{title}</Text>
      <View style={[styles.sectionDivider, { backgroundColor: accentColor + '1f' }]} />
      {children}
    </View>
  );
}

export function SignalRow({ signal }: { signal: MovementSignal }) {
  const { theme } = useTheme();
  const meta = [signal.sender, signal.status, signal.eta ? `ETA ${signal.eta}` : null]
    .filter(Boolean)
    .join('  ·  ');
  return (
    <View style={styles.row}>
      <SignalIcon type={signal.type} size={16} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowText, { color: theme.text }]} numberOfLines={2}>
          {signal.description || 'Signal'}
        </Text>
        {!!meta && <Text style={[styles.rowMeta, { color: theme.muted }]}>{meta}</Text>}
      </View>
    </View>
  );
}

export function EmptyLine({ text }: { text: string }) {
  const { theme } = useTheme();
  return <Text style={[styles.empty, { color: theme.muted }]}>{text}</Text>;
}

export function ConnectPrompt({ text, onPress }: { text: string; onPress: () => void }) {
  const { accentColor } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.connect, { borderColor: accentColor + '59' }]}>
      <Text style={[styles.connectText, { color: accentColor }]}>{text}</Text>
    </TouchableOpacity>
  );
}

// Collapsible "Sources" section — what feeds this movement (CONNECTED, with a
// ✓) and what could feed it better (AVAILABLE, with a value line + Connect →).
// Google Calendar / Work Calendar (work) and Apple HealthKit (wellness) are
// injected from the live connection state; the rest is static config.
type AvailableSource = { item: SourceItem; action: 'settings-score' | 'soon' };

export function MovementSources({ movementKey }: { movementKey: MovementKey }) {
  const { theme, accentColor } = useTheme();
  const userId = useUserId();
  const [open, setOpen] = useState(false);
  const [workConnected, setWorkConnected] = useState(false);
  const [healthConnected, setHealthConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (movementKey === 'work' && userId) {
        try {
          const res = await fetch(`${API_BASE}/signals?type=preferences&userId=${userId}`);
          const data = await res.json();
          if (!cancelled) setWorkConnected(!!String(data?.preferences?.workCalendarName || '').trim());
        } catch {
          /* leave not-connected */
        }
      }
      if (movementKey === 'wellness') {
        try {
          const snap = await fetchHealthSnapshot();
          if (!cancelled) setHealthConnected(!!snap);
        } catch {
          /* leave not-connected */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [movementKey, userId]);

  const base = MOVEMENT_SOURCES[movementKey] ?? { connected: [], available: [] };
  const connected: SourceItem[] = [...base.connected];
  const available: AvailableSource[] = base.available.map((item) => ({ item, action: 'soon' as const }));

  if (movementKey === 'work') {
    if (workConnected) connected.unshift({ name: 'Google Calendar', icon: 'calendar' });
    else
      available.push({
        item: { name: 'Work Calendar', icon: 'calendar', value: 'Connect for conflict detection' },
        action: 'settings-score',
      });
  }
  if (movementKey === 'wellness' && healthConnected) {
    connected.unshift({ name: 'Apple HealthKit', icon: 'healthkit' });
  }

  const onConnect = (item: SourceItem, action: 'settings-score' | 'soon') => {
    if (action === 'settings-score') router.push('/(tabs)/settings?hub=score' as never);
    else Alert.alert('Coming soon', `${item.name} integration is coming soon.`);
  };

  return (
    <View style={styles.section}>
      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
        style={styles.sourcesHeader}>
        <Text style={[styles.sectionTitle, { color: accentColor }]}>Sources</Text>
        {open ? (
          <ChevronDown size={16} color={accentColor} />
        ) : (
          <ChevronRight size={16} color={accentColor} />
        )}
      </TouchableOpacity>
      <View style={[styles.sectionDivider, { backgroundColor: accentColor + '1f' }]} />
      {open ? (
        <>
          {connected.map((it) => {
            const Icon = SOURCE_ICON[it.icon];
            return (
              <View key={`c-${it.name}`} style={styles.row}>
                <Icon size={16} color={theme.muted} />
                <Text style={[styles.rowText, { color: theme.text, flex: 1 }]}>{it.name}</Text>
                <Check size={15} color={accentColor} />
              </View>
            );
          })}
          {available.map(({ item, action }) => {
            const Icon = SOURCE_ICON[item.icon];
            return (
              <View key={`a-${item.name}`} style={styles.row}>
                <Icon size={16} color={theme.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowText, { color: theme.text }]}>{item.name}</Text>
                  {!!item.value && (
                    <Text style={[styles.rowMeta, { color: theme.muted }]}>{item.value}</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => onConnect(item, action)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[styles.connectInline, { color: accentColor }]}>Connect →</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  chordBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14 },
  backBtn: { marginTop: 1 },
  title: { fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  subtitle: { fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', marginTop: 3 },
  arrowHint: { fontSize: 14, opacity: 0.5, marginTop: 1 },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  sectionDivider: { height: 1, marginTop: 8, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  rowText: { fontSize: 14, lineHeight: 19 },
  rowMeta: { fontSize: 11, letterSpacing: 0.3, marginTop: 2 },
  empty: { fontSize: 13, fontStyle: 'italic', paddingVertical: 6 },
  connect: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  connectText: { fontSize: 14, fontWeight: '600', letterSpacing: 0.3 },
  sourcesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  connectInline: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
});
