// Life transition onboarding flow.
//
// Three states:
//   1. Type picker (2x3 grid)
//   2. Per-type detail form
//   3. Confirmation screen with link into Vault
//
// On submit, POST /api/transition with the chosen type, date, and any
// optional details. Backend seeds vault + signals + (sometimes) crew,
// flips activeTransition to drive brief tone for 90 days.

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { PulsingCMark } from '@/components/PulsingCMark';
import { ScreenHeader } from '@/components/ScreenHeader';

import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useUserId } from '@/hooks/useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

type TransitionType =
  | 'new_baby'
  | 'new_home'
  | 'divorce'
  | 'health_diagnosis'
  | 'job_change'
  | 'loss';

type Card = {
  type: TransitionType;
  emoji: string;
  label: string;
  blurb: string;
};

const CARDS: Card[] = [
  { type: 'new_baby',         emoji: '🍼', label: 'New Baby',       blurb: 'Conductor will watch the early deadlines' },
  { type: 'new_home',         emoji: '🏠', label: 'New Home',       blurb: 'Move-in checklist and home intelligence' },
  { type: 'divorce',          emoji: '⚖️', label: 'Separation',     blurb: 'Navigate the paperwork with support' },
  { type: 'health_diagnosis', emoji: '💊', label: 'Health News',    blurb: 'Track care and coverage' },
  { type: 'job_change',       emoji: '💼', label: 'Job Change',     blurb: 'Benefits and transition checklist' },
  { type: 'loss',             emoji: '🕊️', label: 'Loss',           blurb: 'The administrative side, handled gently' },
];

type Step = 'pick' | 'form' | 'done';

export default function TransitionScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const BRASS = accentColor;
  const MUTED = theme.muted;
  const OFF_WHITE = theme.text;
  const [step, setStep] = useState<Step>('pick');
  const [type, setType] = useState<TransitionType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state — broad enough to hold every type's fields.
  const [transitionDate, setTransitionDate] = useState('');
  const [babyName, setBabyName] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [address, setAddress] = useState('');
  const [filingDate, setFilingDate] = useState('');
  const [condition, setCondition] = useState('');
  const [prescription, setPrescription] = useState('');
  const [lastDay, setLastDay] = useState('');
  const [newJobStart, setNewJobStart] = useState('');
  const [passingDate, setPassingDate] = useState('');

  function reset() {
    setStep('pick');
    setType(null);
    setTransitionDate('');
    setBabyName('');
    setClosingDate('');
    setAddress('');
    setFilingDate('');
    setCondition('');
    setPrescription('');
    setLastDay('');
    setNewJobStart('');
    setPassingDate('');
  }

  function openForm(t: TransitionType) {
    setType(t);
    setStep('form');
  }

  async function submit() {
    if (!type) return;
    setSubmitting(true);
    // Build per-type payload from form state. Anything missing falls
    // back to defaults server-side (transitionDate → today).
    const details: Record<string, any> = {};
    let dateForServer = transitionDate;
    if (type === 'new_baby') {
      if (babyName.trim()) details.babyName = babyName.trim();
    } else if (type === 'new_home') {
      if (closingDate.trim()) {
        details.closingDate = closingDate.trim();
        dateForServer = dateForServer || closingDate.trim();
      }
      if (address.trim()) details.address = address.trim();
    } else if (type === 'divorce') {
      if (filingDate.trim()) {
        details.filingDate = filingDate.trim();
        dateForServer = dateForServer || filingDate.trim();
      }
    } else if (type === 'health_diagnosis') {
      if (condition.trim()) details.condition = condition.trim();
      if (prescription.trim()) details.prescription = prescription.trim();
    } else if (type === 'job_change') {
      if (lastDay.trim()) {
        details.lastDay = lastDay.trim();
        dateForServer = dateForServer || lastDay.trim();
      }
      if (newJobStart.trim()) details.newJobStart = newJobStart.trim();
    } else if (type === 'loss') {
      if (passingDate.trim()) {
        details.passingDate = passingDate.trim();
        dateForServer = dateForServer || passingDate.trim();
      }
    }
    try {
      const res = await fetch(`${API_BASE}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          transitionType: type,
          transitionDate: dateForServer || undefined,
          details,
        }),
      });
      if (res.ok) {
        setStep('done');
      }
    } catch {
      // best-effort — let the user retry
    } finally {
      setSubmitting(false);
    }
  }

  // ----- Render -----

  if (step === 'done') {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.doneHeader}>Conductor has adjusted.</Text>
        <Text style={styles.doneSub}>
          Check your Vault — we've added what needs attention.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/vault' as never)}
          style={styles.primaryBtn}
          activeOpacity={0.7}>
          <Text style={styles.primaryBtnText}>Go to Vault →</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={reset} style={styles.linkBtn}>
          <Text style={styles.linkText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 'form' && type) {
    const card = CARDS.find((c) => c.type === type);
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScreenHeader title={card?.label || 'Transition'} onBack={reset} />
        <ScrollView contentContainerStyle={styles.formScroll}>
          <Text style={styles.formEmoji}>{card?.emoji}</Text>
          <Text style={styles.formBlurb}>{card?.blurb}</Text>

          {type === 'new_baby' && (
            <>
              <Field label="Baby's name (optional)">
                <TextInput
                  value={babyName}
                  onChangeText={setBabyName}
                  placeholder="e.g. River"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                />
              </Field>
              <Field label="Birth date">
                <TextInput
                  value={transitionDate}
                  onChangeText={setTransitionDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                />
              </Field>
            </>
          )}

          {type === 'new_home' && (
            <>
              <Field label="Closing date">
                <TextInput
                  value={closingDate}
                  onChangeText={setClosingDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                />
              </Field>
              <Field label="Address (optional)">
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  placeholder="123 Main St"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                />
              </Field>
            </>
          )}

          {type === 'divorce' && (
            <Field label="Filing date (optional)">
              <TextInput
                value={filingDate}
                onChangeText={setFilingDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={MUTED}
                style={styles.input}
              />
            </Field>
          )}

          {type === 'health_diagnosis' && (
            <>
              <Field label="Condition name (optional)">
                <TextInput
                  value={condition}
                  onChangeText={setCondition}
                  placeholder="e.g. Type 2 diabetes"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                />
              </Field>
              <Field label="Primary medication (optional)">
                <TextInput
                  value={prescription}
                  onChangeText={setPrescription}
                  placeholder="e.g. Metformin"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                />
              </Field>
            </>
          )}

          {type === 'job_change' && (
            <>
              <Field label="Last day at previous job">
                <TextInput
                  value={lastDay}
                  onChangeText={setLastDay}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                />
              </Field>
              <Field label="Start date at new job (optional)">
                <TextInput
                  value={newJobStart}
                  onChangeText={setNewJobStart}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                />
              </Field>
            </>
          )}

          {type === 'loss' && (
            <Field label="Date of passing (optional)">
              <TextInput
                value={passingDate}
                onChangeText={setPassingDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={MUTED}
                style={styles.input}
              />
            </Field>
          )}

          <TouchableOpacity
            onPress={submit}
            disabled={submitting}
            style={[styles.primaryBtn, submitting && { opacity: 0.5 }]}
            activeOpacity={0.7}>
            {submitting ? (
              <PulsingCMark size={18} />
            ) : (
              <Text style={styles.primaryBtnText}>Let Conductor help</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Default: type picker
  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Something changed."
        subtitle="Tell Conductor what happened — it will adjust."
      />
      <ScrollView contentContainerStyle={styles.pickScroll}>

      <View style={styles.grid}>
        {CARDS.map((card) => (
          <Pressable
            key={card.type}
            onPress={() => openForm(card.type)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
            <Text style={styles.cardEmoji}>{card.emoji}</Text>
            <Text style={styles.cardLabel}>{card.label}</Text>
            <Text style={styles.cardBlurb}>{card.blurb}</Text>
          </Pressable>
        ))}
      </View>
      </ScrollView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

type ThemeColors = {
  background: string;
  surface: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  inputBackground: string;
};

function makeStyles(theme: ThemeColors, accentColor: string) {
  const BG = theme.background;
  const OFF_WHITE = theme.text;
  const MUTED = theme.muted;
  const BRASS = accentColor;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  pickScroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 60 },
  formScroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 80 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, ...TOKENS.type.secondary, letterSpacing: 0.3 },
  title: {
    color: OFF_WHITE,
    ...TOKENS.type.header,
    marginTop: 18,
  },
  subtitle: {
    color: MUTED,
    ...TOKENS.type.secondary,
    marginTop: 8,
    marginBottom: 28,
    lineHeight: 19,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    borderRadius: TOKENS.card.borderRadius,
    padding: TOKENS.card.padding,
    marginBottom: 14,
  },
  cardEmoji: { fontSize: 28, marginBottom: 8 },
  cardLabel: {
    color: OFF_WHITE,
    ...TOKENS.type.subheader,
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 6,
  },
  cardBlurb: {
    color: MUTED,
    ...TOKENS.type.label,
    fontSize: 11,
    fontWeight: '400',
    letterSpacing: 0.1,
    lineHeight: 16,
  },
  formEmoji: { fontSize: 40, marginTop: 16 },
  formTitle: {
    color: OFF_WHITE,
    ...TOKENS.type.header,
    fontSize: 24,
    lineHeight: 30,
    marginTop: 8,
  },
  formBlurb: {
    color: MUTED,
    ...TOKENS.type.secondary,
    marginTop: 4,
    marginBottom: 24,
    lineHeight: 19,
  },
  field: { marginBottom: 16 },
  fieldLabel: {
    color: MUTED,
    ...TOKENS.type.label,
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    color: OFF_WHITE,
    ...TOKENS.type.body,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 44,
    backgroundColor: theme.inputBackground,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  primaryBtn: {
    backgroundColor: BRASS,
    paddingVertical: 14,
    paddingHorizontal: 32,
    minHeight: 44,
    borderRadius: 24,
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  primaryBtnText: {
    color: BG,
    ...TOKENS.type.body,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  linkBtn: { marginTop: 18, padding: 8, minHeight: 44, justifyContent: 'center' },
  linkText: { color: MUTED, ...TOKENS.type.secondary },
  doneHeader: {
    color: OFF_WHITE,
    ...TOKENS.type.header,
    textAlign: 'center',
  },
  doneSub: {
    color: MUTED,
    ...TOKENS.type.body,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 32,
    lineHeight: 21,
  },
  });
}
