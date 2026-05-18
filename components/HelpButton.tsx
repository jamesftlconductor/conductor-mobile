// Small "?" circular button that opens the Directory at a specific
// card. Used by the main screens (Ground, Hover, Vault, Crew,
// Horizon, Compass, Journal) so a user who hits an unfamiliar screen
// has one tap to the explainer.

import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

const FAINT = '#a8a5a0';

type Props = {
  cardId: string;
  // Visual offset — defaults to the standard top right placement;
  // pass {top, right} to nudge for screens with crowded headers.
  top?: number;
  right?: number;
};

export function HelpButton({ cardId, top = 60, right = 22 }: Props) {
  return (
    <TouchableOpacity
      onPress={() => router.push(`/directory?card=${cardId}` as any)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.btn, { top, right }]}
      activeOpacity={0.6}>
      <Text style={styles.text}>?</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  text: {
    color: FAINT,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 14,
  },
});
