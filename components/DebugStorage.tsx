// Diagnostic overlay — full-screen modal that dumps every AsyncStorage
// key + value, plus what BootGuard is currently seeing. Mounted at the
// root when DEBUG_STORAGE_ENABLED is true so we can verify whether a
// fresh-install device actually has the AsyncStorage state we expect.
//
// Background: BootGuard didn't fire on James's new EAS build install.
// Either userId was already populated (somehow), the hook never loaded,
// or the redirect ran into a race. This surface answers that without
// needing Xcode's Console.
//
// Two buttons:
//   - Clear all & restart — wipes every AsyncStorage key, then bounces
//     to /onboarding. Use this to simulate Sarah's first launch.
//   - Continue — dismisses the overlay so the app proceeds normally.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { DEBUG_STORAGE_ENABLED } from '@/utils/debugLog';
import { useUserId, useUserIdLoaded } from '@/hooks/useUserId';

type Entry = { key: string; value: string | null };

export function DebugStorage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const userId = useUserId();
  const loaded = useUserIdLoaded();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const pairs = await AsyncStorage.multiGet(keys);
        if (!mounted) return;
        const e: Entry[] = pairs.map(([k, v]) => ({ key: k, value: v ?? null }));
        e.sort((a, b) => a.key.localeCompare(b.key));
        setEntries(e);
      } catch (err: any) {
        if (!mounted) return;
        setEntries([{ key: '(error)', value: String(err?.message || err) }]);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (!DEBUG_STORAGE_ENABLED) return null;
  if (dismissed) return null;

  async function clearAndRestart() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      if (keys.length > 0) await AsyncStorage.multiRemove(keys);
    } catch { /* ignore */ }
    setDismissed(true);
    try { router.replace('/onboarding' as never); } catch { /* ignore */ }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setDismissed(true)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>AsyncStorage Diagnostic</Text>
          <Text style={styles.subtitle}>
            BootGuard sees: loaded={String(loaded)} userId={userId ?? '(null)'}
          </Text>

          <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 16 }}>
            {entries === null ? (
              <Text style={styles.bodyMuted}>Reading AsyncStorage…</Text>
            ) : entries.length === 0 ? (
              <Text style={styles.bodyMuted}>(empty — no keys)</Text>
            ) : (
              entries.map((e) => (
                <View key={e.key} style={styles.row}>
                  <Text style={styles.key}>{e.key}</Text>
                  <Text style={styles.value} numberOfLines={5}>{e.value || '(null)'}</Text>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={clearAndRestart} style={[styles.button, styles.danger]}>
              <Text style={styles.dangerText}>Clear all & restart</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setDismissed(true)} style={styles.button}>
              <Text style={styles.buttonText}>Continue</Text>
            </TouchableOpacity>
          </View>

          <Pressable onPress={() => setDismissed(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.hint}>Toggle off in utils/debugLog.ts → DEBUG_STORAGE_ENABLED</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingTop: Platform.OS === 'ios' ? 60 : 30,
    paddingHorizontal: 14,
    paddingBottom: 30,
  },
  sheet: {
    flex: 1,
    backgroundColor: '#101010',
    borderRadius: 14,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  title: { color: '#f0ede8', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  subtitle: { color: '#b8960c', fontSize: 12, marginBottom: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  scroll: { flex: 1 },
  row: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  key: { color: '#f0ede8', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  value: {
    color: '#8a8780',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  bodyMuted: { color: '#5a5855', fontSize: 12, fontStyle: 'italic', padding: 12 },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 8 },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(184,150,12,0.16)',
    borderWidth: 1,
    borderColor: '#b8960c',
    alignItems: 'center',
  },
  buttonText: { color: '#b8960c', fontSize: 13, fontWeight: '600' },
  danger: {
    backgroundColor: 'rgba(239,68,68,0.16)',
    borderColor: '#ef4444',
  },
  dangerText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  hint: {
    color: '#5a5855',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
  },
});
