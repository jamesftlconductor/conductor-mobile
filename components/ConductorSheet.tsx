// Single, root-mounted bottom sheet opened by tapping the Minimap from
// any header. Visibility + screen-context live in useConductorSheet so
// any screen can open this without prop drilling.
//
// Header reads "{urgent} urgent · {total} signals in motion" so the
// user knows what Conductor is seeing right now. A small breadcrumb
// below ("Asked from Hover" / "Asked from Settings" etc.) tells them
// which screen the sheet was invoked from.
//
// Designed to be cheap to mount — fetches signal counts only when
// visibility flips to true. Closes via backdrop tap or swipe-down
// (SwipeDismissSheet provides 36×4 drag handle + 80px pan threshold).

import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/app/theme';
import { closeConductorSheet, useConductorSheetState } from '@/hooks/useConductorSheet';
import { debugLog } from '@/utils/debugLog';
import { SwipeDismissSheet } from './SwipeDismissSheet';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

type SignalLite = {
  id: number | string;
  state?: string;
  eta?: string | null;
  status?: string;
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

// Maps the screen-context slug into a human breadcrumb. Unknown values
// fall through to a generic "Asked from your house" so the line never
// reads as a debug label.
const CONTEXT_LABEL: Record<string, string> = {
  ground: 'Asked from Ground',
  hover: 'Asked from Hover',
  horizon: 'Asked from Horizon',
  programme: 'Asked from Programme',
  calendar: 'Asked from Calendar',
  vault: 'Asked from Vault',
  crew: 'Asked from Crew',
  compass: 'Asked from Compass',
  journal: 'Asked from Journal',
  inventory: 'Asked from Inventory',
  providers: 'Asked from Providers',
  maintenance: 'Asked from Maintenance',
  network: 'Asked from Network',
  directory: 'Asked from Directory',
  communicate: 'Asked from Communicate',
  transition: 'Asked from Transition',
  junior: 'Asked from Junior',
  settings: 'Asked from Settings',
  'privacy-dashboard': 'Asked from Privacy',
  'recurring-events': 'Asked from Recurring',
};

function breadcrumbFor(context: string): string {
  return CONTEXT_LABEL[context] || 'Asked from your house';
}

export function ConductorSheet() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const { visible, context } = useConductorSheetState();
  const [signals, setSignals] = useState<SignalLite[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Backdrop arm-delay — the tap that opened the sheet bubbles
  // through the Modal mount and hits the backdrop Pressable on the
  // same gesture cycle, immediately closing the sheet. Gate the
  // backdrop's onPress behind a 300ms timer so the opening tap can't
  // also be the closing tap. Resets to false on close so the next
  // open cycles through the arm-delay cleanly.
  const [backdropActive, setBackdropActive] = useState(false);
  useEffect(() => {
    if (!visible) {
      setBackdropActive(false);
      return;
    }
    const t = setTimeout(() => setBackdropActive(true), 300);
    return () => clearTimeout(t);
  }, [visible]);

  // Mount-once log so we can confirm the sheet IS mounted at root.
  useEffect(() => {
    debugLog('Sheet', 'ConductorSheet mounted at root');
    return () => debugLog('Sheet', 'ConductorSheet UNMOUNTED');
  }, []);

  // Every time `visible` flips we log the new value so we can see
  // whether useSyncExternalStore is actually notifying this component.
  useEffect(() => {
    debugLog('Sheet', `visible→${visible} context=${context}`);
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
  }, [visible, context]);

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
    closeConductorSheet();
    setTimeout(() => router.push(path as never), 120);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={closeConductorSheet}>
      <Pressable
        style={styles.backdrop}
        onPress={backdropActive ? closeConductorSheet : undefined}>
        <SwipeDismissSheet style={styles.sheet} onClose={closeConductorSheet}>
          <Pressable onPress={() => {}}>
            {/* Header reads as "The Conductor" — Conductor (brand) →
                The Conductor (presence/voice). The context pill sits
                directly below so the user knows the sheet is live. */}
            <Text style={styles.sheetTitle}>The Conductor</Text>
            <Text style={styles.contextPill}>📍 The Conductor is listening</Text>
            <Text style={styles.summary}>
              {loaded
                ? `${urgent} urgent · ${total} signal${total === 1 ? '' : 's'} in motion`
                : 'Reading the household…'}
            </Text>
            <Text style={styles.breadcrumb}>{breadcrumbFor(context)}</Text>
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
              onPress={closeConductorSheet}
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
    sheetTitle: {
      color: theme.text,
      fontSize: 20,
      fontWeight: '700',
      letterSpacing: 0.1,
      marginTop: 2,
      marginBottom: 4,
    },
    contextPill: {
      alignSelf: 'flex-start',
      color: accentColor,
      fontSize: 11,
      letterSpacing: 1.2,
      fontWeight: '600',
      marginBottom: 16,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: accentColor,
      overflow: 'hidden',
    },
    summary: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: 0.1,
      marginTop: 4,
    },
    breadcrumb: {
      color: accentColor,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      fontWeight: '600',
      marginTop: 8,
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
