// Weather Skins gallery — a showcase of all 10 weather backgrounds the
// Conductor paints behind Ground. Each skin is a static thumbnail card; tapping
// one opens a full-screen, fully-animated preview. Reached from Settings → The
// Score → Weather Skins.

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { WeatherBackground } from '@/components/WeatherBackground';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace' });

// Each skin drives WeatherBackground through its public (condition, hour) API —
// the condition strings + hours below resolve to exactly one image kind each
// (matching components/WeatherBackground.tsx resolveWeatherKind).
type Skin = { id: string; name: string; condition: string; hour: number };
const SKINS: Skin[] = [
  { id: 'clear-day', name: 'Clear Day', condition: 'clear', hour: 12 },
  { id: 'clear-night', name: 'Clear Night', condition: 'clear', hour: 22 },
  { id: 'partly-cloudy', name: 'Partly Cloudy', condition: 'partly', hour: 12 },
  { id: 'overcast', name: 'Overcast', condition: 'overcast', hour: 12 },
  { id: 'heavy-rain', name: 'Heavy Rain', condition: 'heavy rain', hour: 12 },
  { id: 'hazy-morning', name: 'Hazy Morning', condition: 'fog', hour: 7 },
  { id: 'sunset', name: 'Sunset', condition: 'sunset', hour: 18 },
  { id: 'hurricane', name: 'Hurricane', condition: 'hurricane', hour: 12 },
  { id: 'thunderstorm', name: 'Thunderstorm', condition: 'thunderstorm', hour: 12 },
  { id: 'clearing', name: 'Clearing', condition: 'clearing', hour: 12 },
];

export default function WeatherSkinsScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const { width } = useWindowDimensions();
  // Two columns inside the scroll padding (20 each side, 12 gutter).
  const cardW = (width - 40 - 12) / 2;
  const [preview, setPreview] = useState<Skin | null>(null);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Weather Skins"
        subtitle="every sky The Conductor paints"
        screenContext="weather-skins"
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>
          The Ground backdrop shifts with your household's weather. Tap any skin
          to see it live.
        </Text>
        <View style={styles.grid}>
          {SKINS.map((s) => (
            <TouchableOpacity
              key={s.id}
              activeOpacity={0.85}
              onPress={() => setPreview(s)}
              style={[styles.card, { width: cardW }]}>
              {/* Static thumbnail — no animation for a smooth grid. */}
              <WeatherBackground condition={s.condition} hour={s.hour} animated={false} />
              <View style={styles.cardLabelWrap}>
                <Text style={styles.cardLabel} numberOfLines={1}>
                  [{s.name.toUpperCase()}]
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Full-screen live preview — the selected skin with all its animations. */}
      <Modal
        visible={preview != null}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setPreview(null)}>
        <View style={styles.previewRoot}>
          {preview ? (
            <WeatherBackground condition={preview.condition} hour={preview.hour} animated />
          ) : null}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreview(null)} />
          <View pointerEvents="box-none" style={styles.previewChrome}>
            <View style={styles.previewTopRow}>
              <Text style={styles.previewName}>[{(preview?.name || '').toUpperCase()}]</Text>
              <TouchableOpacity
                onPress={() => setPreview(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.closeBtn}>
                <Text style={styles.closeText}>✕ CLOSE</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.previewHint}>Tap anywhere to dismiss</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(
  theme: { background: string; text: string; muted: string },
  accentColor: string,
) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: 20, paddingBottom: 48 },
    lead: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 18,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    card: {
      height: 150,
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: accentColor + '33',
      backgroundColor: '#0a0e16',
      justifyContent: 'flex-end',
    },
    // Dark strip under the label so the bracketed name stays legible over any sky.
    cardLabelWrap: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      backgroundColor: 'rgba(3,6,13,0.55)',
    },
    cardLabel: {
      color: accentColor,
      fontSize: 11,
      letterSpacing: 1.5,
      fontWeight: '700',
      fontFamily: MONO,
      textShadowColor: accentColor,
      textShadowRadius: 8,
      textShadowOffset: { width: 0, height: 0 },
    },
    previewRoot: { flex: 1, backgroundColor: '#03060d' },
    previewChrome: {
      flex: 1,
      paddingTop: 56,
      paddingHorizontal: 22,
      justifyContent: 'flex-start',
    },
    previewTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    previewName: {
      color: accentColor,
      fontSize: 16,
      letterSpacing: 2,
      fontWeight: '700',
      fontFamily: MONO,
      textShadowColor: accentColor,
      textShadowRadius: 12,
      textShadowOffset: { width: 0, height: 0 },
    },
    closeBtn: {
      borderWidth: 1,
      borderColor: accentColor,
      borderRadius: 20,
      paddingVertical: 6,
      paddingHorizontal: 14,
      backgroundColor: 'rgba(3,6,13,0.4)',
    },
    closeText: {
      color: accentColor,
      fontSize: 11,
      letterSpacing: 1,
      fontWeight: '700',
      fontFamily: MONO,
    },
    previewHint: {
      color: 'rgba(255,255,255,0.6)',
      fontSize: 11,
      letterSpacing: 0.5,
      marginTop: 10,
      fontFamily: MONO,
    },
  });
}
