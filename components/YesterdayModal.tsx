import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

type ThemeColors = { background: string; surface: string; text: string; muted: string };

type YesterdayPayload = {
  takeoff: string | null;
  clearance: string | null;
  date: string;
};

export default function YesterdayModal({
  visible,
  userId,
  onClose,
}: {
  visible: boolean;
  userId: string;
  onClose: () => void;
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [data, setData] = useState<YesterdayPayload | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch fresh on every open. The two stored briefs change at most twice
  // a day; fetching on demand avoids stale display when re-opening hours
  // later. Best-effort — leaves data state untouched on failure.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/brief?type=yesterday&userId=${userId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // best-effort
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, userId]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={styles.header}>Yesterday&apos;s Programme</Text>
            {data?.date ? <Text style={styles.headerDate}>{data.date}</Text> : null}
          </View>

          {loading && (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.muted} />
            </View>
          )}

          {!loading && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionLabel}>Takeoff</Text>
              <Text style={styles.briefText}>
                {data?.takeoff || (
                  <Text style={styles.noBrief}>Nothing recorded for this session.</Text>
                )}
              </Text>

              <Text style={[styles.sectionLabel, styles.sectionSpacer]}>Clearance</Text>
              <Text style={styles.briefText}>
                {data?.clearance || (
                  <Text style={styles.noBrief}>Nothing recorded for this session.</Text>
                )}
              </Text>
            </ScrollView>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeBtnText}>Shut</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: 36,
      maxHeight: '80%',
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 20,
    },
    header: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
    headerDate: {
      color: theme.muted,
      fontSize: 12,
      letterSpacing: 0.3,
    },
    body: {
      marginBottom: 24,
    },
    loading: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 40,
      marginBottom: 24,
    },
    sectionLabel: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 2,
      fontWeight: '600',
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    sectionSpacer: {
      marginTop: 24,
    },
    briefText: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 22,
      letterSpacing: 0.2,
    },
    noBrief: {
      color: theme.muted,
      fontStyle: 'italic',
    },
    closeBtn: {
      backgroundColor: accentColor,
      paddingVertical: 12,
      borderRadius: 10,
      alignItems: 'center',
    },
    closeBtnText: {
      color: '#0f0f0f',
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
  });
}
