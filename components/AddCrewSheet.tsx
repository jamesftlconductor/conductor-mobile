// Add-a-crew-member bottom sheet. Three steps in a single sheet:
//   1. Type selector (Child / Pet / Adult)
//   2. Per-type info form (name + type-specific fields)
//   3. Optional photo (PhotoCircle, "Skip for now")
//
// On commit, POSTs to /api/signals?type=crew with action:'add' and
// the assembled member object. On success the parent reloads its
// crew list so the new card lands at the bottom.

import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { SwipeDismissSheet } from './SwipeDismissSheet';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#1a1a1a';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type MemberType = 'child' | 'pet' | 'adult';
type PetSubtype = 'Dog' | 'Cat' | 'Bird' | 'Other';
type Relationship = 'Partner' | 'Parent' | 'Sibling' | 'Other';

type Props = {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onAdded: () => void;
};

export function AddCrewSheet({ visible, userId, onClose, onAdded }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<MemberType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form fields — broad enough to cover all three types.
  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [school, setSchool] = useState('');
  const [grade, setGrade] = useState('');
  const [petType, setPetType] = useState<PetSubtype>('Dog');
  const [breed, setBreed] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('Partner');

  function reset() {
    setStep(1);
    setType(null);
    setName('');
    setBirthday('');
    setSchool('');
    setGrade('');
    setPetType('Dog');
    setBreed('');
    setRelationship('Partner');
  }

  function dismiss() {
    reset();
    onClose();
  }

  function pickType(t: MemberType) {
    setType(t);
    setStep(2);
  }

  async function submit() {
    if (!type || !name.trim()) {
      Alert.alert('Name required', 'Please give your crew member a name.');
      return;
    }
    setSubmitting(true);
    const member: any = {
      memberType: type === 'adult' ? 'extended' : type,
      name: name.trim(),
    };
    if (birthday.trim()) member.birthday = birthday.trim();
    if (type === 'child') {
      if (school.trim()) member.school = { name: school.trim() };
      if (grade.trim()) member.grade = grade.trim();
    } else if (type === 'pet') {
      member.type = petType.toLowerCase();
      if (breed.trim()) member.breed = breed.trim();
    } else if (type === 'adult') {
      member.relationship = relationship.toLowerCase();
    }
    try {
      const res = await fetch(`${API_BASE}/signals?type=crew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: 'add', member }),
      });
      if (res.ok) {
        onAdded();
        dismiss();
      } else {
        const data = await res.json().catch(() => ({}));
        Alert.alert(
          data?.error === 'Crew member already exists' ? 'Already in crew' : 'Could not add',
          data?.error || 'Please try again.'
        );
      }
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={dismiss}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={dismiss}>
          <SwipeDismissSheet style={styles.sheet} onClose={dismiss}>
            <Pressable onPress={() => {}}>
              <ScrollView keyboardShouldPersistTaps="handled">
                {step === 1 ? (
                  <>
                    <Text style={styles.title}>Add to crew</Text>
                    <Text style={styles.subtitle}>Who are you adding?</Text>
                    <View style={styles.typeRow}>
                      {(['child', 'pet', 'adult'] as MemberType[]).map((t) => (
                        <TouchableOpacity
                          key={t}
                          onPress={() => pickType(t)}
                          style={styles.typeCard}
                          activeOpacity={0.7}>
                          <Text style={styles.typeEmoji}>
                            {t === 'child' ? '👶' : t === 'pet' ? '🐾' : '👤'}
                          </Text>
                          <Text style={styles.typeLabel}>
                            {t === 'child' ? 'Child' : t === 'pet' ? 'Pet' : 'Adult'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.formHeader}>
                      <TouchableOpacity onPress={() => setStep(1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Text style={styles.backLink}>← Back</Text>
                      </TouchableOpacity>
                      <Text style={styles.title}>
                        New {type === 'child' ? 'child' : type === 'pet' ? 'pet' : 'adult'}
                      </Text>
                      <View style={{ width: 40 }} />
                    </View>

                    <Field label="Name *" value={name} onChange={setName} placeholder="Required" />
                    <Field label="Birthday" value={birthday} onChange={setBirthday} placeholder="YYYY-MM-DD" />

                    {type === 'child' && (
                      <>
                        <Field label="School" value={school} onChange={setSchool} placeholder="Optional" />
                        <Field label="Grade" value={grade} onChange={setGrade} placeholder="Optional" />
                      </>
                    )}

                    {type === 'pet' && (
                      <>
                        <Segmented
                          label="Type"
                          options={['Dog', 'Cat', 'Bird', 'Other']}
                          value={petType}
                          onChange={(v) => setPetType(v as PetSubtype)}
                        />
                        <Field label="Breed" value={breed} onChange={setBreed} placeholder="Optional" />
                      </>
                    )}

                    {type === 'adult' && (
                      <Segmented
                        label="Relationship"
                        options={['Partner', 'Parent', 'Sibling', 'Other']}
                        value={relationship}
                        onChange={(v) => setRelationship(v as Relationship)}
                      />
                    )}

                    <TouchableOpacity
                      onPress={submit}
                      disabled={submitting || !name.trim()}
                      style={[
                        styles.primaryBtn,
                        (submitting || !name.trim()) && { opacity: 0.5 },
                      ]}
                      activeOpacity={0.7}>
                      {submitting ? (
                        <ActivityIndicator color="#0f0f0f" />
                      ) : (
                        <Text style={styles.primaryBtnText}>Add to Crew</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>
            </Pressable>
          </SwipeDismissSheet>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        style={styles.input}
      />
    </View>
  );
}

function Segmented({
  label, options, value, onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.segRow}>
        {options.map((o) => (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            style={[styles.segOption, value === o && styles.segOptionActive]}>
            <Text style={[styles.segText, value === o && styles.segTextActive]}>{o}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: BG,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 22,
    paddingBottom: 36,
    maxHeight: '85%',
  },
  title: {
    color: OFF_WHITE,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: { color: MUTED, fontSize: 13, marginBottom: 22, textAlign: 'center' },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  typeCard: {
    flex: 1,
    paddingVertical: 22,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  typeEmoji: { fontSize: 30, marginBottom: 8 },
  typeLabel: { color: OFF_WHITE, fontSize: 14, fontWeight: '500' },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  backLink: { color: MUTED, fontSize: 13 },
  field: { marginBottom: 14 },
  fieldLabel: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    color: OFF_WHITE,
    fontSize: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
  },
  segRow: { flexDirection: 'row', gap: 6 },
  segOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
  },
  segOptionActive: { borderColor: BRASS, backgroundColor: 'rgba(184,150,12,0.10)' },
  segText: { color: MUTED, fontSize: 12 },
  segTextActive: { color: BRASS, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: BRASS,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    marginTop: 22,
  },
  primaryBtnText: { color: '#0f0f0f', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
});
