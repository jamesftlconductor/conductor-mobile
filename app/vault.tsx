import { router } from 'expo-router';
import { SecureScreen } from '@/components/SecureScreen';
import { CameraScanner, type ScanResult } from '@/components/CameraScanner';
import { HelpButton } from '@/components/HelpButton';
import { SwipeDismissSheet } from '@/components/SwipeDismissSheet';
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

import { useTheme } from './theme';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const FAINT = '#3a3835';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const SAGE = '#86efac';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type ThemeColors = { background: string; surface: string; text: string; muted: string };

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

function urgencyColor(days: number | null, mutedColor: string, accentColor: string): string {
  if (days == null) return mutedColor;
  if (days < 14) return RED;
  if (days <= 60) return AMBER;
  if (days <= 90) return accentColor;
  return mutedColor;
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
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const MUTED = theme.muted;
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
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
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
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const cat = CATEGORY_BY_KEY[backendToDisplay(item.category)];
  const days = daysOut(item.renewalDate);
  const dColor = urgencyColor(days, theme.muted, accentColor);
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
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
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

// 12 most common US household subscriptions. Tap to pre-fill the
// description + amount fields. The user can still edit anything
// after — these are seed values, not authoritative.
const POPULAR_SUBSCRIPTIONS: { emoji: string; name: string; amount: string }[] = [
  { emoji: '🎵', name: 'Spotify', amount: '$11.99' },
  { emoji: '📺', name: 'Netflix', amount: '$15.49' },
  { emoji: '📦', name: 'Amazon Prime', amount: '$14.99' },
  { emoji: '🎬', name: 'Hulu', amount: '$17.99' },
  { emoji: '🎯', name: 'Disney+', amount: '$13.99' },
  { emoji: '📱', name: 'Apple One', amount: '$19.95' },
  { emoji: '🚗', name: 'Uber One', amount: '$9.99' },
  { emoji: '🎮', name: 'Xbox Game Pass', amount: '$14.99' },
  { emoji: '☁️', name: 'iCloud+', amount: '$2.99' },
  { emoji: '🎵', name: 'Apple Music', amount: '$10.99' },
  { emoji: '📰', name: 'New York Times', amount: '$17' },
  { emoji: '💪', name: 'Peloton', amount: '$44' },
];

function PopularSubscriptionsRow({
  onPick,
}: { onPick: (name: string, amount: string) => void }) {
  const { theme } = useTheme();
  const MUTED = theme.muted;
  const OFF_WHITE = theme.text;
  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          color: MUTED,
          fontSize: 9,
          letterSpacing: 2,
          fontWeight: '600',
          marginBottom: 8,
        }}>
        POPULAR SERVICES
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {POPULAR_SUBSCRIPTIONS.map((s) => (
          <TouchableOpacity
            key={s.name}
            onPress={() => onPick(s.name, s.amount)}
            style={{
              paddingVertical: 7,
              paddingHorizontal: 10,
              borderRadius: 14,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: SOFT_BORDER,
              backgroundColor: 'rgba(255,255,255,0.03)',
            }}>
            <Text style={{ color: OFF_WHITE, fontSize: 11 }}>
              {s.emoji} {s.name}{' '}
              <Text style={{ color: MUTED }}>{s.amount}/mo</Text>
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ color: MUTED, fontSize: 10, marginTop: 8, fontStyle: 'italic' }}>
        Verify your actual amount and renewal date.
      </Text>
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
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const MUTED = theme.muted;
  const BRASS = accentColor;
  const OFF_WHITE = theme.text;
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

  // Lease state — populated only when category === 'leases'. Subtype
  // picker comes between step 1 and step 2; subtype null means we're
  // still on the subtype picker.
  const [leaseSubtype, setLeaseSubtype] = useState<'residential' | 'vehicle' | null>(null);
  const [leaseAddress, setLeaseAddress] = useState('');
  const [leaseMonthlyRent, setLeaseMonthlyRent] = useState('');
  const [leaseStart, setLeaseStart] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('');
  const [leaseNoticeRequired, setLeaseNoticeRequired] = useState<30 | 60 | 90>(60);
  const [leaseLandlordName, setLeaseLandlordName] = useState('');
  const [leaseLandlordPhone, setLeaseLandlordPhone] = useState('');
  const [leaseAutoRenews, setLeaseAutoRenews] = useState(false);
  // Vehicle-specific
  const [vehMake, setVehMake] = useState('');
  const [vehModel, setVehModel] = useState('');
  const [vehYear, setVehYear] = useState('');
  const [vehMonthlyPayment, setVehMonthlyPayment] = useState('');
  const [vehAnnualMileage, setVehAnnualMileage] = useState('');
  const [vehCurrentMileage, setVehCurrentMileage] = useState('');
  const [vehOverageRate, setVehOverageRate] = useState('');
  const [vehDealerName, setVehDealerName] = useState('');
  const [vehDealerPhone, setVehDealerPhone] = useState('');

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
    setLeaseSubtype(null);
    setLeaseAddress('');
    setLeaseMonthlyRent('');
    setLeaseStart('');
    setLeaseEnd('');
    setLeaseNoticeRequired(60);
    setLeaseLandlordName('');
    setLeaseLandlordPhone('');
    setLeaseAutoRenews(false);
    setVehMake('');
    setVehModel('');
    setVehYear('');
    setVehMonthlyPayment('');
    setVehAnnualMileage('');
    setVehCurrentMileage('');
    setVehOverageRate('');
    setVehDealerName('');
    setVehDealerPhone('');
  }

  // Compute notice deadline from leaseEnd - noticeRequired days.
  const computedNoticeDeadline = (() => {
    if (!leaseEnd) return null;
    const end = new Date(leaseEnd);
    if (isNaN(end.getTime())) return null;
    const d = new Date(end);
    d.setDate(d.getDate() - leaseNoticeRequired);
    return d.toISOString().slice(0, 10);
  })();

  // Project vehicle mileage at lease end. Returns { over: boolean, miles: number }
  // or null when we don't have enough data.
  const vehicleProjection = (() => {
    const allowance = parseFloat(vehAnnualMileage);
    const currentMi = parseFloat(vehCurrentMileage);
    if (!leaseEnd || isNaN(allowance) || isNaN(currentMi)) return null;
    const end = new Date(leaseEnd);
    if (isNaN(end.getTime())) return null;
    // Assume 3-year lease default unless leaseStart provided.
    let yearsTotal = 3;
    if (leaseStart) {
      const start = new Date(leaseStart);
      if (!isNaN(start.getTime())) {
        yearsTotal = (end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      }
    }
    const yearsRemaining = (end.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000);
    const yearsElapsed = Math.max(0.01, yearsTotal - yearsRemaining);
    const milesPerYear = currentMi / yearsElapsed;
    const projectedAtEnd = Math.round(milesPerYear * yearsTotal);
    const allowed = allowance * yearsTotal;
    const overage = projectedAtEnd - allowed;
    return { over: overage > 0, miles: Math.round(Math.abs(overage)), projected: projectedAtEnd };
  })();

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
      case 'leases': return leaseSubtype === 'vehicle' ? 'lease_vehicle' : 'lease_residential';
      default: return 'other';
    }
  }

  async function save() {
    setSaving(true);
    try {
      const isLease = category === 'leases';
      const item: any = {
        category: displayToBackend(category),
        source: 'manual',
        notes: notes.trim() || null,
      };
      if (isLease && leaseSubtype === 'residential') {
        item.description = `Lease — ${leaseAddress || 'residential'}`;
        item.address = leaseAddress.trim() || null;
        item.monthlyRent = parseFloat(leaseMonthlyRent) || null;
        item.amount = leaseMonthlyRent.trim() ? `$${leaseMonthlyRent.trim()}` : null;
        item.leaseStart = leaseStart.trim() || null;
        item.leaseEnd = leaseEnd.trim() || null;
        item.renewalDate = leaseEnd.trim() || null;
        item.noticeRequired = leaseNoticeRequired;
        item.landlordName = leaseLandlordName.trim() || null;
        item.landlordPhone = leaseLandlordPhone.trim() || null;
        item.autoRenews = leaseAutoRenews;
        item.provider = leaseLandlordName.trim() || null;
      } else if (isLease && leaseSubtype === 'vehicle') {
        item.description = `${vehYear} ${vehMake} ${vehModel} lease`.trim();
        item.vehicleMake = vehMake.trim() || null;
        item.vehicleModel = vehModel.trim() || null;
        item.vehicleYear = parseInt(vehYear, 10) || null;
        item.leaseEnd = leaseEnd.trim() || null;
        item.renewalDate = leaseEnd.trim() || null;
        item.monthlyPayment = parseFloat(vehMonthlyPayment) || null;
        item.amount = vehMonthlyPayment.trim() ? `$${vehMonthlyPayment.trim()}` : null;
        item.annualMileageAllowance = parseFloat(vehAnnualMileage) || null;
        item.currentMileageEstimate = parseFloat(vehCurrentMileage) || null;
        item.overageCostPerMile = parseFloat(vehOverageRate.replace(/[^0-9.]/g, '')) || null;
        item.dealerName = vehDealerName.trim() || null;
        item.dealerPhone = vehDealerPhone.trim() || null;
        item.provider = vehDealerName.trim() || null;
      } else {
        if (description.trim().length === 0) {
          setSaving(false);
          return;
        }
        item.description = description.trim();
        item.provider = provider.trim() || null;
        item.renewalDate = renewalDate.trim() || null;
        item.amount = amount.trim() || null;
        item.policyNumber = policyNumber.trim() || null;
      }
      const res = await fetch(`${API_BASE}/signals?type=vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          action: 'add',
          item,
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
        <SwipeDismissSheet style={styles.addSheet} onClose={close}>
          <Pressable onPress={() => {}}>
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
                    onPress={() => {
                      setCategory(c.key);
                      // Leases need a subtype picker between step 1 and step 2.
                      if (c.key === 'leases') {
                        setLeaseSubtype(null);
                      }
                      setStep(2);
                    }}
                    style={[styles.categoryTile, category === c.key && styles.categoryTileActive]}
                    activeOpacity={0.6}>
                    <Text style={styles.categoryTileEmoji}>{c.emoji}</Text>
                    <Text style={styles.categoryTileLabel}>{c.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : step === 2 && category === 'leases' && !leaseSubtype ? (
            <>
              <Text style={styles.addSheetTitle}>Residential or Vehicle?</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  onPress={() => setLeaseSubtype('residential')}
                  style={[styles.categoryTile, { flex: 1 }]}
                  activeOpacity={0.6}>
                  <Text style={styles.categoryTileEmoji}>🏠</Text>
                  <Text style={styles.categoryTileLabel}>Residential</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setLeaseSubtype('vehicle')}
                  style={[styles.categoryTile, { flex: 1 }]}
                  activeOpacity={0.6}>
                  <Text style={styles.categoryTileEmoji}>🚗</Text>
                  <Text style={styles.categoryTileLabel}>Vehicle</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.addStepRow}>
                <TouchableOpacity onPress={() => setStep(1)} style={styles.addStepBack}>
                  <Text style={styles.addStepBackText}>← Back</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : step === 2 && category === 'leases' && leaseSubtype === 'residential' ? (
            <>
              <Text style={styles.addSheetTitle}>Residential lease</Text>
              <TextInput
                value={leaseAddress}
                onChangeText={setLeaseAddress}
                placeholder="Address"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <TextInput
                value={leaseMonthlyRent}
                onChangeText={setLeaseMonthlyRent}
                placeholder="Monthly rent"
                placeholderTextColor={MUTED}
                keyboardType="numeric"
                style={styles.addInput}
              />
              <TextInput
                value={leaseStart}
                onChangeText={setLeaseStart}
                placeholder="Lease start (YYYY-MM-DD)"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <TextInput
                value={leaseEnd}
                onChangeText={setLeaseEnd}
                placeholder="Lease end (YYYY-MM-DD)"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <Text style={{ color: MUTED, fontSize: 11, marginTop: 8, marginBottom: 6, letterSpacing: 1 }}>
                NOTICE REQUIRED
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[30, 60, 90].map((d) => (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setLeaseNoticeRequired(d as 30 | 60 | 90)}
                    style={[
                      {
                        flex: 1, paddingVertical: 10, borderRadius: 20, alignItems: 'center',
                        borderWidth: StyleSheet.hairlineWidth, borderColor: SOFT_BORDER,
                      },
                      leaseNoticeRequired === d && { borderColor: BRASS, backgroundColor: 'rgba(184,150,12,0.08)' },
                    ]}>
                    <Text style={{
                      color: leaseNoticeRequired === d ? BRASS : OFF_WHITE,
                      fontSize: 12,
                      fontWeight: leaseNoticeRequired === d ? '600' : '400',
                    }}>{d} days</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {computedNoticeDeadline ? (
                <View style={{ marginTop: 14, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: BRASS }}>
                  <Text style={{ color: BRASS, fontSize: 12, fontWeight: '500' }}>
                    Notice deadline: {computedNoticeDeadline}
                  </Text>
                  <Text style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>
                    Conductor will surface this in the brief.
                  </Text>
                </View>
              ) : null}
              <TextInput
                value={leaseLandlordName}
                onChangeText={setLeaseLandlordName}
                placeholder="Landlord name (optional)"
                placeholderTextColor={MUTED}
                style={[styles.addInput, { marginTop: 14 }]}
              />
              <TextInput
                value={leaseLandlordPhone}
                onChangeText={setLeaseLandlordPhone}
                placeholder="Landlord phone (optional)"
                placeholderTextColor={MUTED}
                keyboardType="phone-pad"
                style={styles.addInput}
              />
              <TouchableOpacity
                onPress={() => setLeaseAutoRenews((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 4 }}>
                <View style={{
                  width: 18, height: 18, borderRadius: 4, marginRight: 10,
                  borderWidth: 1.5, borderColor: leaseAutoRenews ? BRASS : MUTED,
                  backgroundColor: leaseAutoRenews ? BRASS : 'transparent',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {leaseAutoRenews ? <Text style={{ color: '#0f0f0f', fontSize: 12, fontWeight: '700' }}>✓</Text> : null}
                </View>
                <Text style={{ color: OFF_WHITE, fontSize: 13 }}>Auto-renews</Text>
              </TouchableOpacity>
              <View style={styles.addStepRow}>
                <TouchableOpacity onPress={() => setLeaseSubtype(null)} style={styles.addStepBack}>
                  <Text style={styles.addStepBackText}>← Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={save}
                  disabled={saving || !leaseAddress.trim()}
                  style={[styles.addStepSave, (saving || !leaseAddress.trim()) && { opacity: 0.5 }]}>
                  <Text style={styles.addStepSaveText}>{saving ? 'Saving…' : 'Add to Vault'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : step === 2 && category === 'leases' && leaseSubtype === 'vehicle' ? (
            <>
              <Text style={styles.addSheetTitle}>Vehicle lease</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={vehMake}
                  onChangeText={setVehMake}
                  placeholder="Make"
                  placeholderTextColor={MUTED}
                  style={[styles.addInput, { flex: 1 }]}
                />
                <TextInput
                  value={vehModel}
                  onChangeText={setVehModel}
                  placeholder="Model"
                  placeholderTextColor={MUTED}
                  style={[styles.addInput, { flex: 1 }]}
                />
                <TextInput
                  value={vehYear}
                  onChangeText={setVehYear}
                  placeholder="Year"
                  placeholderTextColor={MUTED}
                  keyboardType="numeric"
                  style={[styles.addInput, { flex: 1 }]}
                />
              </View>
              <TextInput
                value={leaseEnd}
                onChangeText={setLeaseEnd}
                placeholder="Lease end (YYYY-MM-DD)"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              <TextInput
                value={vehMonthlyPayment}
                onChangeText={setVehMonthlyPayment}
                placeholder="Monthly payment"
                placeholderTextColor={MUTED}
                keyboardType="numeric"
                style={styles.addInput}
              />
              <TextInput
                value={vehAnnualMileage}
                onChangeText={setVehAnnualMileage}
                placeholder="Annual mileage allowance"
                placeholderTextColor={MUTED}
                keyboardType="numeric"
                style={styles.addInput}
              />
              <TextInput
                value={vehCurrentMileage}
                onChangeText={setVehCurrentMileage}
                placeholder="Current mileage"
                placeholderTextColor={MUTED}
                keyboardType="numeric"
                style={styles.addInput}
              />
              <TextInput
                value={vehOverageRate}
                onChangeText={setVehOverageRate}
                placeholder="Overage rate ($ per mile)"
                placeholderTextColor={MUTED}
                style={styles.addInput}
              />
              {vehicleProjection ? (
                <View style={{ marginTop: 14, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: BRASS }}>
                  <Text style={{ color: vehicleProjection.over ? BRASS : MUTED, fontSize: 12, fontWeight: '500' }}>
                    At current pace: {vehicleProjection.over ? 'over' : 'under'} by{' '}
                    {vehicleProjection.miles.toLocaleString()} miles
                  </Text>
                  <Text style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>
                    Projected total: {vehicleProjection.projected.toLocaleString()} miles at lease end.
                  </Text>
                </View>
              ) : null}
              <TextInput
                value={vehDealerName}
                onChangeText={setVehDealerName}
                placeholder="Dealer name (optional)"
                placeholderTextColor={MUTED}
                style={[styles.addInput, { marginTop: 14 }]}
              />
              <TextInput
                value={vehDealerPhone}
                onChangeText={setVehDealerPhone}
                placeholder="Dealer phone (optional)"
                placeholderTextColor={MUTED}
                keyboardType="phone-pad"
                style={styles.addInput}
              />
              <View style={styles.addStepRow}>
                <TouchableOpacity onPress={() => setLeaseSubtype(null)} style={styles.addStepBack}>
                  <Text style={styles.addStepBackText}>← Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={save}
                  disabled={saving || !vehMake.trim()}
                  style={[styles.addStepSave, (saving || !vehMake.trim()) && { opacity: 0.5 }]}>
                  <Text style={styles.addStepSaveText}>{saving ? 'Saving…' : 'Add to Vault'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : step === 2 ? (
            <>
              <Text style={styles.addSheetTitle}>Details</Text>
              {category === 'subscriptions' && !description && !provider ? (
                <PopularSubscriptionsRow
                  onPick={(name, amt) => {
                    setDescription(name);
                    setProvider(name);
                    setAmount(amt);
                  }}
                />
              ) : null}
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
        </SwipeDismissSheet>
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

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 80 },
  topBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  topBackText: { color: theme.muted, fontSize: 13, letterSpacing: 0.3 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    color: theme.text,
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
    color: theme.muted,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  sortPillActive: {
    color: theme.background,
    backgroundColor: accentColor,
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
  searchIcon: { fontSize: 14, color: theme.muted },
  searchInput: { flex: 1, color: theme.text, fontSize: 13, padding: 0 },
  section: { marginBottom: 24 },
  sharedSection: {
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  sharedHeader: {
    color: theme.muted,
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
    color: theme.text,
    fontSize: 13,
    lineHeight: 18,
  },
  sharedFromBadge: {
    color: theme.muted,
    fontSize: 9,
    letterSpacing: 0.5,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  sharedMeta: {
    color: theme.muted,
    fontSize: 11,
    marginTop: 4,
  },
  sectionHeader: {
    color: accentColor,
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
  itemDescription: { color: theme.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  itemProvider: { color: theme.muted, fontSize: 12 },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 },
  itemDays: { fontSize: 12, letterSpacing: 0.3 },
  itemAmount: { color: theme.muted, fontSize: 11 },
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
    color: theme.muted,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  inlineInput: {
    color: theme.text,
    fontSize: 13,
    paddingVertical: 4,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
  },
  inlineMultiline: { minHeight: 50 },
  priceHistoryBlock: { gap: 2, marginTop: 4 },
  priceHistoryLine: { color: theme.muted, fontSize: 11, lineHeight: 16 },
  sourceLine: { color: theme.muted, fontSize: 11, fontStyle: 'italic', marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  actionBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  actionHandled: { backgroundColor: accentColor },
  shareNetworkLink: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 4,
  },
  shareNetworkLinkText: {
    color: accentColor,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  actionHandledText: { color: theme.background, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
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
    borderColor: accentColor,
    borderRadius: 10,
  },
  addFooterBtnText: { color: accentColor, fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyStateWrap: { gap: 14, paddingVertical: 20 },
  emptyHeadline: { color: theme.text, fontSize: 16, marginBottom: 8 },
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
  emptyCardTitle: { color: theme.text, fontSize: 14, fontWeight: '600' },
  emptyCardSubtext: { color: theme.muted, fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  addSheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 36,
    gap: 14,
  },
  addSheetTitle: { color: theme.text, fontSize: 18, fontWeight: '600', letterSpacing: 0.3 },
  addSheetSubtext: { color: theme.muted, fontSize: 12 },
  scanLink: {
    alignSelf: 'flex-end',
    paddingVertical: 6,
    marginTop: 4,
    marginBottom: 12,
  },
  scanLinkText: {
    color: accentColor,
    fontSize: 13,
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryTile: {
    width: '47%' as const,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    borderRadius: 12,
    gap: 6,
  },
  categoryTileActive: {
    borderColor: accentColor,
    backgroundColor: 'rgba(184, 150, 12, 0.08)',
  },
  categoryTileEmoji: { fontSize: 22 },
  categoryTileLabel: { color: theme.text, fontSize: 13, fontWeight: '600' },
  addInput: {
    color: theme.text,
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
  addStepBackText: { color: theme.muted, fontSize: 13 },
  addStepNext: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: accentColor,
    borderRadius: 8,
  },
  addStepNextText: { color: theme.background, fontSize: 13, fontWeight: '700' },
  addStepSave: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: accentColor,
    borderRadius: 8,
  },
  addStepSaveText: { color: theme.background, fontSize: 14, fontWeight: '700' },
  });
}
