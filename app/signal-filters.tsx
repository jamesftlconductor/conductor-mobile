import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';
import { useUserId } from '@/hooks/useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

type CamouflageRule = {
  type: 'sender' | 'signalType';
  value: string;
  addedAt?: number;
};

export default function SignalFiltersScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [rules, setRules] = useState<CamouflageRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/signals?type=camouflage&userId=${userId}`);
      if (!res.ok) return;
      const data = await res.json();
      setRules(Array.isArray(data?.rules) ? data.rules : []);
    } catch {
      // Best-effort. Keep prior list on failure.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function confirmRemove(rule: CamouflageRule) {
    const label = rule.type === 'sender' ? `signals from "${rule.value}"` : `signals of type "${rule.value}"`;
    Alert.alert(
      'Remove filter',
      `Show ${label} again? Conductor will start surfacing them on the next import.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove filter',
          style: 'destructive',
          onPress: async () => {
            setRules((prev) => prev.filter((r) => !(r.type === rule.type && r.value === rule.value)));
            try {
              await fetch(
                `${API_BASE}/signals?type=camouflage&userId=${userId}&value=${encodeURIComponent(rule.value)}`,
                { method: 'DELETE' }
              );
            } catch {
              load();
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <TouchableOpacity
        onPress={() => router.back()}
        activeOpacity={0.6}
        style={styles.topBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.topBackText}>← Return</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Signal Filters</Text>
      <Text style={styles.subtitle}>Senders and types Conductor never surfaces</Text>

      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={theme.muted} />
        </View>
      ) : rules.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No filters active. Signals from all sources will appear.
          </Text>
        </View>
      ) : (
        rules.map((r) => (
          <View key={`${r.type}-${r.value}`} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.ruleValue}>{r.value}</Text>
              <Text style={styles.ruleKind}>
                {r.type === 'sender' ? 'sender' : 'signal type'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => confirmRemove(r)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.removeLink}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

type ThemeColors = { background: string; surface: string; text: string; muted: string };

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    scroll: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 60 },
    topBack: {
      alignSelf: 'flex-start',
      paddingVertical: 6,
      paddingHorizontal: 4,
      marginBottom: 8,
    },
    topBackText: {
      color: theme.muted,
      fontSize: 13,
      letterSpacing: 0.3,
    },
    title: {
      color: theme.text,
      fontSize: 22,
      fontWeight: '700',
      letterSpacing: -0.2,
      marginBottom: 6,
    },
    subtitle: {
      color: theme.muted,
      fontSize: 13,
      paddingBottom: 24,
      letterSpacing: 0.2,
    },
    empty: {
      alignItems: 'center',
      paddingVertical: 60,
    },
    emptyText: {
      color: theme.muted,
      fontSize: 13,
      letterSpacing: 0.3,
      textAlign: 'center',
      paddingHorizontal: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 0,
      minHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.06)',
      gap: 12,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    ruleValue: {
      color: theme.text,
      fontSize: 15,
    },
    ruleKind: {
      color: theme.muted,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      fontWeight: '600',
    },
    removeLink: {
      color: accentColor,
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      fontWeight: '600',
    },
  });
}
