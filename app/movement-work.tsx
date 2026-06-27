// THE WORK MOVEMENT — swipe RIGHT from The Conductor. "your schedule, protected".
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useUserId } from '@/hooks/useUserId';
import { categoryForType } from '@/utils/signalCategories';
import {
  MovementScreen,
  MovementSection,
  SignalRow,
  EmptyLine,
  ConnectPrompt,
  MovementSignal,
} from '@/components/MovementScreen';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

export default function MovementWorkScreen() {
  const userId = useUserId();
  const [signals, setSignals] = useState<MovementSignal[]>([]);
  const [workCalName, setWorkCalName] = useState<string>('');

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [sigRes, prefRes] = await Promise.all([
          fetch(`${API_BASE}/signals?userId=${userId}`),
          fetch(`${API_BASE}/signals?type=preferences&userId=${userId}`),
        ]);
        const sigData = await sigRes.json();
        const prefData = await prefRes.json();
        if (cancelled) return;
        setSignals(
          (sigData.signals || []).filter(
            (s: MovementSignal) => !s.state || s.state === 'incoming' || s.state === 'active',
          ),
        );
        setWorkCalName(String(prefData?.preferences?.workCalendarName || '').trim());
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const connected = workCalName.length > 0;
  const deadlines = signals.filter((s) => categoryForType(s.type) === 'deadline');
  const financial = signals.filter((s) => categoryForType(s.type) === 'financial');
  const load = deadlines.length + financial.length;
  const loadLabel =
    load === 0 ? 'Light' : load <= 3 ? 'Moderate' : load <= 6 ? 'Busy' : 'Heavy';

  return (
    <MovementScreen movementKey="work">
      {!connected ? (
        <ConnectPrompt
          text="Connect your work calendar to activate this movement →"
          onPress={() => router.push('/(tabs)/settings?hub=score' as never)}
        />
      ) : (
        <MovementSection title="Today's Calendar">
          <EmptyLine text={`Connected to ${workCalName}.`} />
        </MovementSection>
      )}

      <MovementSection title="Your Week">
        <EmptyLine text={`${loadLabel} — ${load} work-related signal${load === 1 ? '' : 's'} this week.`} />
      </MovementSection>

      <MovementSection title="Deadlines">
        {deadlines.length ? (
          deadlines.map((s) => <SignalRow key={String(s.id)} signal={s} />)
        ) : (
          <EmptyLine text="No work deadlines flagged." />
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
