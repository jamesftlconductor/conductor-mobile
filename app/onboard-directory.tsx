// Directory introduction — the final onboarding step. Explains the "?"
// affordance that opens the Directory, with a simple mock of the Ground
// screen highlighting it, then proceeds to Ground.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';

export default function OnboardDirectoryScreen() {
  const { theme, accentColor } = useTheme();

  async function done() {
    try {
      await AsyncStorage.setItem('directoryIntroSeen', 'true');
    } catch { /* best-effort */ }
    router.replace('/(tabs)');
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Mock Ground screen — "?" highlighted top-left, Minimap dot top-right,
          faux brief lines below. */}
      <View style={[styles.mock, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <View style={styles.mockTopRow}>
          <View style={[styles.qBadge, { borderColor: accentColor, backgroundColor: accentColor + '22' }]}>
            <Text style={[styles.qMark, { color: accentColor }]}>?</Text>
          </View>
          <View style={[styles.mockDot, { backgroundColor: theme.muted }]} />
        </View>
        <View style={[styles.mockLine, { backgroundColor: theme.muted, width: '55%' }]} />
        <View style={[styles.mockLine, { backgroundColor: theme.border, width: '92%' }]} />
        <View style={[styles.mockLine, { backgroundColor: theme.border, width: '84%' }]} />
        <View style={[styles.mockLine, { backgroundColor: theme.border, width: '88%' }]} />
      </View>

      <Text style={[styles.body, { color: theme.text }]}>
        The <Text style={{ color: accentColor, fontWeight: '700' }}>?</Text> button opens the
        Directory — your guide to everything Conductor can do.
      </Text>

      <TouchableOpacity onPress={done} activeOpacity={0.85} style={[styles.cta, { backgroundColor: accentColor }]}>
        <Text style={styles.ctaText}>Got it →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  mock: {
    width: '78%',
    aspectRatio: 0.92,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    marginBottom: 40,
  },
  mockTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  qBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qMark: { fontSize: 15, fontWeight: '700' },
  mockDot: { width: 26, height: 26, borderRadius: 13, opacity: 0.5 },
  mockLine: { height: 10, borderRadius: 5, marginBottom: 12 },
  body: {
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
    fontWeight: '300',
    marginBottom: 44,
  },
  cta: {
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 24,
  },
  ctaText: { color: '#0f0f0f', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
});
