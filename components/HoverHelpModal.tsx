// Inline help modal for the Hover screen — explains the three rings
// without leaving the screen (separate from the Directory deep-link
// pattern used elsewhere). Also doubles as the one-time "your radar
// is now fully active" reveal once a household passes 7 days.

import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const FAINT = '#a8a5a0';
const BRASS = '#b8960c';
const SOFT_BORDER = 'rgba(255,255,255,0.06)';

type Props = {
  visible: boolean;
  variant?: 'help' | 'reveal';
  onDismiss: () => void;
};

export function HoverHelpModal({ visible, variant = 'help', onDismiss }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 200,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Animated.View style={[styles.card, { opacity }]}>
          {variant === 'reveal' ? (
            <>
              <Text style={styles.title}>Your radar is now fully active.</Text>
              <Text style={styles.body}>
                Three rings show urgency — inner ring needs attention today.
                Middle ring is approaching. Outer ring is on the horizon.
              </Text>
              <Text style={styles.body}>
                Tap any signal to see details. Long press to expand a ring.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.eyebrow}>THREE RINGS</Text>
              <View style={styles.ringRow}>
                <Text style={styles.dot}>⬤</Text>
                <Text style={styles.ringLabel}>Inner — needs attention today</Text>
              </View>
              <View style={styles.ringRow}>
                <Text style={styles.dot}>⬤</Text>
                <Text style={styles.ringLabel}>Middle — approaching this week</Text>
              </View>
              <View style={styles.ringRow}>
                <Text style={styles.dot}>⬤</Text>
                <Text style={styles.ringLabel}>Outer — on the horizon</Text>
              </View>
              <View style={styles.divider} />
              <Text style={styles.tip}>Tap any signal to see details.</Text>
              <Text style={styles.tip}>Long press to expand a ring.</Text>
            </>
          )}
          <TouchableOpacity onPress={onDismiss} style={styles.gotIt}>
            <Text style={styles.gotItText}>Got it</Text>
          </TouchableOpacity>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: SOFT_BORDER,
    borderRadius: 18,
    padding: 26,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 20,
    fontWeight: '400',
    marginBottom: 16,
    lineHeight: 28,
  },
  body: {
    color: FAINT,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  eyebrow: {
    color: MUTED,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '600',
    marginBottom: 16,
  },
  ringRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  dot: { color: BRASS, fontSize: 16, marginRight: 14 },
  ringLabel: { color: OFF_WHITE, fontSize: 13, flex: 1 },
  divider: {
    height: 1,
    backgroundColor: SOFT_BORDER,
    marginVertical: 14,
  },
  tip: { color: FAINT, fontSize: 12, marginBottom: 4 },

  gotIt: {
    marginTop: 22,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: BRASS,
    alignItems: 'center',
  },
  gotItText: { color: '#0f0f0f', fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
});
