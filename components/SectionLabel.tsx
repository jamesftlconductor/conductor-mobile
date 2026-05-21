// Standardized section header — muted 10px uppercase with 2pt
// letter spacing. Mirrors Settings' reference implementation so
// every screen reads the same.

import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/app/theme';
import { TOKENS } from '@/utils/designTokens';

export function SectionLabel({
  title,
  subtext,
}: {
  title: string;
  subtext?: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.muted }]}>{title}</Text>
      {subtext ? (
        <Text style={[styles.sub, { color: theme.muted }]}>{subtext}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: TOKENS.space.section,
    marginBottom: 4,
  },
  label: {
    ...TOKENS.type.label,
  },
  sub: {
    fontSize: 12,
    marginTop: 6,
    letterSpacing: 0.2,
  },
});
