// Compact horizontal pill row for the Me / Crew / House filter.
// Consumer screens own the filter state via useSignalFilter; this
// component is purely visual + tap dispatch.
//
// Pills auto-tint with the current accent color when active.

import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';
import type { SignalFilter } from '@/hooks/useSignalFilter';

type Pill = { id: SignalFilter; label: string };

const PILLS: Pill[] = [
  { id: 'all',   label: 'All' },
  { id: 'me',    label: 'Me' },
  { id: 'crew',  label: 'Crew' },
  { id: 'house', label: 'House' },
];

export function SignalFilterPills({
  value,
  onChange,
}: {
  value: SignalFilter;
  onChange: (next: SignalFilter) => void;
}) {
  const { theme, accentColor } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      {PILLS.map((p) => {
        const active = p.id === value;
        return (
          <TouchableOpacity
            key={p.id}
            onPress={() => onChange(p.id)}
            activeOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[
              styles.pill,
              {
                backgroundColor: active ? accentColor : theme.surface,
                borderColor: active ? accentColor : (theme.border || 'rgba(255,255,255,0.08)'),
              },
            ]}>
            <Text
              style={{
                color: active ? '#0f0f0f' : theme.muted,
                fontSize: 12,
                fontWeight: active ? '600' : '500',
                letterSpacing: 0.2,
              }}>
              {p.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
});
