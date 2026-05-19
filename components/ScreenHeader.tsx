// Shared top-of-screen header. Used everywhere except Ground and
// Hover (which have their own special-case treatments).
//
// Layout (left → right):
//   ← Return  /  title (flex 1, left-aligned)  /  rightAction  /  Minimap
//
// Spacing:
//   - Top padding 60px (clears the iOS status bar / Dynamic Island)
//   - Bottom padding 12px
//   - Horizontal 16px
//   - rightAction sits 8px to the left of the Minimap
//
// The Minimap (inline mode) doubles as the universal "what's
// Conductor watching right now" affordance — tap opens a
// ConductorSheet with the live signal summary. The sheet state is
// owned here so every screen gets the behavior for free.
//
// Callers pass title + optional rightAction + optional onBack
// override. When onBack is omitted, router.back() is used.

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';
import { ConductorSheet } from './ConductorSheet';
import { Minimap } from './Minimap';

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  // Custom node rendered immediately to the left of the Minimap.
  // Typical use: a "+" button to open an add sheet on the current
  // screen. Caller is responsible for the touch target — wrap in
  // a TouchableOpacity with hitSlop if it's a small glyph.
  rightAction?: React.ReactNode;
  // Hide the back button (used on root screens like Settings tabs
  // that don't have a previous screen in the stack).
  hideBack?: boolean;
};

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  rightAction,
  hideBack,
}: Props) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {hideBack ? (
          <View style={styles.backSpacer} />
        ) : (
          <TouchableOpacity
            onPress={onBack || (() => router.back())}
            activeOpacity={0.6}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.backBtn}>
            <Text style={styles.backText}>← Return</Text>
          </TouchableOpacity>
        )}
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>
        {rightAction ? (
          <View style={styles.rightActionWrap}>{rightAction}</View>
        ) : null}
        <Minimap floating={false} onPress={() => setSheetOpen(true)} />
      </View>
      <ConductorSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  );
}

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
};

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    wrap: {
      paddingTop: 60,
      paddingBottom: 12,
      paddingHorizontal: 16,
      backgroundColor: theme.background,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    backBtn: {
      paddingVertical: 6,
      paddingRight: 4,
    },
    backSpacer: {
      width: 1,
    },
    backText: {
      color: theme.muted,
      fontSize: 13,
      letterSpacing: 0.3,
    },
    titleBlock: {
      flex: 1,
      marginLeft: 4,
    },
    title: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: 0.1,
    },
    subtitle: {
      color: theme.muted,
      fontSize: 11,
      marginTop: 2,
      letterSpacing: 0.2,
    },
    // 8px gap to the left of the Minimap is enforced by the parent
    // row's `gap: 8`. This wrapper exists to give the rightAction a
    // consistent vertical-center alignment with the title block.
    rightActionWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
