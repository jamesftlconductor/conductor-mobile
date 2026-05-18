import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { AddCrewSheet } from '@/components/AddCrewSheet';
import {
  ActivityIndicator,
  Alert,
  Image,
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

async function pickImageBase64(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== 'granted') {
    Alert.alert('Permission needed', 'Allow photo access to add crew photos.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
    base64: true,
  });
  if (result.canceled || !result.assets?.[0]?.base64) return null;
  return `data:image/jpeg;base64,${result.assets[0].base64}`;
}

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';

const DAY_MS = 24 * 60 * 60 * 1000;

type Activity = { name?: string; schedule?: string; location?: string };
type School = { name?: string; pickupTime?: string };
type Vet = { name?: string; phone?: string };
type UpcomingEvent = { description?: string; date?: string };
type Prescription = { name?: string; pharmacy?: string; phone?: string; refillIntervalDays?: number; lastFilled?: string };
type Doctor = { name?: string; specialty?: string; phone?: string; clinic?: string };

// Bio fields shared across child / pet / member / extended. Added
// in this batch so PATCH ?type=crew can land arbitrary updates per
// member.
type BioFields = {
  photoUrl?: string | null;
  notes?: string | null;
  prescriptions?: Prescription[];
  doctors?: Doctor[];
  signalTypes?: string[];
  senderPatterns?: string[];
  lastGrooming?: string | null;
};

type AttributedSignal = {
  id: string | number;
  description?: string;
  type?: string;
  eta?: string | null;
  state?: string;
  status?: string;
};

type Child = BioFields & {
  memberType: 'child';
  name?: string | null;
  age?: number | null;
  activities?: Activity[];
  school?: School | null;
  upcomingEvents?: UpcomingEvent[];
  birthday?: string | null;
  anniversary?: string | null;
  attributedSignals?: AttributedSignal[];
  attributedSignalCount?: number;
};

type Pet = BioFields & {
  memberType: 'pet';
  name?: string | null;
  type?: 'dog' | 'cat' | 'other' | null;
  breed?: string | null;
  vet?: Vet | null;
  upcomingEvents?: UpcomingEvent[];
  birthday?: string | null;
  anniversary?: string | null;
  attributedSignals?: AttributedSignal[];
  attributedSignalCount?: number;
};

type Member = BioFields & {
  memberType: 'member';
  userId: string;
  name?: string | null;
  fullName?: string | null;
  picture?: string | null;
  email?: string | null;
  joinedAt?: string | null;
  birthday?: string | null;
  anniversary?: string | null;
};

type Extended = BioFields & {
  memberType: 'extended';
  name?: string | null;
  relationship?: string | null;
  associatedChildren?: string[];
  birthday?: string | null;
  anniversary?: string | null;
};

type CrewMember = Child | Pet | Member | Extended;

// Initials fallback when no photo + no Google picture is available.
function initialsFor(name?: string | null): string {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Type emojis pulled from the brief's signal type metadata. Local
// fallback rather than importing signalTypes to keep this island
// self-contained.
const SIGNAL_TYPE_EMOJI: Record<string, string> = {
  package: '📦', delivery: '🚚', food: '🍽', grocery: '🛒',
  service: '🔧', reservation: '🗓', appointment: '📅', travel: '✈️',
  deadline: '⚠️', anticipated: '🔄', unknown: '📍',
};

function SignalChipsRow({
  memberName,
  signals,
  onChanged,
}: {
  memberName: string;
  signals: AttributedSignal[];
  onChanged?: () => void;
}) {
  // Long-press target — when non-null, render a centered popover
  // over the screen with three actions: Done / Snooze / Remove
  // attribution. Tap-outside dismisses. All actions fire-and-forget
  // then trigger a parent reload via onChanged.
  const [target, setTarget] = useState<AttributedSignal | null>(null);
  const [working, setWorking] = useState(false);

  async function patchState(state: 'resolved' | 'snoozed') {
    if (!target) return;
    setWorking(true);
    try {
      await fetch(`${API_BASE}/signals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, state, userId: USER_ID }),
      });
    } catch { /* best-effort */ }
    setWorking(false);
    setTarget(null);
    onChanged?.();
  }

  async function removeAttribution() {
    if (!target) return;
    setWorking(true);
    try {
      await fetch(`${API_BASE}/signals?type=crew-attribution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, signalId: target.id, crewMemberName: null }),
      });
    } catch { /* best-effort */ }
    setWorking(false);
    setTarget(null);
    onChanged?.();
  }

  if (!signals || signals.length === 0) {
    return (
      <View style={styles.signalsBlock}>
        <Text style={styles.bioSectionHeader}>SIGNALS</Text>
        <Text style={styles.signalsEmpty}>
          No signals yet — assign signals to {memberName} from the Finale sheet.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.signalsBlock}>
      <Text style={styles.bioSectionHeader}>SIGNALS</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.signalsScroll}>
        {signals.map((s) => {
          const emoji = SIGNAL_TYPE_EMOJI[s.type || 'unknown'] || '📍';
          const desc = (s.description || '').slice(0, 20)
            + ((s.description || '').length > 20 ? '…' : '');
          return (
            <TouchableOpacity
              key={String(s.id)}
              onPress={async () => {
                try {
                  await AsyncStorage.setItem('hover:focusSignalId', String(s.id));
                } catch { /* best-effort */ }
                router.push('/(tabs)/hover' as never);
              }}
              onLongPress={() => setTarget(s)}
              activeOpacity={0.7}
              style={styles.signalChip}>
              <Text style={styles.signalChipText}>{emoji} {desc}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Modal
        visible={target != null}
        transparent
        animationType="fade"
        onRequestClose={() => setTarget(null)}>
        <Pressable style={styles.chipActionBackdrop} onPress={() => setTarget(null)}>
          <Pressable style={styles.chipActionSheet} onPress={() => {}}>
            <Text style={styles.chipActionHeader} numberOfLines={2}>
              {target?.description || 'Signal'}
            </Text>
            <View style={styles.chipActionRow}>
              <TouchableOpacity
                onPress={() => patchState('resolved')}
                disabled={working}
                style={[styles.chipActionBtn, styles.chipActionDone]}>
                <Text style={styles.chipActionDoneText}>Done ✓</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => patchState('snoozed')}
                disabled={working}
                style={[styles.chipActionBtn, styles.chipActionMuted]}>
                <Text style={styles.chipActionMutedText}>Snooze</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={removeAttribution}
                disabled={working}
                style={[styles.chipActionBtn, styles.chipActionDanger]}>
                <Text style={styles.chipActionDangerText}>Remove from {memberName}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

async function patchCrewField(
  memberName: string,
  memberType: string | undefined,
  updates: Record<string, any>
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/signals?type=crew`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER_ID, memberName, memberType, updates }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function uploadCrewPhoto(
  memberName: string,
  memberType: string | undefined,
  base64: string
): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/signals?type=crew-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: USER_ID,
        crewMemberName: memberName,
        memberType,
        photo: base64,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      Alert.alert('Photo upload failed', data?.error || 'Please try again.');
      return null;
    }
    const data = await res.json();
    return typeof data?.photoUrl === 'string' ? data.photoUrl : null;
  } catch (err: any) {
    Alert.alert('Network error', err?.message || String(err));
    return null;
  }
}

function PhotoCircle({
  photoUrl,
  fallbackPicture,
  name,
  onPress,
}: {
  photoUrl?: string | null;
  fallbackPicture?: string | null;
  name?: string | null;
  onPress: () => void;
}) {
  const src = photoUrl || fallbackPicture || null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.photoCircle}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
      {src ? (
        <Image source={{ uri: src }} style={styles.photoCircleImage} />
      ) : (
        <Text style={styles.photoCircleInitials}>{initialsFor(name)}</Text>
      )}
    </TouchableOpacity>
  );
}

// Auto-save TextInput — commits the trimmed value on blur if it
// differs from the loaded value. Used for the per-member notes
// field at the bottom of every card.
function NotesEditor({
  memberName,
  memberType,
  initial,
}: {
  memberName: string;
  memberType?: string;
  initial?: string | null;
}) {
  const [value, setValue] = useState<string>(initial || '');
  const [saved, setSaved] = useState<string>(initial || '');
  return (
    <View style={styles.notesWrap}>
      <Text style={styles.bioSectionHeader}>NOTES</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        onBlur={async () => {
          const next = value.trim();
          if (next === saved.trim()) return;
          const ok = await patchCrewField(memberName, memberType, {
            notes: next.length > 0 ? next : null,
          });
          if (ok) setSaved(next);
        }}
        placeholder={`Add notes about ${memberName}…`}
        placeholderTextColor={MUTED}
        multiline
        style={styles.notesInput}
      />
    </View>
  );
}

function isWithinNext14Days(dateStr?: string): boolean {
  if (!dateStr) return false;
  const ms = Date.parse(dateStr);
  if (isNaN(ms)) return false;
  const diff = ms - Date.now();
  return diff >= -DAY_MS && diff <= 14 * DAY_MS;
}

function formatEventDate(dateStr?: string): string {
  if (!dateStr) return '';
  const ms = Date.parse(dateStr);
  if (isNaN(ms)) return dateStr;
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// MM-DD anchored helpers — birthdays and anniversaries are stored
// without a year, so we compute days until the NEXT occurrence
// (wrapping to next year if the date has already passed this year).
function daysUntilMMDD(mmDd?: string | null): number | null {
  if (!mmDd || !/^\d{2}-\d{2}$/.test(mmDd)) return null;
  const [mm, dd] = mmDd.split('-').map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let candidate = new Date(now.getFullYear(), mm - 1, dd);
  if (candidate.getTime() < today.getTime()) {
    candidate = new Date(now.getFullYear() + 1, mm - 1, dd);
  }
  return Math.round((candidate.getTime() - today.getTime()) / DAY_MS);
}

function formatMMDD(mmDd?: string | null): string {
  if (!mmDd || !/^\d{2}-\d{2}$/.test(mmDd)) return mmDd || '';
  const [mm, dd] = mmDd.split('-').map(Number);
  return new Date(2000, mm - 1, dd).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}

function CelebrationRow({
  emoji,
  label,
  mmDd,
}: {
  emoji: string;
  label: string;
  mmDd: string;
}) {
  const days = daysUntilMMDD(mmDd);
  const isUpcoming = days != null && days <= 30;
  return (
    <View style={styles.row}>
      <Text style={styles.rowEmoji}>{emoji}</Text>
      <View style={styles.rowBody}>
        <Text style={[styles.rowText, isUpcoming && styles.rowTextBrass]}>
          {label}: {formatMMDD(mmDd)}
        </Text>
        {days === 0 ? (
          <Text style={styles.rowMetaBrass}>Today</Text>
        ) : days === 1 ? (
          <Text style={[styles.rowMeta, styles.rowMetaBrass]}>Tomorrow</Text>
        ) : isUpcoming ? (
          <Text style={[styles.rowMeta, styles.rowMetaBrass]}>in {days} days</Text>
        ) : null}
      </View>
    </View>
  );
}

type EditTarget =
  | { kind: 'member'; targetUserId: string; name: string; birthday: string; anniversary: string }
  | { kind: 'other'; memberType: string; name: string; birthday: string; anniversary: string };

export default function CrewScreen() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCrew, setShowAddCrew] = useState(false);

  // Per-card "···" menu — Edit / Remove / Cancel. Edit currently
  // reuses the existing birthday/anniversary modal (the only edit
  // surface today); Remove confirms then deletes via the new
  // ?action=remove path.
  function openCrewMenu(member: CrewMember) {
    const name = (member as any).name || 'this member';
    Alert.alert(name, undefined, [
      {
        text: `Edit ${name}`,
        onPress: () => {
          if (member.memberType === 'member') return; // already has Edit button
          // Reuse the existing birthday/anniversary edit modal.
          setEditing({
            memberType: member.memberType,
            name: (member as any).name || '',
            birthday: (member as any).birthday || '',
            anniversary: (member as any).anniversary || '',
          });
        },
      },
      {
        text: `Remove ${name}`,
        style: 'destructive',
        onPress: () => {
          Alert.alert(`Remove ${name} from your crew?`, undefined, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: async () => {
                setCrew((prev) => prev.filter((m: any) => m?.name !== (member as any).name));
                try {
                  await fetch(`${API_BASE}/signals?type=crew`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      userId: USER_ID,
                      action: 'remove',
                      memberName: (member as any).name,
                    }),
                  });
                } catch {
                  load(); // restore on failure
                }
              },
            },
          ]);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/signals?type=crew&userId=${USER_ID}`);
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.crew)) setCrew(json.crew);
    } catch {
      // best-effort — leave existing state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetch on screen focus so signed photo URLs stay fresh — they
  // expire 1h after generation. Tab-switching back to Crew always
  // pulls a new batch.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function saveEdit() {
    if (!editing) return;
    // Strict MM-DD validation; treat empty input as null (clears the field).
    const norm = (v: string) => {
      const t = v.trim();
      if (!t) return null;
      if (!/^\d{2}-\d{2}$/.test(t)) return undefined; // signal validation failure
      return t;
    };
    const birthdayVal = norm(editing.birthday);
    const anniversaryVal = norm(editing.anniversary);
    if (birthdayVal === undefined || anniversaryVal === undefined) {
      // Don't dispatch invalid input — leave modal open for correction.
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        userId: USER_ID,
        birthday: birthdayVal,
        anniversary: anniversaryVal,
      };
      if (editing.kind === 'member') {
        body.targetUserId = editing.targetUserId;
      } else {
        body.memberType = editing.memberType;
        body.name = editing.name;
      }
      const res = await fetch(`${API_BASE}/signals?type=crew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditing(null);
        await load();
      }
    } catch {
      // best-effort — modal stays open so the user can retry
    } finally {
      setSaving(false);
    }
  }

  const members = crew.filter((m): m is Member => m.memberType === 'member');
  const children = crew.filter((m): m is Child => m.memberType === 'child');
  const pets = crew.filter((m): m is Pet => m.memberType === 'pet');
  const isEmpty = !loading && members.length === 0 && children.length === 0 && pets.length === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={MUTED}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.topBackText}>← Return</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setShowAddCrew(true)}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.topAddText}>+</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>Crew</Text>
      <Text style={styles.subtitle}>Who Conductor is watching over</Text>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={MUTED} />
        </View>
      )}

      {isEmpty && (
        <Text style={styles.empty}>
          Conductor hasn&apos;t found any crew members yet. They surface as your history is scanned.
        </Text>
      )}

      {members.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Household</Text>
          {members.map((m) => (
            <MemberCard
              key={`member-${m.userId}`}
              member={m}
              onEdit={() =>
                setEditing({
                  kind: 'member',
                  targetUserId: m.userId,
                  name: m.name || m.fullName || 'Member',
                  birthday: m.birthday || '',
                  anniversary: m.anniversary || '',
                })
              }
            />
          ))}
        </>
      )}

      {children.length > 0 && (
        <>
          <Text style={[styles.sectionHeader, members.length > 0 && { marginTop: 32 }]}>
            Children
          </Text>
          {children.map((c, i) => (
            <ChildCard key={`child-${i}`} child={c} onMenu={() => openCrewMenu(c)} onChanged={load} />
          ))}
        </>
      )}

      {pets.length > 0 && (
        <>
          <Text style={[styles.sectionHeader, { marginTop: 32 }]}>Pets</Text>
          {pets.map((p, i) => (
            <PetCard key={`pet-${i}`} pet={p} onMenu={() => openCrewMenu(p)} onChanged={load} />
          ))}
        </>
      )}

      <Modal
        visible={!!editing}
        animationType="fade"
        transparent
        onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditing(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>
              {editing ? `Edit ${editing.name}` : 'Edit'}
            </Text>
            <Text style={styles.modalLabel}>Birthday (MM-DD)</Text>
            <TextInput
              value={editing?.birthday || ''}
              onChangeText={(t) =>
                setEditing((prev) => (prev ? { ...prev, birthday: t } : prev))
              }
              placeholder="05-22"
              placeholderTextColor={MUTED}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              style={styles.modalInput}
            />
            <Text style={[styles.modalLabel, { marginTop: 16 }]}>Anniversary (MM-DD)</Text>
            <TextInput
              value={editing?.anniversary || ''}
              onChangeText={(t) =>
                setEditing((prev) => (prev ? { ...prev, anniversary: t } : prev))
              }
              placeholder="06-08"
              placeholderTextColor={MUTED}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              style={styles.modalInput}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setEditing(null)}
                disabled={saving}
                style={styles.modalCancel}
                activeOpacity={0.6}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveEdit}
                disabled={saving}
                style={styles.modalSave}
                activeOpacity={0.7}>
                <Text style={styles.modalSaveText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <AddCrewSheet
        visible={showAddCrew}
        userId={USER_ID}
        onClose={() => setShowAddCrew(false)}
        onAdded={() => load()}
      />
    </ScrollView>
  );
}

function MemberCard({ member, onEdit }: { member: Member; onEdit: () => void }) {
  const display = member.name || member.fullName || 'Member';
  const joinedLabel = (() => {
    if (!member.joinedAt) return 'Connected';
    const ms = Date.parse(member.joinedAt);
    if (isNaN(ms)) return 'Connected';
    const dateStr = new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `Connected · ${dateStr}`;
  })();
  const [photoUrl, setPhotoUrl] = useState<string | null>(member.photoUrl || null);
  async function onPhotoTap() {
    const b64 = await pickImageBase64();
    if (!b64) return;
    setPhotoUrl(b64);
    const final = await uploadCrewPhoto(display, 'member', b64);
    if (final) setPhotoUrl(final);
  }
  return (
    <View style={styles.card}>
      <View style={styles.memberHeader}>
        <PhotoCircle
          photoUrl={photoUrl}
          fallbackPicture={member.picture}
          name={display}
          onPress={onPhotoTap}
        />
        <View style={styles.memberHeaderBody}>
          <Text style={styles.cardName}>{display}</Text>
          <Text style={styles.memberConnected}>{joinedLabel}</Text>
        </View>
        <TouchableOpacity onPress={onEdit} activeOpacity={0.6} style={styles.editLink}>
          <Text style={styles.editLinkText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {member.birthday ? (
        <CelebrationRow emoji="🎂" label="Birthday" mmDd={member.birthday} />
      ) : null}
      {member.anniversary ? (
        <CelebrationRow emoji="💍" label="Anniversary" mmDd={member.anniversary} />
      ) : null}

      <NotesEditor memberName={display} memberType="member" initial={member.notes} />
    </View>
  );
}

function ChildCard({ child, onMenu, onChanged }: { child: Child; onMenu?: () => void; onChanged?: () => void }) {
  const name = child.name || 'Child';
  const activities = (child.activities || []).filter((a) => a && a.name);
  const events = (child.upcomingEvents || []).filter((e) => e && e.description);
  const [photoUrl, setPhotoUrl] = useState<string | null>(child.photoUrl || null);
  async function onPhotoTap() {
    const b64 = await pickImageBase64();
    if (!b64) return;
    setPhotoUrl(b64); // optimistic
    const final = await uploadCrewPhoto(name, 'child', b64);
    if (final) setPhotoUrl(final);
  }
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <PhotoCircle photoUrl={photoUrl} name={name} onPress={onPhotoTap} />
        <View style={styles.cardNameWrap}>
          <Text style={styles.cardName}>{name}</Text>
          {typeof child.age === 'number' ? (
            <Text style={styles.cardAge}>age {child.age}</Text>
          ) : null}
        </View>
        {onMenu ? (
          <TouchableOpacity onPress={onMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.cardMenuDots}>···</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {activities.map((a, i) => (
        <View key={`act-${i}`} style={styles.row}>
          <Text style={styles.rowEmoji}>🏃</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowText}>{a.name}</Text>
            {a.schedule ? <Text style={styles.rowMeta}>{a.schedule}</Text> : null}
            {a.location ? <Text style={styles.rowMeta}>{a.location}</Text> : null}
          </View>
        </View>
      ))}

      {child.school && child.school.name ? (
        <View style={styles.row}>
          <Text style={styles.rowEmoji}>🏫</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowText}>{child.school.name}</Text>
            {child.school.pickupTime ? (
              <Text style={styles.rowMeta}>Pickup {child.school.pickupTime}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {child.birthday ? (
        <CelebrationRow emoji="🎂" label="Birthday" mmDd={child.birthday} />
      ) : null}
      {child.anniversary ? (
        <CelebrationRow emoji="💍" label="Anniversary" mmDd={child.anniversary} />
      ) : null}

      {events.length > 0 ? (
        <View style={styles.eventsBlock}>
          {events.map((e, i) => {
            const soon = isWithinNext14Days(e.date);
            return (
              <View key={`ev-${i}`} style={styles.row}>
                <Text style={styles.rowEmoji}>📅</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{e.description}</Text>
                  {e.date ? (
                    <Text style={[styles.rowMeta, soon && styles.rowMetaBrass]}>
                      {formatEventDate(e.date)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      <SignalChipsRow memberName={name} signals={child.attributedSignals || []} onChanged={onChanged} />
      <NotesEditor memberName={name} memberType="child" initial={child.notes} />
    </View>
  );
}

function PetCard({ pet, onMenu, onChanged }: { pet: Pet; onMenu?: () => void; onChanged?: () => void }) {
  const name = pet.name || 'Pet';
  const typeLabel =
    pet.type && pet.breed
      ? `${pet.type}, ${pet.breed}`
      : pet.type || pet.breed || '';
  const events = (pet.upcomingEvents || []).filter((e) => e && e.description);
  const [photoUrl, setPhotoUrl] = useState<string | null>(pet.photoUrl || null);
  async function onPhotoTap() {
    const b64 = await pickImageBase64();
    if (!b64) return;
    setPhotoUrl(b64);
    const final = await uploadCrewPhoto(name, 'pet', b64);
    if (final) setPhotoUrl(final);
  }
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <PhotoCircle photoUrl={photoUrl} name={name} onPress={onPhotoTap} />
        <View style={styles.cardNameWrap}>
          <Text style={styles.cardName}>🐾 {name}</Text>
          {typeLabel ? <Text style={styles.cardAge}>{typeLabel}</Text> : null}
        </View>
        {onMenu ? (
          <TouchableOpacity onPress={onMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.cardMenuDots}>···</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {pet.vet && pet.vet.name ? (
        <View style={styles.row}>
          <Text style={styles.rowEmoji}>🩺</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowText}>{pet.vet.name}</Text>
            {pet.vet.phone ? <Text style={styles.rowMeta}>{pet.vet.phone}</Text> : null}
          </View>
        </View>
      ) : null}

      {pet.birthday ? (
        <CelebrationRow emoji="🎂" label="Birthday" mmDd={pet.birthday} />
      ) : null}
      {pet.anniversary ? (
        <CelebrationRow emoji="💍" label="Anniversary" mmDd={pet.anniversary} />
      ) : null}

      {events.length > 0 ? (
        <View style={styles.eventsBlock}>
          {events.map((e, i) => {
            const soon = isWithinNext14Days(e.date);
            return (
              <View key={`ev-${i}`} style={styles.row}>
                <Text style={styles.rowEmoji}>📅</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{e.description}</Text>
                  {e.date ? (
                    <Text style={[styles.rowMeta, soon && styles.rowMetaBrass]}>
                      {formatEventDate(e.date)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      <SignalChipsRow memberName={name} signals={pet.attributedSignals || []} onChanged={onChanged} />
      <NotesEditor memberName={name} memberType="pet" initial={pet.notes} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.3,
    marginTop: 6,
    marginBottom: 28,
  },
  loading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  empty: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  sectionHeader: {
    color: BRASS,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: BRASS,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  cardNameWrap: { flex: 1 },
  cardMenuDots: {
    color: MUTED,
    fontSize: 16,
    letterSpacing: 2,
    paddingHorizontal: 6,
    lineHeight: 18,
  },
  photoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: BRASS,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoCircleImage: { width: '100%', height: '100%' },
  photoCircleInitials: {
    color: BRASS,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  notesWrap: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  notesInput: {
    color: OFF_WHITE,
    fontSize: 13,
    minHeight: 60,
    paddingTop: 8,
  },
  bioSectionHeader: {
    color: MUTED,
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 4,
  },
  signalsBlock: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  signalsEmpty: {
    color: MUTED,
    fontSize: 11,
    fontStyle: 'italic',
    paddingVertical: 6,
  },
  signalsScroll: { paddingVertical: 6, gap: 8 },
  signalChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginRight: 8,
    height: 28,
    justifyContent: 'center',
  },
  signalChipText: { color: OFF_WHITE, fontSize: 12 },
  chipActionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  chipActionSheet: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(184,150,12,0.35)',
    width: '100%',
    maxWidth: 360,
  },
  chipActionHeader: {
    color: OFF_WHITE,
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 14,
    textAlign: 'center',
  },
  chipActionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chipActionBtn: {
    flex: 1,
    minWidth: 80,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipActionDone: {
    borderColor: 'rgba(184,150,12,0.65)',
    backgroundColor: 'rgba(184,150,12,0.10)',
  },
  chipActionDoneText: { color: BRASS, fontSize: 12, fontWeight: '600' },
  chipActionMuted: {
    borderColor: 'rgba(255,255,255,0.10)',
  },
  chipActionMutedText: { color: '#a8a5a0', fontSize: 12, fontWeight: '500' },
  chipActionDanger: {
    borderColor: 'rgba(217,119,87,0.4)',
    backgroundColor: 'rgba(217,119,87,0.06)',
  },
  chipActionDangerText: { color: '#d97757', fontSize: 12 },
  cardName: {
    color: OFF_WHITE,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  cardAge: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  memberAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitials: {
    color: OFF_WHITE,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  memberHeaderBody: {
    flex: 1,
  },
  memberConnected: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  editLink: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  editLinkText: {
    color: BRASS,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalSheet: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  modalTitle: {
    color: OFF_WHITE,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 16,
  },
  modalLabel: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  modalInput: {
    color: OFF_WHITE,
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 6,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 24,
  },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: MUTED,
    fontSize: 14,
    letterSpacing: 0.3,
  },
  modalSave: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BRASS,
  },
  modalSaveText: {
    color: BRASS,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  rowEmoji: {
    fontSize: 16,
    lineHeight: 22,
    width: 20,
    textAlign: 'center',
  },
  rowBody: {
    flex: 1,
  },
  rowText: {
    color: OFF_WHITE,
    fontSize: 14,
    lineHeight: 20,
  },
  rowTextBrass: {
    color: BRASS,
  },
  rowMeta: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  rowMetaBrass: {
    color: BRASS,
  },
  eventsBlock: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  topAddText: {
    color: BRASS,
    fontSize: 22,
    fontWeight: '300',
    paddingHorizontal: 6,
    lineHeight: 26,
  },
});
