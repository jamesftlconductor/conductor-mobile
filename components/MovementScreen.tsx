// Shared layout for the four Movement screens — full-page destinations reached
// by a directional swipe from The Conductor. The live WeatherBackground sits
// fixed behind a floating GlassCard whose content scrolls. Swiping in the
// OPPOSITE direction of entry (or the back affordance / hardware back) returns
// to The Conductor.

import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';

import { useTheme } from '@/app/theme';
import { WeatherBackground } from '@/components/WeatherBackground';
import { GlassCard } from '@/components/GlassCard';
import { SignalIcon } from '@/components/SignalIcon';
import { MOVEMENTS, MovementKey, SwipeDirection } from '@/utils/movements';

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
      <WeatherBackground animated style={StyleSheet.absoluteFillObject} />
      <GestureDetector gesture={backSwipe}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 14,
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
          }}>
          <GlassCard style={{ flex: 1, padding: 0 }}>
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
              </ScrollView>
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

const styles = StyleSheet.create({
  inner: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
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
});
