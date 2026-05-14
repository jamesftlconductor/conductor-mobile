import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';

// LayoutAnimation on Android requires explicit opt-in. iOS is on by default.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const SHEET_BG = '#1a1a1a';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';
const RED = '#ef4444';
const AMBER = '#fbbf24';
const SAGE = '#86efac';
const ORANGE = '#f59e0b';

const DAY_MS = 24 * 60 * 60 * 1000;

type VaultItem = {
  id: string;
  category: string;
  description: string;
  provider?: string | null;
  renewalDate?: string | null;
  amount?: string | null;
  consequence?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  policyNumber?: string | null;
  source?: string;
  foundAt?: number;
};

const CATEGORY_EMOJI: Record<string, string> = {
  insurance: '🛡',
  registration: '📋',
  subscription: '🔄',
  lease: '🏠',
  warranty: '🔧',
  medical: '💊',
  financial: '💰',
  legal: '⚖️',
  membership: '🎫',
  other: '📌',
};

// Display sections per spec, plus Memberships at the end so membership-tagged
// items don't fall into Other. Legal merges into Leases & Contracts since the
// spec didn't list it as its own section.
const SECTION_ORDER = [
  'Insurance',
  'Registrations & Licenses',
  'Subscriptions',
  'Leases & Contracts',
  'Warranties',
  'Medical',
  'Financial',
  'Memberships',
  'Other',
];

function sectionFor(category: string | undefined): string {
  switch ((category || '').toLowerCase()) {
    case 'insurance':
      return 'Insurance';
    case 'registration':
      return 'Registrations & Licenses';
    case 'subscription':
      return 'Subscriptions';
    case 'lease':
    case 'legal':
      return 'Leases & Contracts';
    case 'warranty':
      return 'Warranties';
    case 'medical':
      return 'Medical';
    case 'financial':
      return 'Financial';
    case 'membership':
      return 'Memberships';
    default:
      return 'Other';
  }
}

// Days remaining until renewalDate, plus a colour bucket per the spec
// (red <14, amber 14-60, brass 60-90, muted 90+). Past dates fall into red.
function renewalSummary(item: VaultItem): { label: string; color: string } {
  if (!item.renewalDate) return { label: 'no date', color: MUTED };
  const ms = Date.parse(item.renewalDate);
  if (isNaN(ms)) return { label: 'no date', color: MUTED };
  const days = Math.round((ms - Date.now()) / DAY_MS);
  if (days < 0) return { label: `${Math.abs(days)} days overdue`, color: RED };
  const label = `${days} day${days === 1 ? '' : 's'}`;
  if (days < 14) return { label, color: RED };
  if (days < 60) return { label, color: AMBER };
  if (days < 90) return { label, color: BRASS };
  return { label, color: MUTED };
}

function confidenceColor(c: string | undefined): string {
  if (c === 'high') return SAGE;
  if (c === 'medium') return ORANGE;
  return MUTED;
}

const ADD_CATEGORIES: { key: string; label: string }[] = [
  { key: 'insurance', label: 'Insurance' },
  { key: 'registration', label: 'Registration' },
  { key: 'subscription', label: 'Subscription' },
  { key: 'lease', label: 'Lease' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'medical', label: 'Medical' },
  { key: 'financial', label: 'Financial' },
  { key: 'legal', label: 'Legal' },
  { key: 'membership', label: 'Membership' },
  { key: 'other', label: 'Other' },
];

function AddModal({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (item: Partial<VaultItem>) => void;
}) {
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [amount, setAmount] = useState('');

  function reset() {
    setCategory('other');
    setDescription('');
    setProvider('');
    setRenewalDate('');
    setAmount('');
  }

  function submit() {
    if (!description.trim()) return;
    onAdd({
      category,
      description: description.trim(),
      provider: provider.trim() || null,
      renewalDate: renewalDate.trim() || null,
      amount: amount.trim() || null,
      confidence: 'high', // user-entered, treat as confident
    });
    reset();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <Text style={styles.modalHeader}>Add to Vault</Text>

          <Text style={styles.fieldLabel}>Category</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryRow}
            contentContainerStyle={styles.categoryRowContent}>
            {ADD_CATEGORIES.map((c) => {
              const active = category === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  style={[styles.categoryChip, active && styles.categoryChipActive]}
                  activeOpacity={0.7}>
                  <Text style={styles.categoryChipEmoji}>{CATEGORY_EMOJI[c.key]}</Text>
                  <Text style={[styles.categoryChipLabel, active && styles.categoryChipLabelActive]}>
                    {c.label.toLowerCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder="What is this?"
            placeholderTextColor={MUTED}
          />

          <Text style={styles.fieldLabel}>Provider (optional)</Text>
          <TextInput
            style={styles.input}
            value={provider}
            onChangeText={setProvider}
            placeholder="Company or organization"
            placeholderTextColor={MUTED}
          />

          <Text style={styles.fieldLabel}>Renewal date</Text>
          <TextInput
            style={styles.input}
            value={renewalDate}
            onChangeText={setRenewalDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={MUTED}
            autoCapitalize="none"
          />

          <Text style={styles.fieldLabel}>Amount (optional)</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="e.g. $200/year"
            placeholderTextColor={MUTED}
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>Avert</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, !description.trim() && styles.saveBtnDisabled]}
              onPress={submit}
              disabled={!description.trim()}
              activeOpacity={0.7}>
              <Text style={styles.saveBtnText}>Remember</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function VaultScreen() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // Only one item expanded at a time — tapping another collapses the prior.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(id: string) {
    LayoutAnimation.configureNext({
      duration: 200,
      update: { type: 'easeInEaseOut' },
      create: { type: 'easeInEaseOut', property: 'opacity' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/signals?type=vault&userId=${USER_ID}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleHandled(id: string) {
    setItems((prev) => prev.filter((v) => v.id !== id));
    try {
      await fetch(`${API_BASE}/signals?type=vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'handle', id, userId: USER_ID, type: 'vault' }),
      });
    } catch {
      // best-effort; reconcile on next refresh
    }
  }

  async function handleAdd(item: Partial<VaultItem>) {
    setShowAdd(false);
    try {
      const res = await fetch(`${API_BASE}/signals?type=vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', item, userId: USER_ID, type: 'vault' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.item) setItems((prev) => [data.item, ...prev]);
      }
    } catch {
      // best-effort
    }
  }

  const sections = useMemo(() => {
    const grouped: Record<string, VaultItem[]> = {};
    for (const item of items) {
      const sec = sectionFor(item.category);
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push(item);
    }
    return SECTION_ORDER.filter((name) => grouped[name]?.length).map((name) => ({
      name,
      items: grouped[name],
    }));
  }, [items]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={MUTED} />
      }>
      <TouchableOpacity
        onPress={() => router.back()}
        activeOpacity={0.6}
        style={styles.topBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.topBackText}>← Return</Text>
      </TouchableOpacity>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Vault</Text>
          <Text style={styles.subtitle}>What Conductor is watching over</Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.7}>
          <Text style={styles.addBtnText}>+ Signal</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.empty}>
          <ActivityIndicator color={MUTED} />
        </View>
      )}

      {!loading && items.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            The Vault is empty. Renewals and deadlines land here as Conductor finds them.
          </Text>
        </View>
      )}

      {!loading &&
        sections.map((section) => (
          <View key={section.name} style={styles.section}>
            <Text style={styles.sectionHeader}>{section.name}</Text>
            {section.items.map((item) => {
              const renewal = renewalSummary(item);
              const emoji = CATEGORY_EMOJI[item.category] || CATEGORY_EMOJI.other;
              const isExpanded = expandedId === item.id;
              const confLabel = item.confidence
                ? item.confidence[0].toUpperCase() + item.confidence.slice(1) + ' confidence'
                : null;
              return (
                <View key={item.id} style={styles.itemContainer}>
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Text style={styles.emoji}>{emoji}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.rowMain}
                      onPress={() => toggleExpand(item.id)}
                      activeOpacity={0.8}>
                      <View style={styles.descRow}>
                        <Text style={styles.description} numberOfLines={2}>
                          {item.description}
                        </Text>
                        <View
                          style={[
                            styles.confidenceDot,
                            { backgroundColor: confidenceColor(item.confidence) },
                          ]}
                        />
                      </View>
                      {!!item.provider && (
                        <Text style={styles.provider} numberOfLines={1}>
                          {item.provider}
                        </Text>
                      )}
                      <View style={styles.metaRow}>
                        <Text style={[styles.renewal, { color: renewal.color }]}>
                          {renewal.label}
                        </Text>
                        {!!item.amount && (
                          <Text style={styles.amount}> · {item.amount}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.handledBtn}
                      onPress={() => handleHandled(item.id)}
                      activeOpacity={0.7}>
                      <Text style={styles.handledBtnText}>Handled</Text>
                    </TouchableOpacity>
                  </View>
                  {isExpanded && (
                    <View style={styles.expandedSection}>
                      {!!item.consequence && (
                        <Text style={styles.expandedConsequence}>
                          {item.consequence}
                        </Text>
                      )}
                      {!!item.policyNumber && (
                        <Text style={styles.expandedPolicy}>
                          Policy #{item.policyNumber}
                        </Text>
                      )}
                      {!!confLabel && (
                        <View style={styles.expandedConfRow}>
                          <View
                            style={[
                              styles.confidenceDot,
                              { backgroundColor: confidenceColor(item.confidence) },
                            ]}
                          />
                          <Text style={styles.expandedConfText}>{confLabel}</Text>
                        </View>
                      )}
                      {item.source === 'gmail' && (
                        <Text style={styles.expandedSource}>Found in Gmail</Text>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}

      <AddModal visible={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 60 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  addBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRASS,
  },
  addBtnText: {
    color: BRASS,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    color: BRASS,
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
    gap: 12,
  },
  rowLeft: {
    width: 28,
    alignItems: 'center',
    paddingTop: 2,
  },
  emoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  descRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  description: {
    flex: 1,
    color: OFF_WHITE,
    fontSize: 15,
    lineHeight: 20,
  },
  confidenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  provider: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  renewal: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  amount: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  consequence: {
    color: MUTED,
    fontSize: 11,
    fontStyle: 'italic',
    letterSpacing: 0.2,
  },
  itemContainer: {
    // No own background — borders/padding live on the inner row so the
    // expanded section reads as belonging to the same card.
  },
  expandedSection: {
    paddingHorizontal: 40,
    paddingBottom: 14,
    marginTop: -4,
    gap: 6,
  },
  expandedConsequence: {
    color: MUTED,
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 17,
    letterSpacing: 0.2,
  },
  expandedPolicy: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  expandedConfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  expandedConfText: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  expandedSource: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 0.3,
    fontStyle: 'italic',
  },
  handledBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRASS,
    alignSelf: 'center',
  },
  handledBtnText: {
    color: BRASS,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  topBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  topBackText: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.3,
  },

  // Add modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 36,
    maxHeight: '90%',
  },
  modalHeader: {
    color: OFF_WHITE,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: 20,
  },
  fieldLabel: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  categoryRow: {
    maxHeight: 64,
  },
  categoryRowContent: {
    gap: 8,
    paddingRight: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    minWidth: 60,
  },
  categoryChipActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184,150,12,0.12)',
  },
  categoryChipEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  categoryChipLabel: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  categoryChipLabelActive: {
    color: BRASS,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: OFF_WHITE,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 24,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  cancelBtnText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: OFF_WHITE,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    color: BG,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
