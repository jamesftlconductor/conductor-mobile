// Privacy & Data — transparency screen surfacing what Conductor
// reads, what it stores, and the live counts of household data.
// Pulls from /api/signals?type=privacy. Also surfaces controls for
// data export and account deletion (wired to ?type=export and
// ?type=delete-account).

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { useUserId } from '@/hooks/useUserId';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PulsingCMark } from '@/components/PulsingCMark';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTheme } from '@/app/theme';

const API_BASE = 'https://conductor-ivory.vercel.app/api';
const RED = '#ef4444';

type PrivacyData = {
  ok: boolean;
  signalsFound: number;
  vaultItems: number;
  crewMembers: number;
  emailsScanned: number;
  sentCommunications: number;
  networkConnections: number;
  connectedSince: string | null;
  dataTypes: string[];
};

const DATA_SOURCE_ROWS = [
  { emoji: '📧', label: 'Gmail', desc: "Reads emails to find signals. Never stores email content.", key: 'gmail' },
  { emoji: '📅', label: 'Calendar', desc: 'Reads events for conflict detection. Descriptions never stored.', key: 'calendar' },
  { emoji: '❤️', label: 'Health', desc: 'Reads Apple Health on your device. Never leaves device unencrypted.', key: 'health' },
  { emoji: '📍', label: 'Location', desc: 'Uses your city for weather. Exact location never tracked.', key: 'location' },
  { emoji: '⌚', label: 'Oura', desc: 'Reads readiness and sleep. Stored encrypted.', key: 'oura' },
];

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)));
}

export default function PrivacyDashboardScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [userId, setUserId] = useState<string>('');
  const [data, setData] = useState<PrivacyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const activeUserId = useUserId();
  useEffect(() => {
    setUserId(activeUserId || '');
  }, [activeUserId]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=privacy&userId=${encodeURIComponent(userId)}`);
      const json = await res.json();
      if (res.ok && json?.ok) setData(json as PrivacyData);
    } catch { /* best-effort */ }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  async function exportData() {
    if (!userId) return;
    setExporting(true);
    try {
      const url = `${API_BASE}/signals?type=export&userId=${encodeURIComponent(userId)}`;
      const fileUri = `${FileSystem.cacheDirectory}conductor-export-${Date.now()}.json`;
      const download = await FileSystem.downloadAsync(url, fileUri);
      if (download.status !== 200) {
        Alert.alert('Export failed', `Status ${download.status}`);
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(download.uri, { mimeType: 'application/json' });
      } else {
        Alert.alert('Saved', `Export saved to ${download.uri}`);
      }
    } catch (err: any) {
      Alert.alert('Export failed', err?.message || String(err));
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (confirmPhrase.trim().toUpperCase() !== 'DELETE') {
      Alert.alert('Type DELETE to confirm', 'You need to type the word DELETE exactly.');
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=delete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, confirmationPhrase: 'delete my account' }),
      });
      const json = await res.json();
      if (!res.ok || !json?.deleted) {
        Alert.alert('Could not delete', json?.error || `Status ${res.status}`);
        return;
      }
      await AsyncStorage.clear();
      Alert.alert('Deleted', 'Your account has been permanently deleted.', [
        { text: 'OK', onPress: () => router.replace('/onboarding' as any) },
      ]);
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setDeleting(false);
    }
  }

  const connectedDays = daysSince(data?.connectedSince || null);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Privacy & Data" subtitle="How Conductor works with your information" screenContext="privacy-dashboard" />
      <ScrollView contentContainerStyle={styles.scroll}>

        <Text style={styles.sectionLabel}>WHAT CONDUCTOR READS</Text>
        <View style={styles.block}>
          {DATA_SOURCE_ROWS.map((r) => (
            <View key={r.key} style={styles.sourceRow}>
              <Text style={styles.sourceEmoji}>{r.emoji}</Text>
              <View style={styles.sourceBody}>
                <Text style={styles.sourceLabel}>{r.label}</Text>
                <Text style={styles.sourceDesc}>{r.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>YOUR DATA</Text>
        <View style={styles.block}>
          {loading || !data ? (
            <PulsingCMark size={30} />
          ) : (
            <>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{data.signalsFound}</Text>
                <Text style={styles.statLabel}>signals found</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{data.vaultItems}</Text>
                <Text style={styles.statLabel}>vault items being watched</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{data.crewMembers}</Text>
                <Text style={styles.statLabel}>crew members</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{data.emailsScanned}</Text>
                <Text style={styles.statLabel}>emails scanned</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{data.sentCommunications}</Text>
                <Text style={styles.statLabel}>emails sent</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statValue}>{data.networkConnections}</Text>
                <Text style={styles.statLabel}>network connections</Text>
              </View>
              {connectedDays !== null ? (
                <Text style={styles.connectedSince}>
                  Connected {connectedDays} day{connectedDays === 1 ? '' : 's'} ago
                </Text>
              ) : null}
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>WHAT CONDUCTOR NEVER DOES</Text>
        <View style={styles.block}>
          {[
            'Sells your data — ever',
            "Reads emails that don't generate signals",
            'Shares household data without permission',
            'Stores health data unencrypted',
          ].map((t) => (
            <View key={t} style={styles.neverRow}>
              <Text style={styles.neverIcon}>✗</Text>
              <Text style={styles.neverText}>{t}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>DATA CONTROLS</Text>
        <View style={styles.block}>
          <TouchableOpacity
            onPress={exportData}
            disabled={exporting}
            style={styles.controlRow}>
            <Text style={styles.controlLabel}>
              {exporting ? 'Preparing export…' : 'Export my data'}
            </Text>
            <Text style={styles.controlArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setDeleteOpen(true)}
            style={styles.controlRow}>
            <Text style={[styles.controlLabel, { color: RED }]}>Delete my account</Text>
            <Text style={[styles.controlArrow, { color: RED }]}>→</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />

        <Modal visible={deleteOpen} transparent animationType="slide" onRequestClose={() => setDeleteOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setDeleteOpen(false)}>
            <Pressable style={styles.deleteModal} onPress={() => {}}>
              <Text style={styles.deleteTitle}>Delete account permanently?</Text>
              <Text style={styles.deleteBody}>
                This will permanently delete all your household data — signals,
                vault items, crew, memory, everything. This cannot be undone.
              </Text>
              <Text style={styles.deleteHint}>Type DELETE to confirm</Text>
              <TextInput
                value={confirmPhrase}
                onChangeText={setConfirmPhrase}
                placeholder="DELETE"
                placeholderTextColor={theme.muted}
                autoCapitalize="characters"
                style={styles.deleteInput}
              />
              <View style={styles.deleteBtnRow}>
                <TouchableOpacity
                  onPress={() => { setDeleteOpen(false); setConfirmPhrase(''); }}
                  style={styles.deleteCancelBtn}>
                  <Text style={styles.deleteCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={deleteAccount}
                  disabled={deleting}
                  style={[styles.deleteConfirmBtn, deleting && { opacity: 0.5 }]}>
                  {deleting ? (
                    <PulsingCMark size={18} />
                  ) : (
                    <Text style={styles.deleteConfirmText}>Delete permanently</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </View>
  );
}

type ThemeColors = { background: string; surface: string; text: string; muted: string };

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 60 },

    sectionLabel: {
      color: theme.muted, fontSize: 10, letterSpacing: 2,
      marginTop: 24, marginBottom: 12, fontWeight: '600',
      textTransform: 'uppercase',
    },
    block: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.06)',
      padding: 16,
    },

    sourceRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, minHeight: 44 },
    sourceEmoji: { fontSize: 22, marginRight: 14 },
    sourceBody: { flex: 1 },
    sourceLabel: { color: theme.text, fontSize: 15, fontWeight: '600' },
    sourceDesc: { color: theme.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },

    statRow: {
      flexDirection: 'row', alignItems: 'baseline',
      paddingVertical: 8,
    },
    statValue: { color: accentColor, fontSize: 22, fontWeight: '600', minWidth: 56 },
    statLabel: { color: theme.muted, fontSize: 13, marginLeft: 8 },
    connectedSince: { color: theme.muted, fontSize: 11, marginTop: 12, fontStyle: 'italic' },

    neverRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
    neverIcon: { color: RED, fontSize: 16, fontWeight: '700', marginRight: 12, lineHeight: 20 },
    neverText: { color: theme.text, fontSize: 13, lineHeight: 20, flex: 1 },

    controlRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 12, paddingHorizontal: 0, minHeight: 44,
    },
    controlLabel: { color: theme.text, fontSize: 15 },
    controlArrow: { color: accentColor, fontSize: 16 },

    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
    deleteModal: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 18, borderTopRightRadius: 18,
      padding: 24, paddingBottom: 36,
    },
    deleteTitle: { color: theme.text, fontSize: 18, fontWeight: '600' },
    deleteBody: { color: theme.muted, fontSize: 13, lineHeight: 20, marginTop: 12 },
    deleteHint: { color: theme.muted, fontSize: 10, marginTop: 24, letterSpacing: 2, textTransform: 'uppercase', fontWeight: '600' },
    deleteInput: {
      color: theme.text, fontSize: 16, fontWeight: '600',
      paddingVertical: 12, paddingHorizontal: 14,
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.06)',
      marginTop: 10,
      letterSpacing: 2,
    },
    deleteBtnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
    deleteCancelBtn: {
      flex: 1, paddingVertical: 14, borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.06)',
      alignItems: 'center',
    },
    deleteCancelText: { color: theme.muted, fontSize: 14 },
    deleteConfirmBtn: {
      flex: 1, paddingVertical: 14, borderRadius: 24,
      backgroundColor: RED, alignItems: 'center',
    },
    deleteConfirmText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  });
}
