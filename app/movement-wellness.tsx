// THE WELLNESS MOVEMENT — swipe LEFT from The Conductor. "your health, considered".
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useUserId } from '@/hooks/useUserId';
import { useTheme } from '@/app/theme';
import { fetchHealthSnapshot, type HealthSnapshot } from '@/components/HealthContext';
import {
  MovementScreen,
  MovementSection,
  SignalRow,
  EmptyLine,
  ConnectPrompt,
  MovementSignal,
} from '@/components/MovementScreen';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

export default function MovementWellnessScreen() {
  const userId = useUserId();
  const { theme, accentColor } = useTheme();
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [signals, setSignals] = useState<MovementSignal[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchHealthSnapshot().catch(() => null);
      if (!cancelled) setSnap(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?userId=${userId}`);
        const data = await res.json();
        if (cancelled) return;
        setSignals(
          (data.signals || []).filter(
            (sig: MovementSignal) => !sig.state || sig.state === 'incoming' || sig.state === 'active',
          ),
        );
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const hasHealth =
    !!snap &&
    (snap.sleep.duration != null ||
      snap.hrv.current != null ||
      snap.restingHR != null ||
      snap.steps > 0);

  const medical = signals.filter((s) =>
    /medical|appointment|doctor|prescription|medication|refill|pharmacy|dentist|clinic/i.test(
      `${s.type || ''} ${s.description || ''}`,
    ),
  );
  const meds = medical.filter((s) => /medication|refill|prescription|pharmacy/i.test(`${s.description || ''}`));

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
            {vital('SLEEP', snap?.sleep.duration != null ? `${snap.sleep.duration.toFixed(1)}h` : null)}
            {vital('HRV', snap?.hrv.current != null ? `${Math.round(snap.hrv.current)}ms` : null)}
            {vital('RESTING HR', snap?.restingHR != null ? `${Math.round(snap.restingHR)}` : null)}
            {vital('STEPS', snap && snap.steps > 0 ? `${snap.steps.toLocaleString()}` : null)}
          </View>
          {snap?.hrv.current != null && snap?.hrv.baseline7d != null ? (
            <Text style={[styles.obs, { color: theme.muted }]}>
              {snap.hrv.current >= snap.hrv.baseline7d
                ? 'HRV is at or above your 7-day baseline — recovery looks good.'
                : 'HRV is below your 7-day baseline — consider an easier day.'}
            </Text>
          ) : null}
        </MovementSection>
      )}

      <MovementSection title="Medical">
        {medical.length ? (
          medical.map((s) => <SignalRow key={String(s.id)} signal={s} />)
        ) : (
          <EmptyLine text="No medical appointments upcoming." />
        )}
      </MovementSection>

      <MovementSection title="Medications">
        {meds.length ? (
          meds.map((s) => <SignalRow key={String(s.id)} signal={s} />)
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
  obs: { fontSize: 13, lineHeight: 19, marginTop: 14, fontStyle: 'italic' },
});
