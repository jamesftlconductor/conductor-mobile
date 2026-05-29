// App Icon selector — grid of 12 monthly icons + the founding-
// household exclusive. Tapping an icon persists the choice; the
// actual OS-level icon swap requires a native module (see
// assets/icons/ICON_SPECS.md and hooks/useDynamicIcon.ts for the
// expo-dynamic-app-icon plumbing).
//
// Follow-the-calendar toggle at the top: when on, the 1st of each
// month surfaces a launch-time suggestion sheet for the new icon.
// When off, the user's choice sticks until they change it manually.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { TOKENS } from '@/utils/designTokens';
import {
  acceptIconChange,
  getAutoUpdateEnabled,
  ICON_COLORS,
  ICON_TAGLINES,
  MONTH_ICONS,
  MONTH_NAMES,
  setAutoUpdateEnabled,
  type IconKey,
} from '@/hooks/useDynamicIcon';
import { useUserId } from '@/hooks/useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

export default function IconSelectorScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [currentIcon, setCurrentIcon] = useState<IconKey>('january');
  const [isFounding, setIsFounding] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const enabled = await getAutoUpdateEnabled();
    setAutoUpdate(enabled);
    try {
      const stored = await AsyncStorage.getItem('currentIcon');
      if (stored && [...MONTH_ICONS, 'founding'].includes(stored as IconKey)) {
        setCurrentIcon(stored as IconKey);
      } else {
        const m = new Date().getMonth();
        setCurrentIcon(MONTH_ICONS[m]);
      }
    } catch { /* ignore */ }

    // Founding-household check — only the foundingHousehold gets the
    // bonus icon at the bottom of the grid. We read the flag off the
    // backend so a re-install on the same household still surfaces
    // the exclusive without needing a local cache.
    try {
      const res = await fetch(`${API_BASE}/signals?type=householdStatus&userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.foundingHousehold === true) setIsFounding(true);
      }
    } catch { /* fall through — exclusive stays hidden on fetch fail */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function pick(icon: IconKey) {
    if (icon === currentIcon) return;
    setCurrentIcon(icon);
    await acceptIconChange(icon);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSavedToast('Icon updated');
    setTimeout(() => setSavedToast(null), 1800);
  }

  const allIcons: IconKey[] = [...MONTH_ICONS];
  if (isFounding) allIcons.push('founding');

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="App Icon" subtitle="Changes with the seasons" screenContext="icon-selector" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Follow the calendar</Text>
            <Text style={styles.toggleSub}>
              The Conductor offers a new icon on the 1st of each month.
            </Text>
          </View>
          <Switch
            value={autoUpdate}
            onValueChange={async (v) => {
              setAutoUpdate(v);
              await setAutoUpdateEnabled(v);
            }}
            trackColor={{ false: theme.inputBackground, true: accentColor }}
            thumbColor={'#f5f0eb'}
            ios_backgroundColor={theme.inputBackground}
          />
        </View>

        <SectionLabel title="Monthly icons" />
        <View style={styles.grid}>
          {allIcons.map((key, idx) => {
            const active = key === currentIcon;
            const name = key === 'founding' ? 'Founding' : MONTH_NAMES[MONTH_ICONS.indexOf(key as any)];
            return (
              <TouchableOpacity
                key={key}
                onPress={() => pick(key)}
                activeOpacity={0.7}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                style={styles.cell}>
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: ICON_COLORS[key] },
                    active && { borderWidth: 2, borderColor: accentColor },
                  ]}
                />
                <Text style={styles.cellLabel}>{name}</Text>
                {key === 'founding' ? (
                  <Text style={styles.foundingLabel}>⚡ Founding</Text>
                ) : (
                  <Text style={styles.cellSub} numberOfLines={1}>
                    {ICON_TAGLINES[key]}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.footer}>Icons designed for your household&apos;s year.</Text>
        <Text style={styles.disclaimer}>
          Full icon designs coming soon. Placeholders shown. Switching the actual
          app icon on the home screen requires a native build — your selection is
          saved either way.
        </Text>
      </ScrollView>

      {savedToast ? (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{savedToast}</Text>
        </View>
      ) : null}
    </View>
  );
}

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border?: string;
};

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    scroll: {
      paddingHorizontal: 20,
      paddingTop: 6,
      paddingBottom: 40,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: TOKENS.listItem.minHeight,
      paddingVertical: TOKENS.listItem.paddingVertical,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border || 'rgba(255,255,255,0.08)',
    },
    toggleLabel: {
      color: theme.text,
      ...TOKENS.type.body,
      fontWeight: '500',
      marginBottom: 2,
    },
    toggleSub: {
      color: theme.muted,
      ...TOKENS.type.secondary,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 6,
    },
    cell: {
      width: '30%',
      alignItems: 'center',
      paddingVertical: 8,
    },
    swatch: {
      width: 56,
      height: 56,
      borderRadius: 14,
      marginBottom: 8,
    },
    cellLabel: {
      color: theme.text,
      ...TOKENS.type.secondary,
      fontWeight: '500',
      marginBottom: 2,
    },
    cellSub: {
      color: theme.muted,
      fontSize: 10,
      lineHeight: 14,
      textAlign: 'center',
    },
    foundingLabel: {
      color: accentColor,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.4,
    },
    footer: {
      color: theme.muted,
      ...TOKENS.type.secondary,
      textAlign: 'center',
      marginTop: 24,
    },
    disclaimer: {
      color: theme.muted,
      fontSize: 10,
      textAlign: 'center',
      marginTop: 10,
      lineHeight: 14,
      paddingHorizontal: 12,
    },
    toast: {
      position: 'absolute',
      bottom: 32,
      alignSelf: 'center',
      backgroundColor: theme.surface,
      paddingVertical: 10,
      paddingHorizontal: 18,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: accentColor,
    },
    toastText: {
      color: accentColor,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}
