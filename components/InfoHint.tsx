// Small, unobtrusive italic "i" info affordance. Tapping it pops a compact
// tooltip card just below the icon explaining the adjacent feature. The card
// auto-dismisses after 3s or on a tap anywhere. Used on Ground (The Pulse and
// the brief) and mirrored by the Hover help glyph so "i = info" reads as one
// consistent language across the app.
//
// Positioning is measured at tap time (measureInWindow) so the same component
// drops in anywhere without the caller computing coordinates, and the card is
// clamped to stay on-screen near either edge.

import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';

const CARD_WIDTH = 240;
const AUTO_DISMISS_MS = 3000;

export function InfoHint({ message }: { message: string }) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const iconRef = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function close() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setOpen(false);
  }

  function openHint() {
    iconRef.current?.measureInWindow((x, y, w, h) => {
      // Clamp so the card never spills off either edge (12px margins).
      const left = Math.max(12, Math.min(x, width - CARD_WIDTH - 12));
      setPos({ top: y + h + 6, left });
      setOpen(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(close, AUTO_DISMISS_MS);
    });
  }

  return (
    <>
      <Pressable
        ref={iconRef}
        onPress={openHint}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={[styles.icon, { color: theme.muted }]}>i</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}>
        {/* Full-screen catcher — a tap anywhere dismisses. */}
        <Pressable style={styles.overlay} onPress={close}>
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                top: pos.top,
                left: pos.left,
              },
            ]}>
            <Text style={[styles.cardText, { color: theme.text }]}>{message}</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '600',
  },
  overlay: {
    flex: 1,
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 14,
    // Subtle lift so the card reads above content in both themes.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  cardText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
