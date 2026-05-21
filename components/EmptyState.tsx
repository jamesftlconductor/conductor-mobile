// Reusable empty state — a warm specific message + one optional
// action. Replaces the assortment of inline empty-state text blocks
// across screens with a single visual treatment.

import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';

export function EmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme, accentColor } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.message, { color: theme.muted }]}>{message}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity
          onPress={onAction}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ marginTop: 14 }}>
          <Text style={{ color: accentColor, fontSize: 13, fontWeight: '600', letterSpacing: 0.4 }}>
            {actionLabel} →
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: TOKENS.space.pad,
  },
  message: {
    ...TOKENS.type.body,
    textAlign: 'center',
    maxWidth: 320,
  },
});
