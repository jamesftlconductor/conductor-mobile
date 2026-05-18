import { router } from 'expo-router';
import { SecureScreen } from '@/components/SecureScreen';
import { CameraScanner, type ScanResult } from '@/components/CameraScanner';
import { HelpButton } from '@/components/HelpButton';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
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

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const FAINT = '#3a3835';
const BRASS = '#b8960c';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const SAGE = '#86efac';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

const DAY_MS = 24 * 60 * 60 * 1000;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type VaultItem = {
  id: string;
  description?: string;
  provider?: string | null;
  category?: string;
  renewalDate?: string | null;
  amount?: string | number | null;
  consequence?: string | null;
  confidence?: string;
  source?: string;
  policyNumber?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  agentName?: string | null;
  notes?: string | null;
  reminderDate?: string | null;
  priceHistory?: { previous?: string | number | null; current?: string | number | null; detectedAt?: string; txDate?: string | null }[];
  handled?: boolean;
  createdAt?: string;
  foundAt?: number;
  // Set on rows that came in via /api/network?action=share-vault.
  // Read-only by default — mobile UI hides edit/handle affordances
  // unless sharedFrom.permissionLevel === 'edit'.
  isShared?: boolean;
  sharedFrom?: {
    householdId: string;
    householdName: string;
    sharedAt: string;
    originalId?: string;
    permissionLevel?: 'view' | 'edit';
  };
};

type SortKey = 'urgency' | 'category' | 'amount' | 'added';

// Display-category mapping. Backend category enum → user-facing label
// + emoji + section ordering.
type DisplayCategory = { key: string; label: string; emoji: string; order: number };
const DISPLAY_CATEGORIES: DisplayCategory[] = [
  { key: 'protections',   label: 'Protections',   emoji: '🛡',  order: 0 },
  { key: 'subscriptions', label: 'Subscriptions', emoji: '🔄',  order: 1 },
  { key: 'registrations', label: 'Registrations', emoji: '📋',  order: 2 },
  { key: 'leases',        label: 'Leases',        emoji: '🔑',  order: 3 },
  { key: 'warranties',    label: 'Warranties',    emoji: '🔧',  order: 4 },
  { key: 'medical',       label: 'Medical',       emoji: '💊',  order: 5 },
  { key: 'financial',     label: 'Financial',     emoji: '💰',  order: 6 },
  { key: 'home',          label: 'Home',          emoji: '🏠',  order: 7 },
  { key: 'other',         label: 'Other',         emoji: '📌',  order: 8 },
];
const CATEGORY_BY_KEY: Record<string, DisplayCategory> = Object.fromEntries(
  DISPLAY_CATEGORIES.map((c) => [c.key, c])
);

function backendToDisplay(category?: string): string {
  const c = (category || '').toLowerCase();
  if (c === 'insurance') return 'protections';
  if (c === 'subscription' || c === 'membership') return 'subscriptions';
  if (c === 'registration' || c === 'legal') return 'registrations';
  if (c === 'warranty') return 'warranties';
  if (c === 'medical' || c === 'prescription') return 'medical';
  if (c === 'financial') return 'financial';
  if (c === 'lease_residential' || c === 'lease_vehicle' || c === 'lease') return 'leases';
  if (c === 'home') return 'home';
  return 'other';
}

function daysOut(renewalDate?: string | null): number | null {
  if (!renewalDate) return null;
  const ms = Date.parse(renewalDate);
  if (isNaN(ms)) return null;
  return Math.round((ms - Date.now()) / DAY_MS);
}

function urgencyColor(days: number | null): string {
  if (days == null) return MUTED;
  if (days < 14) return RED;
  if (days <= 60) return AMBER;
  if (days <= 90) return BRASS;
  return MUTED;
}

function formatDays(days: number | null): string {
  if (days == null) return 'no date';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `${days}d`;
}

function formatRenewalDate(d?: string | null): string {
  if (!d) return '';
  const ms = Date.parse(d);
  if (isNaN(ms)) return d;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function amountAsString(amount: VaultItem['amount']): string {
  if (amount == null) return '';
  if (typeof amount === 'number') return `$${amount}`;
  return String(amount);
}

// Detect a "recent price change" — any priceHistory entry within the
// last 60 days. Returns the delta string (e.g. "+$3") or null.
function recentPriceDelta(item: VaultItem): string | null {
  const ph = item.priceHistory;
  if (!Array.isArray(ph) || ph.length === 0) return null;
  const SIXTY_DAYS_MS = 60 * DAY_MS;
  const latest = ph[ph.length - 1];
  if (!latest?.detectedAt) return null;
  const ms = Date.parse(latest.detectedAt);
  if (isNaN(ms) || Date.now() - ms > SIXTY_DAYS_MS) return null;
  const parse = (v: unknown): number | null => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const m = v.match(/[\d.]+/);
      return m ? parseFloat(m[0]) : null;
    }
    return null;
  };
  const prev = parse(latest.previous);
  const curr = parse(latest.current);
  if (prev == null || curr == null) return null;
  const diff = curr - prev;
  if (Math.abs(diff) < 0.005) return null;
  const sign = diff > 0 ? '+' : '−';
  return `${sign}$${Math.abs(diff).toFixed(2).replace(/\.00$/, '')}`;
}

export default function VaultScreenSecured() {
  return (
    <SecureScreen screenName="Vault">
      <VaultScreen />
    </SecureScreen>
  );
}

function VaultScreen() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('urgency');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addModalVisible, setAddModalVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      // Server-side sort applied via the ?sort= param; search stays
      // client-side so typing feels instant.
      const res = await fetch(`${API_BASE}/signals?type=vault&userId=${USER_ID}&sort=${sort}`);
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch { /* best-effort */ }
  }, [sort]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  useEffect(() => { load(); }, [sort, load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function toggleExpand(id: string) {
    LayoutAnimation.configureNext({
      duration: 200,
      update: { type: 'easeInEaseOut' },
    });
    setExpandedId((current) => (current === id ? null : id));
  }

  // Partition into household-owned vs shared. Shared items render
  // in a separate section at the bottom with their own muted header
  // and "From: {householdName}" badges. Search filtering applies to
  // both so a query reaches across.
  const { ownedItems, sharedItems } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = q.length === 0
      ? items
      : items.filter((v) => {
          const haystack = [v.description, v.provider, v.category, v.notes, v.agentName]
            .filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(q);
        });
    return {
      ownedItems: all.filter((v) => !v.isShared),
      sharedItems: all.filter((v) => v.isShared),
    };
  }, [items, search]);

  const grouped = useMemo(() => {
    const byCat: Record<string, VaultItem[]> = {};
    for (const item of ownedItems) {
      const cat = backendToDisplay(item.category);
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(item);
    }
    return DISPLAY_CATEGORIES
      .filter((c) => byCat[c.key] && byCat[c.key].length > 0)
      .map((c) => ({ ...c, items: byCat[c.key] }));
  }, [ownedItems]);

  async function patchItem(itemId: string, updates: Partial<VaultItem>) {
    setItems((prev) => prev.map((v) => (v.id === itemId ? { ...v, ...updates } : v)));
    try {
      await fetch(`${API_BASE}/signals?type=vault`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, itemId, updates }),
      });
    } catch { load(); }
  }

  async function handleHandled(item: VaultItem) {
    setItems((prev) => prev.map((v) => (v.id === item.id ? { ...v, handled: true } : v)));
    try {
      await fetch(`${API_BASE}/signals?type=vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, action: 'handle', id: item.id }),
      });
    } catch { load(); }
  }

  async function handleRemove(item: VaultItem) {
    Alert.alert(
      'Remove from Vault',
      `Permanently remove "${item.description || 'this item'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setItems((prev) => prev.filter((v) => v.id !== item.id));
            try {
              await fetch(`${API_BASE}/signals?type=vault`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: USER_ID, action: 'delete', id: item.id }),
              });
            } catch { load(); }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <HelpButton cardId="vault" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={MUTED} />
        }
        keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.6}
          style={styles.topBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.topBackText}>← Return</Text>
        </TouchableOpacity>

        <View style={styles.headerRow}>
          <Text style={styles.title}>Vault</Text>
          <View style={styles.sortPills}>
            {(['urgency', 'category', 'amount', 'added'] as SortKey[]).map((k) => (
              <TouchableOpacity
                key={k}
                onPress={() => setSort(k)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
                <Text style={[styles.sortPill, sort === k && styles.sortPillActive]}>
                  {k === 'urgency' ? 'Urgent' : k.charAt(0).toUpperCase() + k.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search vault..."
            placeholderTextColor={MUTED}
            style={styles.searchInput}
          />
        </View>

        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={MUTED} />
          </View>
        ) : grouped.length === 0 ? (
          <VaultEmptyState onAddManually={() => setAddModalVisible(true)} />
        ) : (
          grouped.map((section) => (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionHeader}>{section.label.toUpperCase()}</Text>
              <View style={styles.sectionLine} />
              {section.items.map((item) => (
                <VaultItemRow
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => toggleExpand(item.id)}
                  onPatch={(updates) => patchItem(item.id, updates)}
                  onHandled={() => handleHandled(item)}
                  onRemove={() => handleRemove(item)}
                />
              ))}
            </View>
          ))
        )}

        {sharedItems.length > 0 && (
          <View style={styles.sharedSection}>
            <Text style={styles.sharedHeader}>SHARED WITH YOU</Text>
            <View style={styles.sharedLine} />
            {sharedItems.map((item) => (
              <View key={item.id} style={styles.sharedItem}>
                <Text style={styles.sharedDesc} numberOfLines={2}>
                  {item.description || 'Vault item'}
                </Text>
                {item.sharedFrom?.householdName ? (
                  <Text style={styles.sharedFromBadge}>
                    From: {item.sharedFrom.householdName}
                  </Text>
                ) : null}
                {item.renewalDate ? (
                  <Text style={styles.sharedMeta}>
                    {item.renewalDate}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          onPress={() => setAddModalVisible(true)}
          style={styles.addFooterBtn}
          activeOpacity={0.6}>
          <Text style={styles.addFooterBtnText}>+ Add to Vault</Text>
        </TouchableOpacity>
      </ScrollView>

      <AddVaultModal
        visible={addModalVisible}
        onClose={() => setAddModalVisible(false)}
        onAdded={(item) => {
          setItems((prev) => [item, ...prev]);
          setAddModalVisible(false);
        }}
      />
    </View>
  );
}

function VaultEmptyState({ onAddManually }: { onAddManually: () => void }) {
  return (
    <View style={styles.emptyStateWrap}>
      <Text style={styles.emptyHeadline}>Nothing in your Vault yet.</Text>
      <View style={styles.emptyCard}>
        <Text style={styles.emptyCardEmoji}>📧</Text>
        <View style={styles.emptyCardBody}>
          <Text style={styles.emptyCardTitle}>Scan Gmail</Text>
          <Text style={styles.emptyCardSubtext}>Find deadlines in your inbox</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.emptyCard} onPress={onAddManually} activeOpacity={0.6}>
        <Text style={styles.emptyCardEmoji}>✏️</Text>
        <View style={styles.emptyCardBody}>
          <Text style={styles.emptyCardTitle}>Add manually</Text>
          <Text style={styles.emptyCardSubtext}>Add insurance, subscriptions, warranties</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.emptyCard}>
        <Text style={styles.emptyCardEmoji}>⚡</Text>
        <View style={styles.emptyCardBody}>
          <Text style={styles.emptyCardTitle}>Enable financial detection</Text>
          <Text style={styles.emptyCardSubtext}>Auto-detect from transaction emails</Text>
        </View>
      </View>
    </View>
  );
}

function VaultItemRow({
  item, expanded, onToggle, onPatch, onHandled, onRemove,
}: {
  item: VaultItem;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (updates: Partial<VaultItem>) => void;
  onHandled: () => void;
  onRemove: () => void;
}) {
  const cat = CATEGORY_BY_KEY[backendToDisplay(item.category)];
  const days = daysOut(item.renewalDate);
  const dColor = urgencyColor(days);
  const delta = recentPriceDelta(item);
  const isAuto = item.source === 'auto-detected';

  // Inline-edit drafts so each TextInput is controlled until blur. The
  // commit-on-blur pattern matches the work-calendar fix so we don't
  // fire a PATCH per keystroke.
  const [policyDraft, setPolicyDraft] = useState(item.policyNumber || '');
  const [phoneDraft, setPhoneDraft] = useState(item.contactPhone || '');
  const [agentDraft, setAgentDraft] = useState(item.agentName || '');
  const [notesDraft, setNotesDraft] = useState(item.notes || '');

  function commit(field: keyof VaultItem, draft: string) {
    const next = draft.trim();
    const prev = (item[field] as string) || '';
    if (next === prev.trim()) return;
    onPatch({ [field]: next.length > 0 ? next : null });
  }

  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      style={[styles.itemRow, item.handled && { opacity: 0.5 }]}>
      <View style={styles.itemHeaderRow}>
        <Text style={styles.itemEmoji}>{cat?.emoji || '📌'}</Text>
        <View style={styles.itemBody}>
          <Text style={styles.itemDescription} numberOfLines={2}>{item.description || 'Untitled'}</Text>
          {item.provider ? (
            <Text style={styles.itemProvider}>{item.provider}</Text>
          ) : null}
          <View style={styles.itemMetaRow}>
            <Text style={[styles.itemDays, { color: dColor }]}>
              {formatDays(days)}
              {item.renewalDate ? ` · ${formatRenewalDate(item.renewalDate)}` : ''}
            </Text>
            {amountAsString(item.amount) ? (
              <Text style={styles.itemAmount}>{amountAsString(item.amount)}</Text>
            ) : null}
            {isAuto ? <Text style={styles.itemBadgeAuto}>⚡ Auto</Text> : null}
            {delta ? <Text style={styles.itemBadgePrice}>📈 {delta}</Text> : null}
            {item.handled ? <Text style={styles.itemBadgeHandled}>✓</Text> : null}
          </View>
        </View>
      </View>

      {expanded ? (
        <View style={styles.expandedBlock} pointerEvents="auto">
          <InlineField
            label="Policy #"
            value={policyDraft}
            onChange={setPolicyDraft}
            onBlur={() => commit('policyNumber', policyDraft)}
            placeholder="tap to add"
          />
          <InlineField
            label="Phone"
            value={phoneDraft}
            onChange={setPhoneDraft}
            onBlur={() => commit('contactPhone', phoneDraft)}
            placeholder="tap to add"
            keyboardType="phone-pad"
          />
          <InlineField
            label="Agent"
            value={agentDraft}
            onChange={setAgentDraft}
            onBlur={() => commit('agentName', agentDraft)}
            placeholder="tap to add"
          />
          <InlineField
            label="Notes"
            value={notesDraft}
            onChange={setNotesDraft}
            onBlur={() => commit('notes', notesDraft)}
            placeholder="Add notes..."
            multiline
          />
          {Array.isArray(item.priceHistory) && item.priceHistory.length > 0 ? (
            <View style={styles.priceHistoryBlock}>
              {item.priceHistory.slice(-3).map((p, i) => (
                <Text key={i} style={styles.priceHistoryLine}>
                  Was {p.previous ?? '?'} → Now {p.current ?? '?'}
                  {p.detectedAt ? ` (${new Date(p.detectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})` : ''}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={styles.sourceLine}>
            {item.source === 'auto-detected' ? '⚡ Auto-detected from transaction'
              : item.source === 'manual' || item.source === 'user' ? 'Added manually'
              : item.source === 'api' ? 'Added via API'
              : `Found in Gmail${item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`}
          </Text>
          <View style={styles.actionRow}>
            <TouchableOpacity onPress={onHandled} style={[styles.actionBtn, styles.actionHandled]}>
              <Text style={styles.actionHandledText}>Handled</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onRemove} style={styles.actionRemove}>
              <Text style={styles.actionRemoveText}>Remove</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => router.push(`/network?shareItemId=${item.id}` as never)}
            style={styles.shareNetworkLink}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.shareNetworkLinkText}>Share with Network →</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function InlineField({
  label, value, onChange, onBlur, placeholder, multiline, keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'email-address';
}) {
  return (
    <View style={styles.inlineField}>
      <Text style={styles.inlineLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onBlur={onBlur}
        placeholder={placeholder || ''}
        placeholderTextColor={FAINT}
        style={[styles.inlineInput, multiline && styles.inlineMultiline]}
        multiline={multiline}
        keyboardType={keyboardType || 'default'}
      />
    </View>
  );
}

function AddVaultModal({
  visible, onClose, onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  onAdded: (item: VaultItem) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [category, setCategory] = useState<string>('subscriptions');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [amount, setAmount] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Map the scan result's documentType to a category + push extracted
  // fields into the form state. Then advance to step 2 so the user can
  // review and confirm.
  function applyScanResult(r: ScanResult) {
    const t = r.documentType || '';
    const f = r.extractedFields || {};
    if (t === 'insurance_card') setCategory('protections');
    else if (t === 'warranty') setCategory('warranties');
    else if (t === 'vehicle_registration') setCategory('registrations');
    else if (t === 'prescription_label') setCategory('medical');
    else if (t === 'receipt') setCategory('financial');

    const desc = (f.productName || f.policyNumber || f.medicationName || f.merchant || '') as string;
    if (desc) setDescription(desc);
    if (f.provider) setProvider(String(f.provider));
    if (f.brand) setProvider(String(f.brand));
    if (f.pharmacy) setProvider(String(f.pharmacy));
    if (f.merchant) setProvider(String(f.merchant));
    if (f.expiryDate) setRenewalDate(String(f.expiryDate));
    if (f.refillDate) setRenewalDate(String(f.refillDate));
    if (f.date) setRenewalDate(String(f.date));
    if (f.total != null) setAmount(String(f.total));
    if (f.policyNumber) setPolicyNumber(String(f.policyNumber));
    if (f.serialNumber) setPolicyNumber(String(f.serialNumber));
    if (f.memberId) setPolicyNumber(String(f.memberId));
    setStep(2);
  }

  function reset() {
    setStep(1);
    setCategory('subscriptions');
    setDescription('');
    setProvider('');
    setRenewalDate('');
    setAmount('');
    setPolicyNumber('');
    setNotes('');
    setSaving(false);
  }

  function close() {
    reset();
    onClose();
  }

  function displayToBackend(d: string): string {
    switch (d) {
      case 'protections': return 'insurance';
      case 'subscriptions': return 'subscription';
      case 'registrations': return 'registration';
      case 'warranties': return 'warranty';
      case 'medical': return 'medical';
      case 'financial': return 'financial';
      case 'home': return 'home';
      default: return 'other';
    }
  }

  async function save() {
    if (description.trim().length === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/signals?type=vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          action: 'add',
          item: {
            category: displayToBackend(category),
            description: description.trim(),
            provider: provider.trim() || null,
            renewalDate: renewalDate.trim() || null,
            amount: amount.trim() || null,
            policyNumber: policyNumber.trim() || null,
            notes: notes.trim() || null,
            source: 'manual',
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.item) {
        onAdded(data.item);
        reset();
      }
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.modalBackdrop} onPress={close}>
        <Pressable style={styles.addSheet} onPress={() => {}}>
          {step === 1 ? (
            <>
              <Text style={styles.addSheetTitle}>What kind?</Text>
              <TouchableOpacity
                onPress={() => setShowScanner(true)}
                activeOpacity={0.7}
                style={styles.scanLink}>
                <Text style={styles.scanLinkText}>📷  Scan Document →</Text>
              </TouchableOpacity>
              <View style={styles.categoryGrid}>
                {DISPLAY_CATEGORIES.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    onPress={() => { setCategory(c.key); setStep(2); }}
                    style={[styles.categoryTile, category === c.key && styles.categoryTileActive]}
                    activeOpacity={0.6}>
                    <Text style={styles.categoryTileEmoji}>{c.emoji}</Text>
                    <Text style={styles.categoryTileLabel}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : step === 2 ? (
            <>
              <Text style={styles.addSheetTitle}>Details</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Description (e.g. Auto insurance)"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <TextInput
                value={provider}
                onChangeText={setProvider}
                placeholder="Provider (e.g. State Farm)"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <TextInput
                value={renewalDate}
                onChangeText={setRenewalDate}
                placeholder="Renewal date (YYYY-MM-DD)"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="Amount (optional, e.g. $129)"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <View style={styles.addStepRow}>
                <TouchableOpacity onPress={() => setStep(1)} style={styles.addStepBack}>
                  <Text style={styles.addStepBackText}>← Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setStep(3)}
                  disabled={description.trim().length === 0}
                  style={[styles.addStepNext, description.trim().length === 0 && { opacity: 0.4 }]}>
                  <Text style={styles.addStepNextText}>Next →</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.addSheetTitle}>Anything else?</Text>
              <Text style={styles.addSheetSubtext}>
                Optional. You can add these later by tapping the item in your Vault.
              </Text>
              <TextInput
                value={policyNumber}
                onChangeText={setPolicyNumber}
                placeholder="Policy / account number"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Notes"
                placeholderTextColor={MUTED}
                style={[styles.addInput, { minHeight: 70 }]}
                multiline
              />
              <View style={styles.addStepRow}>
                <TouchableOpacity onPress={() => setStep(2)} style={styles.addStepBack}>
                  <Text style={styles.addStepBackText}>← Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={save}
                  disabled={saving}
                  style={[styles.addStepSave, saving && { opacity: 0.5 }]}>
                  <Text style={styles.addStepSaveText}>
                    {saving ? 'Saving…' : 'Add to Vault'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>

      <CameraScanner
        visible={showScanner}
        userId={USER_ID}
        scanType="document"
        onClose={() => setShowScanner(false)}
        onResult={applyScanResult}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 80 },
  topBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  topBackText: { color: MUTED, fontSize: 13, letterSpacing: 0.3 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  sortPills: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    maxWidth: 220,
  },
  sortPill: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  sortPillActive: {
    color: BG,
    backgroundColor: BRASS,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    marginBottom: 20,
  },
  searchIcon: { fontSize: 14, color: MUTED },
  searchInput: { flex: 1, color: OFF_WHITE, fontSize: 13, padding: 0 },
  section: { marginBottom: 24 },
  sharedSection: {
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  sharedHeader: {
    color: '#5a5855',
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
  },
  sharedLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 12,
  },
  sharedItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 10,
  },
  sharedDesc: {
    color: '#f0ede8',
    fontSize: 13,
    lineHeight: 18,
  },
  sharedFromBadge: {
    color: '#5a5855',
    fontSize: 9,
    letterSpacing: 0.5,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  sharedMeta: {
    color: '#5a5855',
    fontSize: 11,
    marginTop: 4,
  },
  sectionHeader: {
    color: BRASS,
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '600',
    marginBottom: 6,
  },
  sectionLine: {
    height: 1,
    backgroundColor: 'rgba(184, 150, 12, 0.25)',
    marginBottom: 8,
  },
  itemRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
  },
  itemHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  itemEmoji: { fontSize: 22, lineHeight: 26, width: 30 },
  itemBody: { flex: 1, gap: 3 },
  itemDescription: { color: OFF_WHITE, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  itemProvider: { color: MUTED, fontSize: 12 },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 },
  itemDays: { fontSize: 12, letterSpacing: 0.3 },
  itemAmount: { color: MUTED, fontSize: 11 },
  itemBadgeAuto: { color: AMBER, fontSize: 9, letterSpacing: 0.5, fontWeight: '600' },
  itemBadgePrice: { color: AMBER, fontSize: 11, fontWeight: '600' },
  itemBadgeHandled: { color: SAGE, fontSize: 14 },
  expandedBlock: {
    paddingTop: 14,
    paddingLeft: 42,
    gap: 10,
  },
  inlineField: { gap: 3 },
  inlineLabel: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  inlineInput: {
    color: OFF_WHITE,
    fontSize: 13,
    paddingVertical: 4,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
  },
  inlineMultiline: { minHeight: 50 },
  priceHistoryBlock: { gap: 2, marginTop: 4 },
  priceHistoryLine: { color: MUTED, fontSize: 11, lineHeight: 16 },
  sourceLine: { color: MUTED, fontSize: 11, fontStyle: 'italic', marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  actionBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  actionHandled: { backgroundColor: BRASS },
  shareNetworkLink: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 4,
  },
  shareNetworkLinkText: {
    color: BRASS,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  actionHandledText: { color: BG, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  actionRemove: { paddingVertical: 8, paddingHorizontal: 14 },
  actionRemoveText: {
    color: RED,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    opacity: 0.7,
  },
  addFooterBtn: {
    marginTop: 24,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BRASS,
    borderRadius: 10,
  },
  addFooterBtnText: { color: BRASS, fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyStateWrap: { gap: 14, paddingVertical: 20 },
  emptyHeadline: { color: OFF_WHITE, fontSize: 16, marginBottom: 8 },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  emptyCardEmoji: { fontSize: 22, width: 32 },
  emptyCardBody: { flex: 1, gap: 2 },
  emptyCardTitle: { color: OFF_WHITE, fontSize: 14, fontWeight: '600' },
  emptyCardSubtext: { color: MUTED, fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  addSheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 36,
    gap: 14,
  },
  addSheetTitle: { color: OFF_WHITE, fontSize: 18, fontWeight: '600', letterSpacing: 0.3 },
  addSheetSubtext: { color: MUTED, fontSize: 12 },
  scanLink: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    marginTop: 4,
    marginBottom: 12,
  },
  scanLinkText: {
    color: BRASS,
    fontSize: 13,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryTile: {
    width: '47%',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    borderRadius: 12,
    gap: 6,
  },
  categoryTileActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184, 150, 12, 0.08)',
  },
  categoryTileEmoji: { fontSize: 22 },
  categoryTileLabel: { color: OFF_WHITE, fontSize: 13, fontWeight: '600' },
  addInput: {
    color: OFF_WHITE,
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
  },
  addStepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  addStepBack: { padding: 6 },
  addStepBackText: { color: MUTED, fontSize: 13 },
  addStepNext: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: BRASS,
    borderRadius: 8,
  },
  addStepNextText: { color: BG, fontSize: 13, fontWeight: '700' },
  addStepSave: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: BRASS,
    borderRadius: 8,
  },
  addStepSaveText: { color: BG, fontSize: 14, fontWeight: '700' },
});
