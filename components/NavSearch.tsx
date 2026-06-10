// App-navigation search — a small search icon that expands into a search
// bar with predictive results matching screen names and features. Lives on
// the Ground screen; tapping a result navigates (or opens the Conductor
// sheet / Paris-trip-filtered radar). Dismisses on backdrop tap.

import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';
import { openConductorSheet } from '@/hooks/useConductorSheet';

type Destination = {
  label: string;
  emoji: string;
  keywords: string[];
  run: () => void;
};

// Static catalog of navigable destinations + their match keywords. `run`
// is fired when the result is tapped (after the overlay closes).
const DESTINATIONS: Destination[] = [
  { label: 'Vault', emoji: '🗄', keywords: ['vault', 'renewals', 'subscriptions', 'deadlines', 'policies'], run: () => router.push('/vault' as never) },
  { label: 'Crew', emoji: '👥', keywords: ['crew', 'family', 'kids', 'children', 'pets'], run: () => router.push('/crew' as never) },
  { label: 'Hover (Radar)', emoji: '🛰', keywords: ['hover', 'radar', 'signals', 'dots'], run: () => router.push('/(tabs)/hover' as never) },
  { label: 'Paris trip', emoji: '✈️', keywords: ['paris', 'trip', 'france', 'nice', 'montpellier', 'travel'], run: () => router.push('/(tabs)/hover?threadId=paris-trip-june-2026' as never) },
  { label: 'Horizon', emoji: '🌅', keywords: ['horizon', 'upcoming', 'further out', 'coming up'], run: () => router.push('/horizon' as never) },
  { label: 'Compass', emoji: '🧭', keywords: ['compass', 'patterns', 'awareness'], run: () => router.push('/compass' as never) },
  { label: 'The Programme', emoji: '🗓', keywords: ['programme', 'program', 'timeline', 'schedule'], run: () => router.push('/programme' as never) },
  { label: 'Service Providers', emoji: '🔧', keywords: ['providers', 'service', 'plumber', 'hvac', 'contractor'], run: () => router.push('/providers' as never) },
  { label: 'Home Maintenance', emoji: '🏠', keywords: ['maintenance', 'home', 'seasonal'], run: () => router.push('/maintenance' as never) },
  { label: 'Home Inventory', emoji: '📦', keywords: ['inventory', 'belongings', 'vehicles'], run: () => router.push('/inventory' as never) },
  { label: 'The Network', emoji: '🔗', keywords: ['network', 'connected households', 'family'], run: () => router.push('/network' as never) },
  { label: 'Send a message', emoji: '✉️', keywords: ['communicate', 'message', 'household chat'], run: () => router.push('/communicate' as never) },
  { label: 'Settings', emoji: '⚙️', keywords: ['settings', 'your house', 'preferences', 'theme', 'brief time'], run: () => router.push('/(tabs)/settings' as never) },
  { label: 'Directory', emoji: '📖', keywords: ['directory', 'help', 'how it works'], run: () => router.push('/directory' as never) },
  { label: 'Privacy & Data', emoji: '🔒', keywords: ['privacy', 'data', 'export'], run: () => router.push('/privacy-dashboard' as never) },
  { label: 'Ask The Conductor', emoji: '💬', keywords: ['ask', 'conductor', 'question', 'help me'], run: () => openConductorSheet('ground') },
];

export function NavSearch() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DESTINATIONS;
    return DESTINATIONS.filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.keywords.some((k) => k.includes(q) || q.includes(k))
    );
  }, [query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function pick(d: Destination) {
    close();
    // Defer so the modal is fully dismissed before navigation/sheet open.
    setTimeout(() => d.run(), 60);
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.6}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.trigger}>
        <Text style={styles.triggerGlyph}>🔍</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="fade" transparent onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.kavFill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.backdrop} onPress={close}>
            <Pressable
              style={styles.panel}
              onPress={() => {}}>
              <View style={styles.searchRow}>
                <Text style={styles.searchGlyph}>🔍</Text>
                <TextInput
                  ref={inputRef}
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                  placeholder="Search Conductor…"
                  placeholderTextColor={theme.muted}
                  style={styles.input}
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    if (results.length > 0) pick(results[0]);
                  }}
                />
                <TouchableOpacity onPress={close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.cancel}>Cancel</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.resultsList}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 8 }}>
                {results.length === 0 ? (
                  <Text style={styles.empty}>No matches.</Text>
                ) : (
                  results.map((d) => (
                    <TouchableOpacity
                      key={d.label}
                      onPress={() => pick(d)}
                      activeOpacity={0.6}
                      style={styles.resultRow}>
                      <Text style={styles.resultEmoji}>{d.emoji}</Text>
                      <Text style={styles.resultLabel}>{d.label}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

type ThemeColors = { background: string; surface: string; text: string; muted: string; border: string };
function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    trigger: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    triggerGlyph: { fontSize: 16 },
    kavFill: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingTop: 100,
      paddingHorizontal: 16,
    },
    panel: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border || 'rgba(255,255,255,0.08)',
      maxHeight: '70%',
      overflow: 'hidden',
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border || 'rgba(255,255,255,0.08)',
      gap: 10,
    },
    searchGlyph: { fontSize: 15 },
    input: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
      paddingVertical: 4,
    },
    cancel: { color: accentColor, fontSize: 14, fontWeight: '600' },
    resultsList: { paddingHorizontal: 6, paddingTop: 4 },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 12,
      gap: 12,
      borderRadius: 8,
    },
    resultEmoji: { fontSize: 18, width: 24 },
    resultLabel: { color: theme.text, fontSize: 15, fontWeight: '500' },
    empty: { color: theme.muted, fontSize: 13, padding: 16, textAlign: 'center' },
  });
}
