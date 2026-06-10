// Small "?" circular button that opens the Directory at a specific
// card. Used by the main screens (Ground, Hover, Vault, Crew,
// Horizon, Compass, Journal) so a user who hits an unfamiliar screen
// has one tap to the explainer.

import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { useTheme } from '@/app/theme';

type Props = {
  cardId: string;
  // Visual offset — defaults to the standard top right placement.
  // Pass `left` to anchor to the top-left instead (Ground uses this so
  // the Directory "?" sits opposite the Minimap).
  top?: number;
  right?: number;
  left?: number;
};

export function HelpButton({ cardId, top = 60, right, left }: Props) {
  const { accentColor } = useTheme();
  const pos = left != null ? { left } : { right: right ?? 22 };
  return (
    <TouchableOpacity
      onPress={() => router.push(`/directory?card=${cardId}` as any)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.btn, { top, ...pos }]}
      activeOpacity={0.6}>
      <Text style={[styles.text, { color: accentColor }]}>?</Text>
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
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 14,
  },
});
