// THE FAMILY MOVEMENT — swipe DOWN from The Conductor.
// "the people in your life" — all crew (partner, kids, extended, pets).
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useUserId, useHouseholdId } from '@/hooks/useUserId';
import { useTheme } from '@/app/theme';
import {
  MovementScreen,
  MovementSection,
  SignalRow,
  EmptyLine,
} from '@/components/MovementScreen';
import { fetchMovement, MovementApiResponse } from '@/utils/movementApi';

export default function MovementFamilyScreen() {
  const userId = useUserId();
  const householdId = useHouseholdId();
  const { theme, accentColor } = useTheme();
  const [data, setData] = useState<MovementApiResponse>({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const res = await fetchMovement('family', householdId, userId);
      if (!cancelled) setData(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, householdId]);

  const crew = data.crewSummaries ?? [];
  const dates = data.upcomingDates ?? [];

  return (
    <MovementScreen movementKey="family">
      <MovementSection title="Crew">
        {crew.length ? (
          crew.map((m) => {
            const sigs = m.signals ?? [];
            const count = m.signalCount ?? sigs.length;
            return (
              <View key={m.name} style={styles.card}>
                <View style={styles.cardHead}>
                  {m.photoUrl ? (
                    <Image source={{ uri: m.photoUrl }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarFallback, { borderColor: accentColor }]}>
                      <Text style={{ color: accentColor, fontWeight: '700' }}>
                        {m.name.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: theme.text }]}>{m.name}</Text>
                    <Text style={[styles.sub, { color: theme.muted }]}>
                      {count > 0 ? `${count} signal${count === 1 ? '' : 's'}` : 'all quiet'}
                    </Text>
                  </View>
                </View>
                {sigs.length > 0
                  ? sigs.map((s) => <SignalRow key={String(s.id)} signal={s} />)
                  : null}
              </View>
            );
          })
        ) : (
          <EmptyLine text="No crew added yet." />
        )}
      </MovementSection>

      <MovementSection title="Upcoming Dates">
        {dates.length ? (
          dates.map((d, i) => (
            <Text key={i} style={[styles.dateLine, { color: theme.text }]}>
              <Text style={{ color: accentColor }}>{d.name}</Text>
              {`  —  ${[d.label, d.date].filter(Boolean).join(': ')}`}
            </Text>
          ))
        ) : (
          <EmptyLine text="No birthdays or anniversaries on file." />
        )}
      </MovementSection>
    </MovementScreen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  avatarFallback: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1f2a' },
  name: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 11, marginTop: 1 },
  dateLine: { fontSize: 13, lineHeight: 20, paddingVertical: 3 },
});
