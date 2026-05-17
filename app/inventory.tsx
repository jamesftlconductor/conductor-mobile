import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const FAINT = '#3a3835';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type Vehicle = {
  make?: string;
  model?: string;
  year?: string;
  mileage?: string;
  lastService?: string;
};

type Appliance = {
  name?: string;
  yearPurchased?: string;
};

type Inventory = {
  roof: { material?: string | null; yearInstalled?: string | null; lastInspected?: string | null };
  hvac: { brand?: string | null; yearInstalled?: string | null; lastServiced?: string | null; filterSize?: string | null };
  waterHeater: { yearInstalled?: string | null; type?: string | null };
  electrical: { panelAmps?: string | null; yearUpdated?: string | null };
  vehicles: Vehicle[];
  appliances: Appliance[];
  homeBuiltYear?: string | null;
  squareFootage?: string | null;
  notes?: string | null;
};

const EMPTY: Inventory = {
  roof: { material: null, yearInstalled: null, lastInspected: null },
  hvac: { brand: null, yearInstalled: null, lastServiced: null, filterSize: null },
  waterHeater: { yearInstalled: null, type: null },
  electrical: { panelAmps: null, yearUpdated: null },
  vehicles: [],
  appliances: [],
  homeBuiltYear: null,
  squareFootage: null,
  notes: null,
};

export default function InventoryScreen() {
  const [inventory, setInventory] = useState<Inventory>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/signals?type=inventory&userId=${USER_ID}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.inventory) setInventory({ ...EMPTY, ...data.inventory });
    } catch { /* best-effort */ }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]));

  // Persist a partial update. Optimistic local merge so the rendered
  // values reflect the new state immediately; server reconciles on
  // next load if the POST fails.
  async function patch(updates: Partial<Inventory>) {
    setInventory((prev) => {
      const merged = { ...prev };
      for (const [k, v] of Object.entries(updates) as [keyof Inventory, any][]) {
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          (merged as any)[k] = v;
        } else {
          (merged as any)[k] = { ...((prev as any)[k] || {}), ...v };
        }
      }
      return merged;
    });
    try {
      await fetch(`${API_BASE}/signals?type=inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, updates }),
      });
    } catch { load(); }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.6}
          style={styles.topBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.topBackText}>← Return</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Home Inventory</Text>
        <Text style={styles.subtitle}>What Conductor knows about your home</Text>

        {loading ? (
          <View style={styles.empty}><ActivityIndicator color={MUTED} /></View>
        ) : (
          <>
            <Section emoji="🏠" label="HOME">
              <Field
                label="Built (year)"
                value={inventory.homeBuiltYear ?? ''}
                onCommit={(v) => patch({ homeBuiltYear: v || null })}
                placeholder="e.g. 1998"
                keyboardType="numeric"
              />
              <Field
                label="Size (sq ft)"
                value={inventory.squareFootage ?? ''}
                onCommit={(v) => patch({ squareFootage: v || null })}
                placeholder="e.g. 2400"
                keyboardType="numeric"
              />
            </Section>

            <Section emoji="🏗" label="ROOF">
              <Segmented
                label="Material"
                options={['tile', 'shingle', 'metal']}
                value={inventory.roof?.material ?? null}
                onChange={(v) => patch({ roof: { material: v } })}
              />
              <Field
                label="Installed (year)"
                value={inventory.roof?.yearInstalled ?? ''}
                onCommit={(v) => patch({ roof: { yearInstalled: v || null } })}
                placeholder="e.g. 2015"
                keyboardType="numeric"
              />
              <Field
                label="Last inspection (date)"
                value={inventory.roof?.lastInspected ?? ''}
                onCommit={(v) => patch({ roof: { lastInspected: v || null } })}
                placeholder="YYYY-MM-DD"
              />
            </Section>

            <Section emoji="❄️" label="HVAC">
              <Field
                label="Brand"
                value={inventory.hvac?.brand ?? ''}
                onCommit={(v) => patch({ hvac: { brand: v || null } })}
                placeholder="e.g. Carrier"
              />
              <Field
                label="Installed (year)"
                value={inventory.hvac?.yearInstalled ?? ''}
                onCommit={(v) => patch({ hvac: { yearInstalled: v || null } })}
                placeholder="e.g. 2018"
                keyboardType="numeric"
              />
              <Field
                label="Last service (date)"
                value={inventory.hvac?.lastServiced ?? ''}
                onCommit={(v) => patch({ hvac: { lastServiced: v || null } })}
                placeholder="YYYY-MM-DD"
              />
              <Field
                label="Filter size"
                value={inventory.hvac?.filterSize ?? ''}
                onCommit={(v) => patch({ hvac: { filterSize: v || null } })}
                placeholder="e.g. 16x25x1"
              />
            </Section>

            <Section emoji="💧" label="WATER HEATER">
              <Segmented
                label="Type"
                options={['tank', 'tankless']}
                value={inventory.waterHeater?.type ?? null}
                onChange={(v) => patch({ waterHeater: { type: v } })}
              />
              <Field
                label="Installed (year)"
                value={inventory.waterHeater?.yearInstalled ?? ''}
                onCommit={(v) => patch({ waterHeater: { yearInstalled: v || null } })}
                placeholder="e.g. 2017"
                keyboardType="numeric"
              />
            </Section>

            <Section emoji="⚡" label="ELECTRICAL">
              <Field
                label="Panel amps"
                value={inventory.electrical?.panelAmps ?? ''}
                onCommit={(v) => patch({ electrical: { panelAmps: v || null } })}
                placeholder="e.g. 200"
                keyboardType="numeric"
              />
              <Field
                label="Updated (year)"
                value={inventory.electrical?.yearUpdated ?? ''}
                onCommit={(v) => patch({ electrical: { yearUpdated: v || null } })}
                placeholder="e.g. 2010"
                keyboardType="numeric"
              />
            </Section>

            <VehiclesSection
              vehicles={inventory.vehicles || []}
              onChange={(vehicles) => patch({ vehicles })}
            />

            <AppliancesSection
              appliances={inventory.appliances || []}
              onChange={(appliances) => patch({ appliances })}
            />

            <Section emoji="📝" label="NOTES">
              <Field
                label="Notes"
                value={inventory.notes ?? ''}
                onCommit={(v) => patch({ notes: v || null })}
                placeholder="Anything else Conductor should know..."
                multiline
              />
            </Section>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ emoji, label, children }: { emoji: string; label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{emoji}  {label}</Text>
      <View style={styles.sectionLine} />
      <View style={{ gap: 12 }}>{children}</View>
    </View>
  );
}

function Field({
  label, value, onCommit, placeholder, multiline, keyboardType,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'phone-pad';
}) {
  const [draft, setDraft] = useState(value);
  // Keep draft in sync when parent updates (after server reconcile or
  // sibling edit). Only resets when the parent value actually differs
  // to avoid clobbering an in-progress edit.
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={() => {
          const next = draft.trim();
          if (next === (value || '').trim()) return;
          onCommit(next);
        }}
        placeholder={placeholder || ''}
        placeholderTextColor={FAINT}
        style={[styles.input, multiline && { minHeight: 60 }]}
        multiline={multiline}
        keyboardType={keyboardType || 'default'}
      />
    </View>
  );
}

function Segmented({
  label, options, value, onChange,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.segmentedRow}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt}
            onPress={() => onChange(value === opt ? null : opt)}
            style={[styles.segmentTile, value === opt && styles.segmentTileActive]}
            activeOpacity={0.6}>
            <Text style={[styles.segmentText, value === opt && styles.segmentTextActive]}>
              {opt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function VehiclesSection({
  vehicles, onChange,
}: {
  vehicles: Vehicle[];
  onChange: (next: Vehicle[]) => void;
}) {
  function updateAt(i: number, patch: Partial<Vehicle>) {
    const next = vehicles.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function addVehicle() { onChange([...vehicles, {}]); }
  function removeAt(i: number) { onChange(vehicles.filter((_, j) => j !== i)); }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeader}>🚗  VEHICLES</Text>
        <TouchableOpacity onPress={addVehicle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.addItemLink}>+ Add</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.sectionLine} />
      {vehicles.length === 0 ? (
        <Text style={styles.emptyInline}>No vehicles added yet.</Text>
      ) : (
        vehicles.map((v, i) => (
          <View key={i} style={styles.subCard}>
            <View style={styles.subCardHeaderRow}>
              <Text style={styles.subCardTitle}>
                {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'New vehicle'}
              </Text>
              <TouchableOpacity onPress={() => removeAt(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.removeLink}>Remove</Text>
              </TouchableOpacity>
            </View>
            <Field label="Make" value={v.make || ''} onCommit={(x) => updateAt(i, { make: x })} placeholder="e.g. Toyota" />
            <Field label="Model" value={v.model || ''} onCommit={(x) => updateAt(i, { model: x })} placeholder="e.g. Camry" />
            <Field label="Year" value={v.year || ''} onCommit={(x) => updateAt(i, { year: x })} placeholder="e.g. 2021" keyboardType="numeric" />
            <Field label="Mileage" value={v.mileage || ''} onCommit={(x) => updateAt(i, { mileage: x })} placeholder="e.g. 42500" keyboardType="numeric" />
            <Field label="Last service" value={v.lastService || ''} onCommit={(x) => updateAt(i, { lastService: x })} placeholder="YYYY-MM-DD" />
          </View>
        ))
      )}
    </View>
  );
}

function AppliancesSection({
  appliances, onChange,
}: {
  appliances: Appliance[];
  onChange: (next: Appliance[]) => void;
}) {
  function updateAt(i: number, patch: Partial<Appliance>) {
    const next = appliances.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function addAppliance() { onChange([...appliances, {}]); }
  function removeAt(i: number) { onChange(appliances.filter((_, j) => j !== i)); }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeader}>📦  APPLIANCES</Text>
        <TouchableOpacity onPress={addAppliance} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.addItemLink}>+ Add</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.sectionLine} />
      {appliances.length === 0 ? (
        <Text style={styles.emptyInline}>No appliances added yet.</Text>
      ) : (
        appliances.map((a, i) => (
          <View key={i} style={styles.subCard}>
            <View style={styles.subCardHeaderRow}>
              <Text style={styles.subCardTitle}>{a.name || 'New appliance'}</Text>
              <TouchableOpacity onPress={() => removeAt(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.removeLink}>Remove</Text>
              </TouchableOpacity>
            </View>
            <Field label="Name" value={a.name || ''} onCommit={(x) => updateAt(i, { name: x })} placeholder="e.g. Refrigerator" />
            <Field label="Year purchased" value={a.yearPurchased || ''} onCommit={(x) => updateAt(i, { yearPurchased: x })} placeholder="e.g. 2020" keyboardType="numeric" />
          </View>
        ))
      )}
    </View>
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
  title: { color: OFF_WHITE, fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { color: MUTED, fontSize: 13, paddingBottom: 24, letterSpacing: 0.2 },
  section: { marginBottom: 24 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionHeader: {
    color: BRASS,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '600',
    marginBottom: 6,
  },
  sectionLine: { height: 1, backgroundColor: 'rgba(184, 150, 12, 0.25)', marginBottom: 12 },
  fieldLabel: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  input: {
    color: OFF_WHITE,
    fontSize: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
  },
  segmentedRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  segmentTile: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: SOFT_BORDER,
    borderRadius: 8,
  },
  segmentTileActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184, 150, 12, 0.08)',
  },
  segmentText: { color: MUTED, fontSize: 13, letterSpacing: 0.3 },
  segmentTextActive: { color: OFF_WHITE, fontWeight: '600' },
  subCard: {
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 10,
    marginBottom: 10,
    gap: 10,
  },
  subCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subCardTitle: { color: OFF_WHITE, fontSize: 14, fontWeight: '600' },
  addItemLink: { color: BRASS, fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  removeLink: { color: MUTED, fontSize: 11, fontStyle: 'italic' },
  emptyInline: { color: MUTED, fontSize: 12, fontStyle: 'italic' },
  empty: { alignItems: 'center', paddingVertical: 60 },
});
