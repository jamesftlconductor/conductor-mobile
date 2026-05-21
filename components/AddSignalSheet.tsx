import { useEffect, useRef, useState } from 'react';
import {
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

import { LEGEND_ORDER, Signal, TYPE_META } from './signalTypes';
import { SwipeDismissSheet } from './SwipeDismissSheet';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

type Props = {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onAdded: (signal: Signal) => void;
  // Optional ETA pre-fill — used by the monthly Calendar screen when
  // the user taps "+ Add signal for this date". Resets along with the
  // other fields on each open so re-opening from somewhere else stays
  // clean. Pass YYYY-MM-DD; the input field accepts free text anyway.
  initialEta?: string;
};

export function AddSignalSheet({ visible, userId, onClose, onAdded, initialEta }: Props) {
  const [description, setDescription] = useState('');
  const [typeKey, setTypeKey] = useState<string>('package');
  const [eta, setEta] = useState('');
  const [sender, setSender] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset every time the sheet opens — leftover state from a prior
  // open would be confusing if the user added one signal then opened
  // the sheet again. initialEta seeds the ETA when the sheet is
  // opened from the Calendar screen's day-sheet.
  useEffect(() => {
    if (visible) {
      setDescription('');
      setTypeKey('package');
      setEta(initialEta || '');
      setSender('');
      setSubmitting(false);
    }
  }, [visible, initialEta]);

  const canSubmit = description.trim().length > 0 && !submitting;

  const handleAdd = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const payload = {
      userId,
      description: description.trim(),
      type: typeKey,
      eta: eta.trim() || null,
      sender: sender.trim() || null,
      state: 'incoming',
      source: 'manual',
    };
    try {
      const res = await fetch(`${API_BASE}/signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Fall through — the optimistic insert will still show the
        // signal locally even though the server rejected it. The next
        // refresh will reconcile.
        console.warn('Add signal failed:', res.status);
      }
      const body = await res.json().catch(() => ({}));
      // Prefer the server-returned signal so the id matches what's in
      // Redis. Fall back to a local stub if the server response was
      // malformed.
      const created: Signal =
        body?.signal && typeof body.signal === 'object'
          ? body.signal
          : {
              id: Date.now(),
              description: payload.description,
              type: payload.type,
              eta: payload.eta,
              sender: payload.sender,
              state: payload.state,
            };
      onAdded(created);
      onClose();
    } catch (err) {
      console.warn('Add signal error:', err);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kbWrap}>
        <Pressable style={styles.modalBackdrop} onPress={onClose}>
          <SwipeDismissSheet style={styles.sheet} onClose={onClose}>
            <Pressable onPress={() => {}}>
            <Text style={styles.sheetHeader}>Add Signal</Text>

          <TextInput
            style={styles.descriptionInput}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the signal..."
            placeholderTextColor={MUTED}
            multiline
            autoFocus
            autoCorrect
            autoComplete="off"
            textContentType="none"
          />

          <Text style={styles.label}>Signal type</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.typeRow}>
            {LEGEND_ORDER.map((key) => {
              const meta = TYPE_META[key];
              if (!meta) return null;
              const selected = typeKey === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.typeButton, selected && styles.typeButtonSelected]}
                  onPress={() => setTypeKey(key)}>
                  <Text style={styles.typeEmoji}>{meta.emoji}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Text style={styles.typeLabel}>{TYPE_META[typeKey]?.label || ''}</Text>

          <TextInput
            style={styles.fieldInput}
            value={eta}
            onChangeText={setEta}
            placeholder="When does it arrive or happen?"
            placeholderTextColor={MUTED}
          />

          <TextInput
            style={styles.fieldInput}
            value={sender}
            onChangeText={setSender}
            placeholder="Source or sender..."
            placeholderTextColor={MUTED}
            autoCorrect={false}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="organizationName"
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={onClose}
              disabled={submitting}>
              <Text style={styles.btnSecondaryText}>Avert</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btn,
                styles.btnAdd,
                !canSubmit && { opacity: 0.5 },
              ]}
              onPress={handleAdd}
              disabled={!canSubmit}>
              <Text style={styles.btnAddText}>Launch</Text>
            </TouchableOpacity>
          </View>
            </Pressable>
          </SwipeDismissSheet>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // KeyboardAvoidingView wraps the modal contents so the focused
  // TextInput pushes the sheet up when the keyboard slides in (iOS
  // only — Android handles via windowSoftInputMode in the manifest).
  kbWrap: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 16,
  },
  sheetHeader: {
    color: OFF_WHITE,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 0.3,
  },
  descriptionInput: {
    color: OFF_WHITE,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    minHeight: 50,
    marginBottom: 16,
  },
  label: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
  typeRow: {
    gap: 8,
    paddingVertical: 4,
    paddingRight: 8,
  },
  typeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  typeButtonSelected: {
    borderColor: BRASS,
    backgroundColor: 'rgba(184, 150, 12, 0.10)',
  },
  typeEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  typeLabel: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  fieldInput: {
    color: OFF_WHITE,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.10)',
    marginBottom: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnSecondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  btnSecondaryText: {
    color: OFF_WHITE,
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  btnAdd: {
    backgroundColor: BRASS,
  },
  btnAddText: {
    color: BG,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
