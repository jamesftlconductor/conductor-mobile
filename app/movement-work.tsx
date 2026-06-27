// THE WORK MOVEMENT — swipe RIGHT from The Conductor. "your schedule, protected".
import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useUserId, useHouseholdId } from '@/hooks/useUserId';
import { useTheme } from '@/app/theme';
import {
  MovementScreen,
  MovementSection,
  SignalRow,
  EmptyLine,
  ConnectPrompt,
} from '@/components/MovementScreen';
import { fetchMovement, MovementApiResponse } from '@/utils/movementApi';

export default function MovementWorkScreen() {
  const userId = useUserId();
  const householdId = useHouseholdId();
  const { theme, accentColor } = useTheme();
  const [data, setData] = useState<MovementApiResponse>({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const res = await fetchMovement('work', householdId, userId);
      if (!cancelled) setData(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, householdId]);

  const blocks = data.workBlocksToday ?? [];
  const conflicts = data.conflicts ?? [];
  const financial = data.financialSignals ?? [];
  const connected = data.workCalendarConnected ?? blocks.length > 0;

  // Not connected and no schedule → the connection prompt IS the screen.
  if (!connected && blocks.length === 0) {
    return (
      <MovementScreen movementKey="work">
        <MovementSection title="Activate The Work Movement">
          <EmptyLine text="The Conductor protects your schedule by watching your work calendar for conflicts — service calls during meetings, deliveries on travel days." />
          <ConnectPrompt
            text="Connect your work calendar to activate this movement →"
            onPress={() => router.push('/(tabs)/settings?hub=score' as never)}
          />
        </MovementSection>
      </MovementScreen>
    );
  }

  return (
    <MovementScreen movementKey="work">
      {conflicts.length > 0 && (
        <MovementSection title="Conflicts">
          {conflicts.map((c, i) => (
            <View key={i} style={[styles.conflict, { borderColor: accentColor + '99' }]}>
              <Text style={[styles.conflictText, { color: theme.text }]}>{c.text}</Text>
            </View>
          ))}
        </MovementSection>
      )}

      <MovementSection title="Today's Schedule">
        {blocks.length ? (
          blocks.map((b, i) => (
            <View key={i} style={styles.line}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {b.title}
              </Text>
              {(b.start || b.end) && (
                <Text style={[styles.meta, { color: accentColor }]}>
                  {[b.start, b.end].filter(Boolean).join('–')}
                </Text>
              )}
            </View>
          ))
        ) : (
          <EmptyLine text="Nothing on the calendar today." />
        )}
      </MovementSection>

      <MovementSection title="Financial">
        {financial.length ? (
          financial.map((s) => <SignalRow key={String(s.id)} signal={s} />)
        ) : (
          <EmptyLine text="Nothing financial needs you." />
        )}
      </MovementSection>
    </MovementScreen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  name: { fontSize: 14, flex: 1 },
  meta: { fontSize: 12, letterSpacing: 0.3 },
  conflict: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8 },
  conflictText: { fontSize: 14, lineHeight: 19 },
});
