// THE HOME MOVEMENT — swipe UP from The Conductor. "your house, maintained".
import { useEffect, useState } from 'react';
import { useUserId } from '@/hooks/useUserId';
import { categoryForType } from '@/utils/signalCategories';
import {
  MovementScreen,
  MovementSection,
  SignalRow,
  EmptyLine,
  MovementSignal,
} from '@/components/MovementScreen';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

export default function MovementHomeScreen() {
  const userId = useUserId();
  const [signals, setSignals] = useState<MovementSignal[]>([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?userId=${userId}`);
        const data = await res.json();
        if (cancelled) return;
        const active = (data.signals || []).filter(
          (s: MovementSignal) => !s.state || s.state === 'incoming' || s.state === 'active',
        );
        setSignals(active);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const homeSignals = signals.filter((s) =>
    ['delivery', 'home', 'deadline'].includes(categoryForType(s.type)),
  );
  const services = signals.filter((s) => categoryForType(s.type) === 'service');

  return (
    <MovementScreen movementKey="home">
      <MovementSection title="Active Home Signals">
        {homeSignals.length ? (
          homeSignals.map((s) => <SignalRow key={String(s.id)} signal={s} />)
        ) : (
          <EmptyLine text="Your house is quiet today." />
        )}
      </MovementSection>

      <MovementSection title="Service & Maintenance">
        {services.length ? (
          services.map((s) => <SignalRow key={String(s.id)} signal={s} />)
        ) : (
          <EmptyLine text="No upcoming service appointments." />
        )}
      </MovementSection>
    </MovementScreen>
  );
}
