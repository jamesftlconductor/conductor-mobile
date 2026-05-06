import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { metaFor, Signal, TYPE_META } from './signalTypes';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';

type SingleProps = {
  mode: 'single';
  visible: boolean;
  signal: Signal;
  resolving?: boolean;
  onClose: () => void;
  onRest: (s: Signal) => void;
  onHold: (s: Signal) => void;
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
    const { visible, signal, resolving, onClose, onRest, onHold } = props;
    const meta = metaFor(signal);
    return (
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={onClose}>
        <Pressable style={styles.modalBackdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetHeader}>Finale</Text>
            <Text style={styles.sheetEmoji}>{meta.emoji}</Text>
            <Text style={styles.sheetDescription}>
              {signal.description || 'Unknown signal'}
            </Text>
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
          </Pressable>
        </Pressable>
      </Modal>
    );
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
              <Text style={styles.clearFilterText}>Clear filter</Text>
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
  sheetHeader: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 3,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 12,
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
