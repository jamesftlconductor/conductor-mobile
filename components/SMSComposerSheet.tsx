// SMS composer bottom sheet — opened from the Finale "Send text
// update" link. Two-step flow:
//   1. Pick recipient: enter phone number directly (free-form for
//      v1; richer recipient selection coming next pass once crew/
//      network member phone numbers are persisted)
//   2. Edit AI-drafted preview (auto-fetched from
//      /api/twilio?action=draftMessage) + send
//
// On send, POSTs ?action=send with expectReply:true so the
// inbound webhook can route the reply back to the originating
// signal.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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

type Props = {
  visible: boolean;
  userId: string;
  signalId: string | number;
  signalDescription?: string;
  onClose: () => void;
};

export function SMSComposerSheet({
  visible,
  userId,
  signalId,
  signalDescription,
  onClose,
}: Props) {
  const [phone, setPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Auto-fetch the AI draft the first time the sheet opens. The
  // recipient name field stays editable so the user can correct
  // before re-drafting (refresh button below the preview).
  useEffect(() => {
    if (!visible) {
      // Reset state on close so a fresh open doesn't carry stale
      // text from a previous signal.
      setPhone('');
      setRecipientName('');
      setDraft('');
      setSent(false);
      return;
    }
    if (!draft) {
      fetchDraft('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function fetchDraft(name: string) {
    setDrafting(true);
    try {
      const res = await fetch(`${API_BASE}/twilio?action=draftMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, signalId, recipientName: name || null }),
      });
      const data = await res.json();
      if (typeof data?.draft === 'string') setDraft(data.draft);
    } catch {
      // best-effort — fall through to manual entry
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!phone.trim() || !draft.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/twilio?action=send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          to: phone.trim(),
          body: draft,
          signalId,
          expectReply: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        Alert.alert(
          'Could not send',
          data?.error || `Status ${res.status}`
        );
        return;
      }
      setSent(true);
      setTimeout(() => onClose(), 1400);
    } catch (err: any) {
      Alert.alert('Network error', err?.message || String(err));
    } finally {
      setSending(false);
    }
  }

  const charCount = draft.length;
  const charColor = charCount > 160 ? '#d97757' : charCount > 140 ? '#f59e0b' : MUTED;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <SwipeDismissSheet style={styles.sheet} onClose={onClose}>
            <Pressable onPress={() => {}}>
              {sent ? (
                <View style={styles.sentBlock}>
                  <Text style={styles.sentText}>Sent ✓</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.title}>Send text update</Text>
                  {signalDescription ? (
                    <Text style={styles.signalHint} numberOfLines={2}>
                      About: {signalDescription}
                    </Text>
                  ) : null}

                  <Field label="Recipient name (optional)">
                    <TextInput
                      value={recipientName}
                      onChangeText={setRecipientName}
                      onBlur={() => { if (recipientName.trim()) fetchDraft(recipientName.trim()); }}
                      placeholder="e.g. Sarah"
                      placeholderTextColor={MUTED}
                      style={styles.input}
                    />
                  </Field>

                  <Field label="Phone number">
                    <TextInput
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="+1 555 123 4567"
                      placeholderTextColor={MUTED}
                      keyboardType="phone-pad"
                      style={styles.input}
                    />
                  </Field>

                  <View style={styles.previewBlock}>
                    <View style={styles.previewHeaderRow}>
                      <Text style={styles.previewLabel}>MESSAGE</Text>
                      <Text style={[styles.charCount, { color: charColor }]}>
                        {charCount}/160
                      </Text>
                    </View>
                    {drafting ? (
                      <View style={styles.draftingBlock}>
                        <ActivityIndicator color={BRASS} />
                        <Text style={styles.draftingText}>Conductor is drafting…</Text>
                      </View>
                    ) : (
                      <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        multiline
                        style={styles.previewInput}
                      />
                    )}
                  </View>

                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      onPress={onClose}
                      style={styles.secondaryBtn}>
                      <Text style={styles.secondaryBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={send}
                      disabled={sending || !phone.trim() || !draft.trim()}
                      style={[
                        styles.primaryBtn,
                        (sending || !phone.trim() || !draft.trim()) && { opacity: 0.5 },
                      ]}>
                      <Text style={styles.primaryBtnText}>
                        {sending ? 'Sending…' : 'Send'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Pressable>
          </SwipeDismissSheet>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: BG,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 22,
    paddingBottom: 36,
    paddingTop: 4,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
    textAlign: 'center',
  },
  signalHint: {
    color: MUTED,
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 18,
    textAlign: 'center',
  },
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
  previewBlock: { marginTop: 4, marginBottom: 14 },
  previewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  previewLabel: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  charCount: { fontSize: 11, fontWeight: '500' },
  previewInput: {
    color: OFF_WHITE,
    fontSize: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  draftingBlock: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
  },
  draftingText: { color: MUTED, fontSize: 12 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  primaryBtn: {
    flex: 1,
    backgroundColor: BRASS,
    paddingVertical: 12,
    borderRadius: 22,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0f0f0f', fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 22,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
  },
  secondaryBtnText: { color: MUTED, fontSize: 14 },
  sentBlock: { paddingVertical: 60, alignItems: 'center' },
  sentText: { color: BRASS, fontSize: 20, fontWeight: '600', letterSpacing: 1 },
});
