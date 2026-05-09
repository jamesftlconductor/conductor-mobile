import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { metaFor, Signal, TYPE_META } from './signalTypes';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

// Status cycle for the edit-mode tap-to-advance picker. Keep in sync
// with the values produced by the import classifier; "Unknown" is the
// fall-through option for signals where status genuinely isn't known.
const STATUS_CYCLE = [
  'In Transit',
  'Out for Delivery',
  'Delivered',
  'Delayed',
  'Unknown',
];

type SingleProps = {
  mode: 'single';
  visible: boolean;
  signal: Signal;
  resolving?: boolean;
  userId?: string;
  onClose: () => void;
  onRest: (s: Signal) => void;
  onHold: (s: Signal) => void;
  onUpdate?: (updated: Signal) => void;
};

type CategoryProps = {
  mode: 'category';
  visible: boolean;
  categoryTypeKey: string;
  signals: Signal[];
  bottomInset?: number;
  onClose: () => void;
  onRest: (s: Signal) => void;
};

type FinaleSheetProps = SingleProps | CategoryProps;

export function FinaleSheet(props: FinaleSheetProps) {
  if (props.mode === 'single') {
    return <SingleSheet {...props} />;
  }

  const { visible, categoryTypeKey, signals, bottomInset = 0, onClose, onRest } = props;
  const categoryMeta = TYPE_META[categoryTypeKey];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable
        style={[styles.modalBackdrop, styles.filterBackdrop]}
        onPress={onClose}>
        <Pressable style={styles.filterSheet} onPress={() => {}}>
          <View style={styles.filterHeader}>
            <View style={styles.filterTitleRow}>
              {categoryMeta && (
                <>
                  <Text style={styles.filterTitleEmoji}>{categoryMeta.emoji}</Text>
                  <Text style={[styles.filterTitle, { color: categoryMeta.color }]}>
                    {categoryMeta.label}
                  </Text>
                </>
              )}
            </View>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.clearFilterText}>Reset</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.filterList}
            contentContainerStyle={{ paddingBottom: 32 + bottomInset }}>
            {signals.length === 0 ? (
              <Text style={styles.filterEmpty}>Nothing here right now.</Text>
            ) : (
              signals.map((s) => {
                const meta = metaFor(s);
                return (
                  <View key={String(s.id)} style={styles.filterItem}>
                    <Text style={styles.filterItemEmoji}>{meta.emoji}</Text>
                    <View style={styles.filterItemBody}>
                      <Text style={styles.filterItemDescription} numberOfLines={2}>
                        {s.description || 'Unknown signal'}
                      </Text>
                      {!!s.sender && (
                        <Text style={styles.filterItemMeta}>From {s.sender}</Text>
                      )}
                      {!!s.status && (
                        <Text style={styles.filterItemMeta}>Status {s.status}</Text>
                      )}
                      <Text style={styles.filterItemMeta}>ETA {s.eta || 'Unknown'}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.filterRestBtn}
                      onPress={() => onRest(s)}>
                      <Text style={styles.filterRestBtnText}>Rest</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Single-mode is its own component so it can hold edit-mode state via
// hooks without breaking the discriminated-union shape of the public
// FinaleSheet props.
function SingleSheet({
  visible,
  signal,
  resolving,
  userId,
  onClose,
  onRest,
  onHold,
  onUpdate,
}: SingleProps) {
  const meta = metaFor(signal);
  const [editing, setEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState(signal.description || '');
  const [editedEta, setEditedEta] = useState(signal.eta || '');
  const [editedStatus, setEditedStatus] = useState(signal.status || 'Unknown');
  const [saving, setSaving] = useState(false);
  const dimOpacity = useRef(new Animated.Value(1)).current;

  // Reset edit state when a different signal opens — without this, an
  // unsaved edit on signal A would leak into signal B if the user
  // closed A and tapped B.
  useEffect(() => {
    setEditing(false);
    setEditedDescription(signal.description || '');
    setEditedEta(signal.eta || '');
    setEditedStatus(signal.status || 'Unknown');
  }, [signal.id]);

  const cycleStatus = () => {
    const i = STATUS_CYCLE.indexOf(editedStatus);
    const next = STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
    setEditedStatus(next);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const updated: Signal = {
      ...signal,
      description: editedDescription,
      eta: editedEta || null,
      status: editedStatus,
    };
    // Best-effort PATCH. The backend currently validates `state` and
    // rejects without it, so this call may 400 until /api/signals.js
    // accepts description/eta/status fields. Local state still updates
    // so the user sees their edit immediately.
    try {
      await fetch(`${API_BASE}/signals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: signal.id,
          userId,
          description: editedDescription,
          eta: editedEta || null,
          status: editedStatus,
        }),
      });
    } catch (err) {
      console.warn('Signal edit save failed:', err);
    }
    onUpdate?.(updated);
    setSaving(false);
    setEditing(false);
    // Subtle dim/return on the now-displayed description to acknowledge
    // the save without a flashy toast.
    Animated.sequence([
      Animated.timing(dimOpacity, {
        toValue: 0.4,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(dimOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleCancel = () => {
    setEditedDescription(signal.description || '');
    setEditedEta(signal.eta || '');
    setEditedStatus(signal.status || 'Unknown');
    setEditing(false);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderWrap}>
            <Text style={styles.sheetHeader}>Finale</Text>
            {!editing && (
              <TouchableOpacity
                style={styles.editLinkPosition}
                onPress={() => setEditing(true)}>
                <Text style={styles.editLink}>ADJUST</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.sheetEmoji}>{meta.emoji}</Text>

          {!editing ? (
            <>
              <Animated.Text
                style={[styles.sheetDescription, { opacity: dimOpacity }]}>
                {signal.description || 'Unknown signal'}
              </Animated.Text>
              <View style={styles.metaBlock}>
                {!!signal.sender && (
                  <Text style={styles.metaLine}>From {signal.sender}</Text>
                )}
                {!!signal.status && (
                  <Text style={styles.metaLine}>Status {signal.status}</Text>
                )}
                <Text style={styles.metaLine}>ETA {signal.eta || 'Unknown'}</Text>
              </View>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={() => onHold(signal)}>
                  <Text style={styles.btnSecondaryText}>Hold</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, resolving && { opacity: 0.5 }]}
                  onPress={() => onRest(signal)}
                  disabled={resolving}>
                  <Text style={styles.btnPrimaryText}>Rest</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <TextInput
                style={styles.editDescription}
                value={editedDescription}
                onChangeText={setEditedDescription}
                placeholder="Description"
                placeholderTextColor={MUTED}
                multiline
              />
              <View style={styles.metaBlock}>
                {!!signal.sender && (
                  <Text style={styles.metaLine}>From {signal.sender}</Text>
                )}
                <TouchableOpacity
                  onPress={cycleStatus}
                  style={styles.editMetaRow}>
                  <Text style={styles.editLabel}>Status</Text>
                  <Text style={styles.editValue}>{editedStatus}</Text>
                </TouchableOpacity>
                <View style={styles.editMetaRow}>
                  <Text style={styles.editLabel}>ETA</Text>
                  <TextInput
                    style={styles.editEtaInput}
                    value={editedEta}
                    onChangeText={setEditedEta}
                    placeholder="Add date..."
                    placeholderTextColor={MUTED}
                  />
                </View>
              </View>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={handleCancel}
                  disabled={saving}>
                  <Text style={styles.btnSecondaryText}>Avert</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSave, saving && { opacity: 0.5 }]}
                  onPress={handleSave}
                  disabled={saving}>
                  <Text style={styles.btnSaveText}>Remember</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  sheetHeaderWrap: {
    position: 'relative',
    marginBottom: 12,
    justifyContent: 'center',
  },
  sheetHeader: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 3,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  editLinkPosition: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  editLink: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '500',
  },
  sheetEmoji: {
    fontSize: 40,
    lineHeight: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  sheetDescription: {
    color: OFF_WHITE,
    fontSize: 18,
    fontWeight: '300',
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 0.2,
  },
  editDescription: {
    color: OFF_WHITE,
    fontSize: 18,
    fontWeight: '300',
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 0.2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    minHeight: 40,
  },
  metaBlock: {
    marginBottom: 24,
    gap: 6,
  },
  metaLine: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  editMetaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  editLabel: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  editValue: {
    color: OFF_WHITE,
    fontSize: 13,
    letterSpacing: 0.3,
    textDecorationLine: 'underline',
    textDecorationColor: MUTED,
  },
  editEtaInput: {
    color: OFF_WHITE,
    fontSize: 13,
    letterSpacing: 0.3,
    minWidth: 140,
    textAlign: 'left',
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: OFF_WHITE,
  },
  btnPrimaryText: {
    color: BG,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
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
  btnSave: {
    backgroundColor: BRASS,
  },
  btnSaveText: {
    color: BG,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  filterBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  filterSheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '70%',
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  filterTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterTitleEmoji: {
    fontSize: 20,
    lineHeight: 24,
  },
  filterTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  clearFilterText: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  filterList: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  filterEmpty: {
    color: MUTED,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 32,
  },
  filterItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: 12,
  },
  filterItemEmoji: {
    fontSize: 24,
    lineHeight: 28,
    width: 28,
    textAlign: 'center',
  },
  filterItemBody: {
    flex: 1,
    gap: 4,
  },
  filterItemDescription: {
    color: OFF_WHITE,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
  },
  filterItemMeta: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  filterRestBtn: {
    backgroundColor: OFF_WHITE,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignSelf: 'center',
  },
  filterRestBtnText: {
    color: BG,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
