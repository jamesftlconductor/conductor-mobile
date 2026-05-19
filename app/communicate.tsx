// Email composer — full screen. Three phases:
//
//   1. Compose intent: pick recipient (with contact match dropdown),
//      pick communication type (contractor_request / network_update /
//      family_summary / general), enter context. Tap "Draft email".
//   2. Review: edit subject + body. Pick channel — "From my email"
//      (Gmail user-from) or "Conductor branded" (Resend). Tap "Send".
//   3. Sent: confirmation, auto-return after 1.6s.
//
// Optional query params from caller:
//   ?recipientName=...&recipientEmail=...&communicationType=...
//   &context=...&signalId=...
// Used by the signal detail screen + contractor handoff to pre-fill
// the composer instead of forcing the user to retype.

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  ActivityIndicator,
  Alert,
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

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const FAINT = '#a8a5a0';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type CommType = 'contractor_request' | 'network_update' | 'family_summary' | 'general';

type Contact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  company?: string | null;
  confidence?: number;
};

const COMM_TYPES: { value: CommType; label: string; hint: string }[] = [
  { value: 'contractor_request', label: 'Contractor', hint: 'Service request' },
  { value: 'network_update', label: 'Family', hint: 'Personal update' },
  { value: 'family_summary', label: 'Summary', hint: 'Weekly digest' },
  { value: 'general', label: 'General', hint: 'Other' },
];

type Phase = 'compose' | 'review' | 'sent';

export default function CommunicateScreen() {
  const params = useLocalSearchParams<{
    recipientName?: string;
    recipientEmail?: string;
    communicationType?: CommType;
    context?: string;
    signalId?: string;
  }>();

  const [phase, setPhase] = useState<Phase>('compose');
  const [recipientName, setRecipientName] = useState(params?.recipientName || '');
  const [recipientEmail, setRecipientEmail] = useState(params?.recipientEmail || '');
  const [commType, setCommType] = useState<CommType>(
    (params?.communicationType as CommType) || 'contractor_request'
  );
  const [context, setContext] = useState(params?.context || '');

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);

  const [via, setVia] = useState<'gmail' | 'resend'>('gmail');
  const [sending, setSending] = useState(false);

  // Contact match — fires on recipientName change with a small debounce.
  const [matches, setMatches] = useState<Contact[]>([]);
  const [showMatches, setShowMatches] = useState(false);
  const matchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryMatches = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) {
      setMatches([]);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/contacts?action=match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, query: q.trim() }),
      });
      const data = await res.json();
      if (Array.isArray(data?.matches)) setMatches(data.matches);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    if (matchTimer.current) clearTimeout(matchTimer.current);
    if (!recipientName) {
      setMatches([]);
      return;
    }
    matchTimer.current = setTimeout(() => queryMatches(recipientName), 240);
    return () => { if (matchTimer.current) clearTimeout(matchTimer.current); };
  }, [recipientName, queryMatches]);

  const canDraft = useMemo(
    () => recipientName.trim().length > 0 && context.trim().length > 0,
    [recipientName, context]
  );

  async function draft() {
    if (!canDraft) return;
    setDrafting(true);
    try {
      const res = await fetch(`${API_BASE}/communicate?action=draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim() || null,
          communicationType: commType,
          context: context.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        Alert.alert('Could not draft', data?.error || `Status ${res.status}`);
        return;
      }
      setSubject(data.subject || '');
      setBody(data.body || '');
      setPhase('review');
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!recipientEmail.trim()) {
      Alert.alert('Recipient email required', 'Add an email address before sending.');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      Alert.alert('Empty draft', 'Subject and body are required.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/communicate?action=send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          recipientEmail: recipientEmail.trim(),
          subject,
          body,
          via,
          signalId: params?.signalId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        Alert.alert('Could not send', data?.error || `Status ${res.status}`);
        return;
      }
      setPhase('sent');
      setTimeout(() => router.back(), 1600);
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setSending(false);
    }
  }

  // ---------- Render ----------

  if (phase === 'sent') {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.sentTitle}>Sent ✓</Text>
        <Text style={styles.sentSub}>
          {via === 'gmail' ? 'Delivered from your inbox.' : 'Delivered through Conductor.'}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader
        title={phase === 'review' ? 'Review' : 'Compose'}
        subtitle={
          phase === 'review'
            ? 'Conductor drafted the email below. Edit anything, then send.'
            : "Tell Conductor who you're writing to and what about — it'll draft the email."
        }
        onBack={() => (phase === 'review' ? setPhase('compose') : router.back())}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled">

        {phase === 'compose' ? (
          <>
            <Field label="Recipient name">
              <TextInput
                value={recipientName}
                onChangeText={setRecipientName}
                onFocus={() => setShowMatches(true)}
                onBlur={() => setTimeout(() => setShowMatches(false), 150)}
                placeholder="e.g. Snyder AC"
                placeholderTextColor={MUTED}
                style={styles.input}
              />
              {showMatches && matches.length > 0 ? (
                <View style={styles.matchList}>
                  {matches.map((m, i) => (
                    <Pressable
                      key={i}
                      onPress={() => {
                        if (m.name) setRecipientName(m.name);
                        if (m.email) setRecipientEmail(m.email);
                        setShowMatches(false);
                        setMatches([]);
                      }}
                      style={({ pressed }) => [
                        styles.matchRow,
                        pressed && { backgroundColor: 'rgba(255,255,255,0.04)' },
                      ]}>
                      <Text style={styles.matchName}>{m.name || '(no name)'}</Text>
                      {m.email ? <Text style={styles.matchMeta}>{m.email}</Text> : null}
                      {!m.email && m.company ? (
                        <Text style={styles.matchMeta}>{m.company}</Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Field>

            <Field label="Recipient email">
              <TextInput
                value={recipientEmail}
                onChangeText={setRecipientEmail}
                placeholder="name@example.com"
                placeholderTextColor={MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
            </Field>

            <Field label="Type">
              <View style={styles.typeRow}>
                {COMM_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    onPress={() => setCommType(t.value)}
                    style={[
                      styles.typePill,
                      commType === t.value && styles.typePillActive,
                    ]}>
                    <Text
                      style={[
                        styles.typePillLabel,
                        commType === t.value && styles.typePillLabelActive,
                      ]}>
                      {t.label}
                    </Text>
                    <Text style={styles.typePillHint}>{t.hint}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>

            <Field label="What's the email about?">
              <TextInput
                value={context}
                onChangeText={setContext}
                placeholder="A few sentences — Conductor will turn it into a proper email."
                placeholderTextColor={MUTED}
                multiline
                style={[styles.input, styles.contextInput]}
              />
            </Field>

            <TouchableOpacity
              onPress={draft}
              disabled={!canDraft || drafting}
              style={[
                styles.primaryBtn,
                (!canDraft || drafting) && { opacity: 0.5 },
              ]}>
              {drafting ? (
                <ActivityIndicator color="#0f0f0f" />
              ) : (
                <Text style={styles.primaryBtnText}>Draft email</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Field label="To">
              <TextInput
                value={recipientEmail}
                onChangeText={setRecipientEmail}
                placeholder="name@example.com"
                placeholderTextColor={MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
            </Field>

            <Field label="Subject">
              <TextInput
                value={subject}
                onChangeText={setSubject}
                style={styles.input}
              />
            </Field>

            <Field label="Body">
              <TextInput
                value={body}
                onChangeText={setBody}
                multiline
                style={[styles.input, styles.bodyInput]}
              />
            </Field>

            <Field label="Send from">
              <View style={styles.viaRow}>
                <ViaCard
                  active={via === 'gmail'}
                  title="My email"
                  subtitle="Arrives from your Gmail address"
                  onPress={() => setVia('gmail')}
                />
                <ViaCard
                  active={via === 'resend'}
                  title="Conductor branded"
                  subtitle="Dark theme, Conductor footer"
                  onPress={() => setVia('resend')}
                />
              </View>
            </Field>

            <TouchableOpacity
              onPress={send}
              disabled={sending}
              style={[styles.primaryBtn, sending && { opacity: 0.5 }]}>
              {sending ? (
                <ActivityIndicator color="#0f0f0f" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  Send {via === 'gmail' ? 'from my email' : 'as Conductor'}
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function ViaCard({
  active, title, subtitle, onPress,
}: { active: boolean; title: string; subtitle: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.viaCard, active && styles.viaCardActive]}>
      <Text style={[styles.viaTitle, active && { color: BRASS }]}>{title}</Text>
      <Text style={styles.viaSub}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 80 },

  topBack: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4 },
  topBackText: { color: MUTED, fontSize: 13, letterSpacing: 0.3 },

  title: {
    color: OFF_WHITE,
    fontSize: 28,
    fontWeight: '300',
    marginTop: 14,
    letterSpacing: 0.2,
  },
  subtitle: { color: MUTED, fontSize: 12, marginTop: 4, marginBottom: 22 },

  field: { marginBottom: 18 },
  fieldLabel: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    color: OFF_WHITE,
    fontSize: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
  },
  contextInput: { minHeight: 110, textAlignVertical: 'top' },
  bodyInput: { minHeight: 220, textAlignVertical: 'top', lineHeight: 20 },

  matchList: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  matchRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: SOFT_BORDER,
  },
  matchName: { color: OFF_WHITE, fontSize: 13 },
  matchMeta: { color: FAINT, fontSize: 11, marginTop: 2 },

  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typePill: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
  },
  typePillActive: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184,150,12,0.08)',
  },
  typePillLabel: { color: OFF_WHITE, fontSize: 13, fontWeight: '500' },
  typePillLabelActive: { color: BRASS },
  typePillHint: { color: MUTED, fontSize: 10, marginTop: 2 },

  primaryBtn: {
    backgroundColor: BRASS,
    paddingVertical: 14,
    borderRadius: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#0f0f0f',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  viaRow: { flexDirection: 'row', gap: 10 },
  viaCard: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  viaCardActive: { borderColor: BRASS, backgroundColor: 'rgba(184,150,12,0.08)' },
  viaTitle: { color: OFF_WHITE, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  viaSub: { color: MUTED, fontSize: 11, lineHeight: 16 },

  sentTitle: { color: BRASS, fontSize: 28, fontWeight: '300', letterSpacing: 1 },
  sentSub: { color: MUTED, fontSize: 12, marginTop: 12 },
});
