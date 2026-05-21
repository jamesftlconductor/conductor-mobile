import { router, useLocalSearchParams } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SwipeDismissSheet } from '@/components/SwipeDismissSheet';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { useTheme } from '@/app/theme';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type PermissionLevel = 'watchful' | 'open' | 'emergency_only';

type ConnectionSummary = {
  signalLoad?: 'clear' | 'light' | 'moderate' | 'heavy';
  urgentCount?: number;
  lastActive?: number | null;
  hasEmergency?: boolean;
  activeSignals?: { description: string; type?: string; eta?: string | null }[];
  upcomingDeadlines?: { description: string; eta: string }[];
};

type Connection = {
  connectedHouseholdId: string;
  permissionLevel: PermissionLevel;
  connectedAt: string;
  connectedBy: string;
  via?: string;
  summary?: ConnectionSummary;
};

const LEVEL_LABEL: Record<PermissionLevel, string> = {
  watchful: 'Watchful',
  open: 'Open',
  emergency_only: 'Emergency only',
};

const LEVEL_HINT: Record<PermissionLevel, string> = {
  watchful: 'They see your signal load and urgent count.',
  open: 'They see active signals and upcoming deadlines.',
  emergency_only: 'They see only whether something urgent is happening.',
};

function loadColor(load: string | undefined, accentColor: string, muted: string): string {
  if (load === 'heavy') return '#d97757';
  if (load === 'moderate') return accentColor;
  if (load === 'light') return '#7a9a6e';
  return muted;
}

export default function NetworkScreen() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const BRASS = accentColor;
  const MUTED = theme.muted;
  const OFF_WHITE = theme.text;
  // shareItemId param — set when the user enters from the Vault
  // "Share with Network →" link. When present, renders a banner at
  // the top inviting them to pick a connection + permission.
  const params = useLocalSearchParams<{ shareItemId?: string }>();
  const shareItemId = params?.shareItemId || null;
  const [sharing, setSharing] = useState(false);
  const [sharePermission, setSharePermission] = useState<'view' | 'edit'>('view');

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [invitePermission, setInvitePermission] = useState<PermissionLevel>('open');
  const [inviteEmail, setInviteEmail] = useState('');
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function shareVaultWith(targetHouseholdId: string) {
    if (!shareItemId) return;
    setSharing(true);
    try {
      const res = await fetch(`${API_BASE}/network?action=share-vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          vaultItemId: shareItemId,
          targetHouseholdId,
          permissionLevel: sharePermission,
        }),
      });
      if (res.ok) {
        Alert.alert('Shared', 'The vault item was shared.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        const data = await res.json().catch(() => ({}));
        Alert.alert('Could not share', data?.error || 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setSharing(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/network?action=status&userId=${USER_ID}`);
      const data = await res.json();
      setConnections(data.connections || []);
    } catch (err) {
      console.warn('[network] load failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  async function generateInvite() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/network?action=invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          inviteEmail: inviteEmail.trim() || null,
          permissionLevel: invitePermission,
        }),
      });
      const data = await res.json();
      if (data.ok && data.inviteUrl) {
        setGeneratedUrl(data.inviteUrl);
        setGeneratedCode(data.code);
      } else {
        Alert.alert('Could not generate invite', data.error || 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setGenerating(false);
    }
  }

  async function shareInvite() {
    if (!generatedUrl) return;
    try {
      await Share.share({
        message: `Connect with my household on Conductor — ${LEVEL_LABEL[invitePermission]}: ${generatedUrl}`,
      });
    } catch {}
  }

  async function disconnect(targetHouseholdId: string) {
    Alert.alert(
      'Disconnect?',
      'This removes the connection on both sides.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/network?action=disconnect`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ userId: USER_ID, targetHouseholdId }),
              });
              load();
            } catch (err: any) {
              Alert.alert('Could not disconnect', err?.message || String(err));
            }
          },
        },
      ]
    );
  }

  function resetInviteModal() {
    setInviteModalVisible(false);
    setGeneratedUrl(null);
    setGeneratedCode(null);
    setInviteEmail('');
    setInvitePermission('open');
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={BRASS} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="The Network"
        rightAction={
          <TouchableOpacity
            onPress={() => setInviteModalVisible(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.inviteBtnText}>+ Invite</Text>
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRASS} />
        }
      >
        <Text style={styles.subtitle}>
          Connected households. Each connection sees only what its permission level allows.
        </Text>

        {shareItemId ? (
          <View style={styles.shareBanner}>
            <Text style={styles.shareBannerTitle}>Share vault item</Text>
            <Text style={styles.shareBannerHint}>
              Pick a permission, then tap a connected household to share with.
            </Text>
            <View style={styles.shareLevelRow}>
              {(['view', 'edit'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setSharePermission(p)}
                  style={[
                    styles.shareLevelPill,
                    sharePermission === p && styles.shareLevelPillActive,
                  ]}>
                  <Text
                    style={[
                      styles.shareLevelPillText,
                      sharePermission === p && styles.shareLevelPillTextActive,
                    ]}>
                    {p}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {connections.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No connections yet</Text>
            <Text style={styles.emptyBody}>
              Invite another household to share awareness — useful for co-parents, family
              caregivers, or close friends who help during travel.
            </Text>
          </View>
        ) : (
          connections.map((c) => {
            const s = c.summary || {};
            const Container: any = shareItemId ? TouchableOpacity : View;
            return (
              <Container
                key={c.connectedHouseholdId}
                style={styles.card}
                activeOpacity={0.7}
                onPress={shareItemId ? () => shareVaultWith(c.connectedHouseholdId) : undefined}
                disabled={sharing}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {c.connectedHouseholdId}
                  </Text>
                  <Text style={styles.cardLevel}>{LEVEL_LABEL[c.permissionLevel]}</Text>
                </View>
                <Text style={styles.cardHint}>{LEVEL_HINT[c.permissionLevel]}</Text>

                {c.permissionLevel === 'emergency_only' ? (
                  <Text
                    style={[
                      styles.cardSummary,
                      { color: s.hasEmergency ? '#d97757' : MUTED },
                    ]}
                  >
                    {s.hasEmergency ? 'Something urgent right now' : 'All clear'}
                  </Text>
                ) : (
                  <View style={styles.summaryRow}>
                    <View
                      style={[
                        styles.loadDot,
                        { backgroundColor: loadColor(s.signalLoad, accentColor, theme.muted) },
                      ]}
                    />
                    <Text style={styles.cardSummary}>
                      {s.signalLoad || 'unknown'} · {s.urgentCount ?? 0} urgent
                    </Text>
                  </View>
                )}

                {c.permissionLevel === 'open' && (s.upcomingDeadlines || []).length > 0 && (
                  <View style={styles.deadlinesBlock}>
                    {(s.upcomingDeadlines || []).slice(0, 3).map((d, i) => (
                      <Text key={i} style={styles.deadlineLine}>
                        • {d.description}
                      </Text>
                    ))}
                  </View>
                )}

                {!shareItemId ? (
                  <Pressable
                    onPress={() => disconnect(c.connectedHouseholdId)}
                    style={styles.disconnectBtn}
                  >
                    <Text style={styles.disconnectText}>Disconnect</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.shareCardHint}>
                    Tap to share with this household →
                  </Text>
                )}
              </Container>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={inviteModalVisible}
        animationType="slide"
        transparent
        onRequestClose={resetInviteModal}
      >
        <View style={styles.modalBackdrop}>
          <SwipeDismissSheet style={styles.modalCard} onClose={resetInviteModal}>
            <Text style={styles.modalTitle}>Invite a household</Text>

            {generatedUrl ? (
              <>
                <Text style={styles.modalHint}>Share this link. Expires in 7 days.</Text>
                <View style={styles.codeBox}>
                  <Text style={styles.codeText} selectable>
                    {generatedUrl}
                  </Text>
                </View>
                <Text style={styles.codeSub}>Code: {generatedCode}</Text>
                <TouchableOpacity onPress={shareInvite} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={resetInviteModal} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.modalLabel}>Permission level</Text>
                {(['watchful', 'open', 'emergency_only'] as PermissionLevel[]).map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setInvitePermission(p)}
                    style={[
                      styles.levelOption,
                      invitePermission === p && styles.levelOptionActive,
                    ]}
                  >
                    <Text style={styles.levelOptionTitle}>{LEVEL_LABEL[p]}</Text>
                    <Text style={styles.levelOptionHint}>{LEVEL_HINT[p]}</Text>
                  </Pressable>
                ))}

                <Text style={styles.modalLabel}>Email (optional)</Text>
                <TextInput
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  placeholder="their@email.com"
                  placeholderTextColor={MUTED}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.input}
                />

                <TouchableOpacity
                  onPress={generateInvite}
                  disabled={generating}
                  style={[styles.primaryBtn, generating && { opacity: 0.5 }]}
                >
                  <Text style={styles.primaryBtnText}>
                    {generating ? 'Generating…' : 'Generate invite'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={resetInviteModal} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </SwipeDismissSheet>
        </View>
      </Modal>
    </View>
  );
}

type ThemeColors = { background: string; surface: string; text: string; muted: string };

function makeStyles(theme: ThemeColors, accentColor: string) {
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  const BRASS = accentColor;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SOFT_BORDER,
  },
  backBtn: { width: 64 },
  backText: { color: BRASS, fontSize: 16, fontWeight: '500' },
  title: { flex: 1, color: OFF_WHITE, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  inviteBtn: { width: 64, alignItems: 'flex-end' },
  inviteBtnText: { color: BRASS, fontSize: 14, fontWeight: '500' },
  scroll: { padding: 18, paddingBottom: 80 },
  subtitle: { color: MUTED, fontSize: 13, marginBottom: 18, lineHeight: 19 },
  shareBanner: {
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(184, 150, 12, 0.45)',
    backgroundColor: 'rgba(184, 150, 12, 0.06)',
    marginBottom: 18,
  },
  shareBannerTitle: {
    color: BRASS,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  shareBannerHint: {
    color: MUTED,
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 17,
  },
  shareLevelRow: { flexDirection: 'row', gap: 8 },
  shareLevelPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
  },
  shareLevelPillActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184, 150, 12, 0.12)',
  },
  shareLevelPillText: { color: MUTED, fontSize: 12, letterSpacing: 0.5 },
  shareLevelPillTextActive: { color: BRASS, fontWeight: '600' },
  shareCardHint: {
    color: BRASS,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 10,
    letterSpacing: 0.3,
  },
  emptyCard: {
    padding: 20,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  emptyTitle: { color: OFF_WHITE, fontSize: 15, fontWeight: '600', marginBottom: 8 },
  emptyBody: { color: MUTED, fontSize: 13, lineHeight: 19 },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  cardTitle: { flex: 1, color: OFF_WHITE, fontSize: 15, fontWeight: '500' },
  cardLevel: {
    color: BRASS,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardHint: { color: MUTED, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  loadDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  cardSummary: { color: OFF_WHITE, fontSize: 13 },
  deadlinesBlock: { marginTop: 8 },
  deadlineLine: { color: MUTED, fontSize: 12, lineHeight: 18 },
  disconnectBtn: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 4 },
  disconnectText: { color: '#d97757', fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 38,
  },
  modalTitle: { color: OFF_WHITE, fontSize: 17, fontWeight: '600', marginBottom: 14 },
  modalLabel: { color: MUTED, fontSize: 12, marginTop: 14, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalHint: { color: MUTED, fontSize: 13, marginBottom: 14 },
  levelOption: {
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    marginBottom: 8,
  },
  levelOptionActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184,150,12,0.08)',
  },
  levelOptionTitle: { color: OFF_WHITE, fontSize: 14, fontWeight: '500', marginBottom: 4 },
  levelOptionHint: { color: MUTED, fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: OFF_WHITE,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    fontSize: 14,
  },
  codeBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 14,
    borderRadius: 10,
    marginBottom: 6,
  },
  codeText: { color: OFF_WHITE, fontSize: 13 },
  codeSub: { color: MUTED, fontSize: 12, marginBottom: 14 },
  primaryBtn: {
    backgroundColor: BRASS,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryBtnText: { color: '#0f0f0f', fontSize: 15, fontWeight: '600' },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  secondaryBtnText: { color: MUTED, fontSize: 14 },
  });
}
