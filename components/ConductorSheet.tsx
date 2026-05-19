// Bottom sheet opened by tapping the Minimap from any header. The
// header line reads "{urgent} urgent · {total} signals in motion" so
// the user knows what Conductor is seeing right now. Below: a thin
// summary + quick links into Hover / Horizon / Programme.
//
// Designed to be cheap to mount — fetches active-signal counts on
// open, never on mount. Closes via tap-outside or swipe-down (uses
// SwipeDismissSheet for the standard 36×4 drag handle + 80px pan
// threshold).

import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';
import { SwipeDismissSheet } from './SwipeDismissSheet';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

type SignalLite = {
  id: number | string;
  state?: string;
  eta?: string | null;
  status?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function urgentCountFrom(signals: SignalLite[]): number {
  const now = Date.now();
  let urgent = 0;
  for (const s of signals) {
    if (s.state && s.state !== 'incoming' && s.state !== 'active') continue;
    const isDelayed = (s.status || '').toLowerCase().includes('delay');
    const ms = s.eta ? Date.parse(s.eta) : NaN;
    const within24h = !isNaN(ms) && ms - now < DAY_MS && ms - now > -DAY_MS;
    if (within24h || isDelayed) urgent++;
  }
  return urgent;
}

export function ConductorSheet({ visible, onClose }: Props) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [signals, setSignals] = useState<SignalLite[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoaded(false);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?userId=${USER_ID}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const list = Array.isArray(data?.signals) ? data.signals : [];
        if (!cancelled) {
          setSignals(list);
          setLoaded(true);
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const activeSignals = useMemo(
    () =>
      signals.filter(
        (s) => !s.state || s.state === 'incoming' || s.state === 'active'
      ),
    [signals]
  );
  const urgent = urgentCountFrom(signals);
  const total = activeSignals.length;

  function go(path: string) {
    onClose();
    setTimeout(() => router.push(path as never), 120);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <SwipeDismissSheet style={styles.sheet} onClose={onClose}>
          <Pressable onPress={() => {}}>
            <Text style={styles.summary}>
              {loaded
                ? `${urgent} urgent · ${total} signal${total === 1 ? '' : 's'} in motion`
                : 'Reading the household…'}
            </Text>
            <Text style={styles.sub}>
              {loaded && total === 0
                ? "Conductor is watching — nothing's active right now."
                : 'Tap a destination below to see the live picture.'}
            </Text>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                onPress={() => go('/(tabs)/hover')}
                activeOpacity={0.6}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.actionBtn}>
                <Text style={styles.actionEmoji}>📡</Text>
                <Text style={styles.actionLabel}>Hover</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => go('/horizon')}
                activeOpacity={0.6}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.actionBtn}>
                <Text style={styles.actionEmoji}>🔭</Text>
                <Text style={styles.actionLabel}>Horizon</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => go('/programme')}
                activeOpacity={0.6}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.actionBtn}>
                <Text style={styles.actionEmoji}>📅</Text>
                <Text style={styles.actionLabel}>Programme</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => go('/calendar' as never)}
                activeOpacity={0.6}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.actionBtn}>
                <Text style={styles.actionEmoji}>📆</Text>
                <Text style={styles.actionLabel}>Calendar</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeRow}>
              <Text style={styles.closeText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </SwipeDismissSheet>
      </Pressable>
    </Modal>
  );
}

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
};

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 18,
      paddingBottom: 32,
      paddingHorizontal: 22,
    },
    summary: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
      letterSpacing: 0.1,
      marginTop: 4,
    },
    sub: {
      color: theme.muted,
      fontSize: 13,
      marginTop: 6,
      marginBottom: 22,
      lineHeight: 18,
    },
    actionsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    actionBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.background,
      marginHorizontal: 4,
    },
    actionEmoji: {
      fontSize: 22,
      marginBottom: 4,
    },
    actionLabel: {
      color: accentColor,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.4,
    },
    closeRow: {
      marginTop: 16,
      alignItems: 'center',
      paddingVertical: 10,
    },
    closeText: {
      color: theme.muted,
      fontSize: 13,
      letterSpacing: 0.3,
    },
  });
}
