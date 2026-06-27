// THE HOME MOVEMENT — swipe UP from The Conductor. "your house, maintained".
import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useUserId, useHouseholdId } from '@/hooks/useUserId';
import { useTheme } from '@/app/theme';
import {
  MovementScreen,
  MovementSection,
  SignalRow,
  EmptyLine,
} from '@/components/MovementScreen';
import { fetchMovement, MovementApiResponse } from '@/utils/movementApi';

export default function MovementHomeScreen() {
  const userId = useUserId();
  const householdId = useHouseholdId();
  const { theme, accentColor } = useTheme();
  const [data, setData] = useState<MovementApiResponse>({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const res = await fetchMovement('home', householdId, userId);
      if (!cancelled) setData(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, householdId]);

  const signals = data.activeSignals ?? [];
  const renewals = data.vaultRenewals ?? [];
  const inventory = data.inventory ?? [];

  return (
    <MovementScreen movementKey="home">
      <MovementSection title="Active Signals">
        {signals.length ? (
          signals.map((s) => <SignalRow key={String(s.id)} signal={s} />)
        ) : (
          <EmptyLine text="Your house is quiet today." />
        )}
      </MovementSection>

      <MovementSection title="Upcoming Renewals">
        {renewals.length ? (
          renewals.map((r, i) => (
            <View key={i} style={styles.line}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {r.name}
              </Text>
              {!!r.date && <Text style={[styles.meta, { color: accentColor }]}>{r.date}</Text>}
            </View>
          ))
        ) : (
          <EmptyLine text="No renewals or expirations on the horizon." />
        )}
      </MovementSection>

      <MovementSection title="Home Inventory">
        {inventory.length ? (
          inventory.map((it, i) => (
            <View key={i} style={styles.line}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {it.name}
              </Text>
              {!!it.note && <Text style={[styles.meta, { color: theme.muted }]}>{it.note}</Text>}
            </View>
          ))
        ) : (
          <EmptyLine text="Nothing in the inventory needs attention." />
        )}
      </MovementSection>
    </MovementScreen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  name: { fontSize: 14, flex: 1 },
  meta: { fontSize: 12, letterSpacing: 0.3 },
});
