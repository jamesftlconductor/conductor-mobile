// THE WELLNESS MOVEMENT — swipe LEFT from The Conductor. "your health, considered".
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useUserId, useHouseholdId } from '@/hooks/useUserId';
import { useTheme } from '@/app/theme';
import { fetchHealthSnapshot, type HealthSnapshot } from '@/components/HealthContext';
import {
  MovementScreen,
  MovementSection,
  EmptyLine,
  ConnectPrompt,
} from '@/components/MovementScreen';
import { fetchMovement, MovementApiResponse } from '@/utils/movementApi';

export default function MovementWellnessScreen() {
  const userId = useUserId();
  const householdId = useHouseholdId();
  const { theme, accentColor } = useTheme();
  const [data, setData] = useState<MovementApiResponse>({});
  // On-device HealthKit fallback so we don't regress device vitals when the
  // backend hasn't synced health data yet.
  const [device, setDevice] = useState<HealthSnapshot | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const res = await fetchMovement('wellness', householdId, userId);
      if (!cancelled) setData(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, householdId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchHealthSnapshot().catch(() => null);
      if (!cancelled) setDevice(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const apiHealth = data.healthSnapshot ?? null;
  const medical = data.medicalAppointments ?? [];
  const meds = data.medicationReminders ?? [];
  const deviceHasHealth =
    !!device &&
    (device.sleep.duration != null ||
      device.hrv.current != null ||
      device.restingHR != null ||
      device.steps > 0);
  const hasHealth = !!apiHealth || deviceHasHealth;

  const vital = (label: string, value: string | null) =>
    value ? (
      <View style={styles.vital} key={label}>
        <Text style={[styles.vitalVal, { color: theme.text }]}>{value}</Text>
        <Text style={[styles.vitalLabel, { color: theme.muted }]}>{label}</Text>
      </View>
    ) : null;

  return (
    <MovementScreen movementKey="wellness">
      {!hasHealth ? (
        <ConnectPrompt
          text="Connect Apple Health to activate this movement →"
          onPress={() => router.push('/(tabs)/settings' as never)}
        />
      ) : (
        <MovementSection title="Vitals">
          <View style={styles.vitalsRow}>
            {apiHealth ? (
              <>
                {vital('HRV', apiHealth.hrv != null ? `${Math.round(apiHealth.hrv)}ms` : null)}
                {vital('SLEEP', apiHealth.sleepHours != null ? `${apiHealth.sleepHours.toFixed(1)}h` : null)}
                {vital('READINESS', apiHealth.readiness != null ? `${Math.round(apiHealth.readiness)}` : null)}
              </>
            ) : (
              <>
                {vital('SLEEP', device?.sleep.duration != null ? `${device.sleep.duration.toFixed(1)}h` : null)}
                {vital('HRV', device?.hrv.current != null ? `${Math.round(device.hrv.current)}ms` : null)}
                {vital('RESTING HR', device?.restingHR != null ? `${Math.round(device.restingHR)}` : null)}
                {vital('STEPS', device && device.steps > 0 ? `${device.steps.toLocaleString()}` : null)}
              </>
            )}
          </View>
        </MovementSection>
      )}

      <MovementSection title="Medical">
        {medical.length ? (
          medical.map((a, i) => (
            <View key={i} style={styles.line}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {a.title || a.description || 'Appointment'}
              </Text>
              {!!a.date && <Text style={[styles.meta, { color: accentColor }]}>{a.date}</Text>}
            </View>
          ))
        ) : (
          <EmptyLine text="No medical appointments upcoming." />
        )}
      </MovementSection>

      <MovementSection title="Medications">
        {meds.length ? (
          meds.map((m, i) => (
            <View key={i} style={styles.line}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {m.name}
              </Text>
              {!!m.schedule && <Text style={[styles.meta, { color: theme.muted }]}>{m.schedule}</Text>}
            </View>
          ))
        ) : (
          <EmptyLine text="No medication reminders." />
        )}
      </MovementSection>
    </MovementScreen>
  );
}

const styles = StyleSheet.create({
  vitalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  vital: { minWidth: 70 },
  vitalVal: { fontSize: 22, fontWeight: '700' },
  vitalLabel: { fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
  name: { fontSize: 14, flex: 1 },
  meta: { fontSize: 12, letterSpacing: 0.3 },
});
