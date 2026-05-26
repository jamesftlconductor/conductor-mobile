// First-tap feature introduction modal. Pairs with useDiscovered to
// onboard a user to surfaces they haven't met yet — Pulse, signal
// chips, Minimap, feedback thumbs. Dimmed-feature tap opens this
// modal; "Got it →" or tap-outside marks the feature discovered so
// the dim treatment goes away permanently.

import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';

export type FeatureIntro = {
  icon: string;
  name: string;
  description: string;
};

// Canonical intro copy, indexed by featureId. Callers pass the id
// instead of repeating these strings at every dimmed surface.
export const FEATURE_INTROS: Record<string, FeatureIntro> = {
  pulse: {
    icon: '◉',
    name: 'The Pulse',
    description:
      'One sentence that synthesizes your health, the weather, and your signal load into what kind of day it actually is.',
  },
  signals: {
    icon: '●',
    name: 'Signals',
    description:
      "Anything your household needs to know or act on. Tap any signal to see details, context, and next steps.",
  },
  minimap: {
    icon: '⌖',
    name: 'The Conductor',
    description:
      'Your household in miniature. Tap from any screen to ask The Conductor anything.',
  },
  feedback: {
    icon: '✓',
    name: 'Brief feedback',
    description:
      "Tell The Conductor how it's doing. Your feedback shapes tomorrow's brief.",
  },
};

export function FeatureIntroduction({
  visible,
  featureId,
  onDismiss,
}: {
  visible: boolean;
  featureId: string;
  onDismiss: () => void;
}) {
  const { theme, accentColor } = useTheme();
  const intro = FEATURE_INTROS[featureId];
  if (!intro) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onDismiss}>
      {/* Tap-outside-to-dismiss backdrop. Inner Pressable swallows
          the tap so the card itself doesn't trigger dismiss. */}
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable
          onPress={() => {}}
          style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.icon, { color: accentColor }]}>{intro.icon}</Text>
          <Text style={[styles.name, { color: theme.text }]}>{intro.name}</Text>
          <Text style={[styles.description, { color: theme.muted }]}>
            {intro.description}
          </Text>
          <TouchableOpacity
            onPress={onDismiss}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
            style={styles.button}>
            <Text style={[styles.buttonText, { color: accentColor }]}>Got it →</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  icon: {
    fontSize: 32,
    textAlign: 'center',
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
    letterSpacing: 0.2,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 8,
  },
  button: {
    marginTop: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
