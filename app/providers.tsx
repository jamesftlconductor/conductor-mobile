import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from './theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SwipeDismissSheet } from '@/components/SwipeDismissSheet';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type ThemeColors = { background: string; surface: string; text: string; muted: string };

type Provider = {
  _key?: string;
  name?: string;
  serviceType?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
  lastServiceDate?: string | null;
  estimateAmount?: number | null;
  firstSeen?: string;
  lastSeen?: string;
  source?: string;
};

type ServiceType = {
  key: string;
  label: string;
  emoji: string;
};

const SERVICE_TYPES: ServiceType[] = [
  { key: 'hvac',       label: 'HVAC',       emoji: '🌡' },
  { key: 'plumbing',   label: 'Plumbing',   emoji: '🔧' },
  { key: 'electrical', label: 'Electrical', emoji: '⚡' },
  { key: 'roofing',    label: 'Roofing',    emoji: '🏠' },
  { key: 'painting',   label: 'Painting',   emoji: '🎨' },
  { key: 'pool',       label: 'Pool',       emoji: '🏊' },
  { key: 'lawn',       label: 'Lawn',       emoji: '🌿' },
  { key: 'pest',       label: 'Pest',       emoji: '🪲' },
  { key: 'cleaning',   label: 'Cleaning',   emoji: '🧹' },
  { key: 'appliance',  label: 'Appliance',  emoji: '📦' },
  { key: 'handyman',   label: 'Handyman',   emoji: '🔨' },
  { key: 'other',      label: 'Other',      emoji: '📋' },
];
const TYPE_BY_KEY: Record<string, ServiceType> = Object.fromEntries(
  SERVICE_TYPES.map((s) => [s.key, s])
);

function formatLastUsed(p: Provider): string {
  const d = p.lastServiceDate || p.lastSeen;
  if (!d) return '';
  const ms = Date.parse(d);
  if (isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProvidersScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const MUTED = theme.muted;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/signals?type=providers&userId=${USER_ID}`);
      if (!res.ok) return;
      const data = await res.json();
      setProviders(Array.isArray(data?.providers) ? data.providers : []);
    } catch { /* best-effort */ }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Group by serviceType, in the SERVICE_TYPES order. Skip empty groups.
  const grouped = (() => {
    const byType: Record<string, Provider[]> = {};
    for (const p of providers) {
      const k = p.serviceType && TYPE_BY_KEY[p.serviceType] ? p.serviceType : 'other';
      if (!byType[k]) byType[k] = [];
      byType[k].push(p);
    }
    return SERVICE_TYPES.filter((t) => byType[t.key] && byType[t.key].length > 0)
      .map((t) => ({ ...t, items: byType[t.key] }));
  })();

  function callProvider(phone?: string | null) {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => { /* ignored */ });
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Service Providers"
        subtitle="Who Conductor has found and saved"
        rightAction={
          <TouchableOpacity
            onPress={() => setAddModalVisible(true)}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.addLink}>+ Add</Text>
          </TouchableOpacity>
        }
      />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={MUTED} />
        }>

        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={MUTED} />
          </View>
        ) : grouped.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No providers saved yet. They surface automatically when service signals arrive.
            </Text>
          </View>
        ) : (
          grouped.map((section) => (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionHeader}>{section.label.toUpperCase()}</Text>
              <View style={styles.sectionLine} />
              {section.items.map((p) => (
                <View key={p._key || p.name} style={styles.providerCard}>
                  <Text style={styles.providerEmoji}>{section.emoji}</Text>
                  <View style={styles.providerBody}>
                    <Text style={styles.providerName}>{p.name || 'Unknown'}</Text>
                    {p.phone ? (
                      <TouchableOpacity onPress={() => callProvider(p.phone)} activeOpacity={0.6}>
                        <Text style={styles.providerPhone}>{p.phone}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {formatLastUsed(p) ? (
                      <Text style={styles.providerMeta}>Last used {formatLastUsed(p)}</Text>
                    ) : null}
                    {p.estimateAmount != null ? (
                      <Text style={styles.providerMeta}>Estimate ${p.estimateAmount}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <AddProviderModal
        visible={addModalVisible}
        onClose={() => setAddModalVisible(false)}
        onAdded={(p) => {
          setProviders((prev) => [p, ...prev]);
          setAddModalVisible(false);
        }}
      />
    </View>
  );
}

function AddProviderModal({
  visible, onClose, onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  onAdded: (p: Provider) => void;
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const MUTED = theme.muted;
  const [serviceType, setServiceType] = useState('hvac');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setServiceType('hvac');
    setName('');
    setPhone('');
    setEmail('');
    setNotes('');
    setSaving(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function save() {
    if (name.trim().length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          name: name.trim(),
          serviceType,
          phone: phone.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.provider) onAdded(data.provider);
        reset();
      }
    } catch { /* best-effort */ } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.modalBackdrop} onPress={close}>
        <SwipeDismissSheet style={styles.sheet} onClose={close}>
          <Pressable onPress={() => {}}>
          <Text style={styles.sheetTitle}>Add Provider</Text>
          <Text style={styles.sectionHeader}>SERVICE TYPE</Text>
          <View style={styles.typeGrid}>
            {SERVICE_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                onPress={() => setServiceType(t.key)}
                style={[styles.typeTile, serviceType === t.key && styles.typeTileActive]}
                activeOpacity={0.6}>
                <Text style={styles.typeTileEmoji}>{t.emoji}</Text>
                <Text style={styles.typeTileLabel}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput value={name} onChangeText={setName} placeholder="Name"
            placeholderTextColor={MUTED} style={styles.input}
            autoCapitalize="words" autoCorrect={false}
            autoComplete="name" textContentType="organizationName" />
          <TextInput value={phone} onChangeText={setPhone} placeholder="Phone (optional)"
            placeholderTextColor={MUTED} style={styles.input} keyboardType="phone-pad"
            autoComplete="tel" textContentType="telephoneNumber" />
          <TextInput value={email} onChangeText={setEmail} placeholder="Email (optional)"
            placeholderTextColor={MUTED} style={styles.input} keyboardType="email-address" autoCapitalize="none"
            autoComplete="email" textContentType="emailAddress" autoCorrect={false} />
          <TextInput value={notes} onChangeText={setNotes} placeholder="Notes (optional)"
            placeholderTextColor={MUTED} style={[styles.input, { minHeight: 60 }]} multiline />
          <View style={styles.sheetActions}>
            <TouchableOpacity onPress={close} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={save}
              disabled={saving || name.trim().length === 0}
              style={[styles.saveBtn, (saving || name.trim().length === 0) && { opacity: 0.4 }]}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Provider'}</Text>
            </TouchableOpacity>
          </View>
          </Pressable>
        </SwipeDismissSheet>
      </Pressable>
    </Modal>
  );
}

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: 24, paddingTop: 4, paddingBottom: 60 },
    topBack: {
      alignSelf: 'flex-start',
      paddingVertical: 6,
      paddingHorizontal: 4,
      marginBottom: 8,
    },
    topBackText: { color: theme.muted, fontSize: 13, letterSpacing: 0.3 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    title: { color: theme.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 6 },
    subtitle: { color: theme.muted, fontSize: 13, letterSpacing: 0.2 },
    addLink: { color: accentColor, fontSize: 14, fontWeight: '600', marginTop: 10 },
    section: { marginBottom: 24 },
    sectionHeader: {
      color: accentColor,
      fontSize: 10,
      letterSpacing: 3,
      fontWeight: '600',
      marginBottom: 6,
    },
    sectionLine: { height: 1, backgroundColor: 'rgba(184, 150, 12, 0.25)', marginBottom: 8 },
    providerCard: {
      flexDirection: 'row',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: SOFT_BORDER,
      gap: 12,
    },
    providerEmoji: { fontSize: 22, lineHeight: 26, width: 28 },
    providerBody: { flex: 1, gap: 3 },
    providerName: { color: theme.text, fontSize: 15, fontWeight: '600' },
    providerPhone: { color: accentColor, fontSize: 12, letterSpacing: 0.3 },
    providerMeta: { color: theme.muted, fontSize: 11, letterSpacing: 0.3 },
    empty: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 16 },
    emptyText: { color: theme.muted, fontSize: 13, letterSpacing: 0.3, textAlign: 'center' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 24,
      paddingBottom: 36,
      gap: 12,
      maxHeight: '90%',
    },
    sheetTitle: { color: theme.text, fontSize: 18, fontWeight: '600', letterSpacing: 0.3, marginBottom: 4 },
    typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    typeTile: {
      width: '30%',
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderWidth: 1,
      borderColor: SOFT_BORDER,
      borderRadius: 10,
      alignItems: 'center',
      gap: 4,
    },
    typeTileActive: { borderColor: accentColor, backgroundColor: 'rgba(184, 150, 12, 0.08)' },
    typeTileEmoji: { fontSize: 18 },
    typeTileLabel: { color: theme.text, fontSize: 11 },
    input: {
      color: theme.text,
      fontSize: 14,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderRadius: 8,
    },
    sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 8 },
    cancelBtn: { padding: 8 },
    cancelBtnText: { color: theme.muted, fontSize: 13 },
    saveBtn: { backgroundColor: accentColor, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
    saveBtnText: { color: theme.background, fontSize: 14, fontWeight: '700' },
  });
}
