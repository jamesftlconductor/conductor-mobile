// THE FAMILY MOVEMENT — swipe DOWN from The Conductor.
// "the people in your life" — all crew (partner, kids, extended, pets).
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useUserId } from '@/hooks/useUserId';
import { useTheme } from '@/app/theme';
import {
  MovementScreen,
  MovementSection,
  SignalRow,
  EmptyLine,
  MovementSignal,
} from '@/components/MovementScreen';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

type CrewMember = {
  name: string;
  photoUrl?: string | null;
  memberType?: string;
  birthday?: string | null;
  anniversary?: string | null;
  school?: { name?: string } | null;
  activities?: { name?: string }[];
};

export default function MovementFamilyScreen() {
  const userId = useUserId();
  const { theme, accentColor } = useTheme();
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [signals, setSignals] = useState<MovementSignal[]>([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const [crewRes, sigRes] = await Promise.all([
          fetch(`${API_BASE}/signals?type=crew&userId=${userId}`),
          fetch(`${API_BASE}/signals?userId=${userId}`),
        ]);
        const crewData = await crewRes.json();
        const sigData = await sigRes.json();
        if (cancelled) return;
        // All household crew — partner, kids, extended family, pets — but not
        // synced Google Contacts (same memberType allowlist the radar uses).
        const ALLOWED = ['member', 'extended', 'child', 'pet'];
        setCrew(
          (Array.isArray(crewData?.crew) ? crewData.crew : []).filter(
            (m: CrewMember) => m && m.name && ALLOWED.includes(m.memberType || ''),
          ),
        );
        setSignals(
          (sigData.signals || []).filter(
            (s: MovementSignal) => !s.state || s.state === 'incoming' || s.state === 'active',
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

  const forMember = (name: string) =>
    signals.filter(
      (s) => s.crewMemberId && String(s.crewMemberId).toLowerCase().trim() === name.toLowerCase().trim(),
    );

  const dates = crew
    .flatMap((m) => [
      m.birthday ? { name: m.name, label: 'Birthday', date: m.birthday } : null,
      m.anniversary ? { name: m.name, label: 'Anniversary', date: m.anniversary } : null,
    ])
    .filter(Boolean) as { name: string; label: string; date: string }[];

  return (
    <MovementScreen movementKey="family">
      <MovementSection title="Crew">
        {crew.length ? (
          crew.map((m) => {
            const sigs = forMember(m.name);
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
                    {!!(m.school?.name || m.activities?.length) && (
                      <Text style={[styles.sub, { color: theme.muted }]} numberOfLines={1}>
                        {[m.school?.name, m.activities?.map((a) => a.name).filter(Boolean).join(', ')]
                          .filter(Boolean)
                          .join('  ·  ')}
                      </Text>
                    )}
                  </View>
                </View>
                {(m.birthday || m.anniversary) && (
                  <View style={styles.occasions}>
                    {m.birthday ? (
                      <Text style={[styles.occasion, { color: accentColor }]} numberOfLines={1}>
                        🎂  Birthday — {m.birthday}
                      </Text>
                    ) : null}
                    {m.anniversary ? (
                      <Text style={[styles.occasion, { color: accentColor }]} numberOfLines={1}>
                        💍  Anniversary — {m.anniversary}
                      </Text>
                    ) : null}
                  </View>
                )}
                {sigs.length > 0 ? (
                  sigs.map((s) => <SignalRow key={String(s.id)} signal={s} />)
                ) : (
                  <Text style={[styles.quiet, { color: theme.muted }]}>All quiet — nothing pending.</Text>
                )}
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
              {`  —  ${d.label}: ${d.date}`}
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
  occasions: { marginTop: 6, marginLeft: 44, gap: 2 },
  occasion: { fontSize: 12, letterSpacing: 0.2 },
  quiet: { fontSize: 12, fontStyle: 'italic', marginTop: 6, marginLeft: 44 },
  dateLine: { fontSize: 13, lineHeight: 20, paddingVertical: 3 },
});
