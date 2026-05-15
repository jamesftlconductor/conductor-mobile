import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';

const BG = '#0f0f0f';
const OFF_WHITE = '#f0ede8';
const MUTED = '#5a5855';
const BRASS = '#b8960c';

const DAY_MS = 24 * 60 * 60 * 1000;

type Activity = { name?: string; schedule?: string; location?: string };
type School = { name?: string; pickupTime?: string };
type Vet = { name?: string; phone?: string };
type UpcomingEvent = { description?: string; date?: string };

type Child = {
  memberType: 'child';
  name?: string | null;
  age?: number | null;
  activities?: Activity[];
  school?: School | null;
  upcomingEvents?: UpcomingEvent[];
  birthday?: string | null;
  anniversary?: string | null;
};

type Pet = {
  memberType: 'pet';
  name?: string | null;
  type?: 'dog' | 'cat' | 'other' | null;
  breed?: string | null;
  vet?: Vet | null;
  upcomingEvents?: UpcomingEvent[];
  birthday?: string | null;
  anniversary?: string | null;
};

type CrewMember = Child | Pet;

function isWithinNext14Days(dateStr?: string): boolean {
  if (!dateStr) return false;
  const ms = Date.parse(dateStr);
  if (isNaN(ms)) return false;
  const diff = ms - Date.now();
  return diff >= -DAY_MS && diff <= 14 * DAY_MS;
}

function formatEventDate(dateStr?: string): string {
  if (!dateStr) return '';
  const ms = Date.parse(dateStr);
  if (isNaN(ms)) return dateStr;
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// MM-DD anchored helpers — birthdays and anniversaries are stored
// without a year, so we compute days until the NEXT occurrence
// (wrapping to next year if the date has already passed this year).
function daysUntilMMDD(mmDd?: string | null): number | null {
  if (!mmDd || !/^\d{2}-\d{2}$/.test(mmDd)) return null;
  const [mm, dd] = mmDd.split('-').map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let candidate = new Date(now.getFullYear(), mm - 1, dd);
  if (candidate.getTime() < today.getTime()) {
    candidate = new Date(now.getFullYear() + 1, mm - 1, dd);
  }
  return Math.round((candidate.getTime() - today.getTime()) / DAY_MS);
}

function formatMMDD(mmDd?: string | null): string {
  if (!mmDd || !/^\d{2}-\d{2}$/.test(mmDd)) return mmDd || '';
  const [mm, dd] = mmDd.split('-').map(Number);
  return new Date(2000, mm - 1, dd).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}

function CelebrationRow({
  emoji,
  label,
  mmDd,
}: {
  emoji: string;
  label: string;
  mmDd: string;
}) {
  const days = daysUntilMMDD(mmDd);
  const isUpcoming = days != null && days <= 30;
  return (
    <View style={styles.row}>
      <Text style={styles.rowEmoji}>{emoji}</Text>
      <View style={styles.rowBody}>
        <Text style={[styles.rowText, isUpcoming && styles.rowTextBrass]}>
          {label}: {formatMMDD(mmDd)}
        </Text>
        {days === 0 ? (
          <Text style={styles.rowMetaBrass}>Today</Text>
        ) : days === 1 ? (
          <Text style={[styles.rowMeta, styles.rowMetaBrass]}>Tomorrow</Text>
        ) : isUpcoming ? (
          <Text style={[styles.rowMeta, styles.rowMetaBrass]}>in {days} days</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function CrewScreen() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/signals?type=crew&userId=${USER_ID}`);
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.crew)) setCrew(json.crew);
    } catch {
      // best-effort — leave existing state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const children = crew.filter((m): m is Child => m.memberType === 'child');
  const pets = crew.filter((m): m is Pet => m.memberType === 'pet');
  const isEmpty = !loading && children.length === 0 && pets.length === 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={MUTED}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }>
      <TouchableOpacity
        onPress={() => router.back()}
        activeOpacity={0.6}
        style={styles.topBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.topBackText}>← Return</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Crew</Text>
      <Text style={styles.subtitle}>Who Conductor is watching over</Text>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={MUTED} />
        </View>
      )}

      {isEmpty && (
        <Text style={styles.empty}>
          Conductor hasn&apos;t found any crew members yet. They surface as your history is scanned.
        </Text>
      )}

      {children.length > 0 && (
        <>
          <Text style={styles.sectionHeader}>Children</Text>
          {children.map((c, i) => (
            <ChildCard key={`child-${i}`} child={c} />
          ))}
        </>
      )}

      {pets.length > 0 && (
        <>
          <Text style={[styles.sectionHeader, { marginTop: 32 }]}>Pets</Text>
          {pets.map((p, i) => (
            <PetCard key={`pet-${i}`} pet={p} />
          ))}
        </>
      )}

    </ScrollView>
  );
}

function ChildCard({ child }: { child: Child }) {
  const name = child.name || 'Child';
  const activities = (child.activities || []).filter((a) => a && a.name);
  const events = (child.upcomingEvents || []).filter((e) => e && e.description);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{name}</Text>
        {typeof child.age === 'number' ? (
          <Text style={styles.cardAge}>age {child.age}</Text>
        ) : null}
      </View>

      {activities.map((a, i) => (
        <View key={`act-${i}`} style={styles.row}>
          <Text style={styles.rowEmoji}>🏃</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowText}>{a.name}</Text>
            {a.schedule ? <Text style={styles.rowMeta}>{a.schedule}</Text> : null}
            {a.location ? <Text style={styles.rowMeta}>{a.location}</Text> : null}
          </View>
        </View>
      ))}

      {child.school && child.school.name ? (
        <View style={styles.row}>
          <Text style={styles.rowEmoji}>🏫</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowText}>{child.school.name}</Text>
            {child.school.pickupTime ? (
              <Text style={styles.rowMeta}>Pickup {child.school.pickupTime}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {child.birthday ? (
        <CelebrationRow emoji="🎂" label="Birthday" mmDd={child.birthday} />
      ) : null}
      {child.anniversary ? (
        <CelebrationRow emoji="💍" label="Anniversary" mmDd={child.anniversary} />
      ) : null}

      {events.length > 0 ? (
        <View style={styles.eventsBlock}>
          {events.map((e, i) => {
            const soon = isWithinNext14Days(e.date);
            return (
              <View key={`ev-${i}`} style={styles.row}>
                <Text style={styles.rowEmoji}>📅</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{e.description}</Text>
                  {e.date ? (
                    <Text style={[styles.rowMeta, soon && styles.rowMetaBrass]}>
                      {formatEventDate(e.date)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function PetCard({ pet }: { pet: Pet }) {
  const name = pet.name || 'Pet';
  const typeLabel =
    pet.type && pet.breed
      ? `${pet.type}, ${pet.breed}`
      : pet.type || pet.breed || '';
  const events = (pet.upcomingEvents || []).filter((e) => e && e.description);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>🐾 {name}</Text>
        {typeLabel ? <Text style={styles.cardAge}>{typeLabel}</Text> : null}
      </View>

      {pet.vet && pet.vet.name ? (
        <View style={styles.row}>
          <Text style={styles.rowEmoji}>🩺</Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowText}>{pet.vet.name}</Text>
            {pet.vet.phone ? <Text style={styles.rowMeta}>{pet.vet.phone}</Text> : null}
          </View>
        </View>
      ) : null}

      {pet.birthday ? (
        <CelebrationRow emoji="🎂" label="Birthday" mmDd={pet.birthday} />
      ) : null}
      {pet.anniversary ? (
        <CelebrationRow emoji="💍" label="Anniversary" mmDd={pet.anniversary} />
      ) : null}

      {events.length > 0 ? (
        <View style={styles.eventsBlock}>
          {events.map((e, i) => {
            const soon = isWithinNext14Days(e.date);
            return (
              <View key={`ev-${i}`} style={styles.row}>
                <Text style={styles.rowEmoji}>📅</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.rowText}>{e.description}</Text>
                  {e.date ? (
                    <Text style={[styles.rowMeta, soon && styles.rowMetaBrass]}>
                      {formatEventDate(e.date)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  title: {
    color: OFF_WHITE,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.3,
    marginTop: 6,
    marginBottom: 28,
  },
  loading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  empty: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  sectionHeader: {
    color: BRASS,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: BRASS,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardName: {
    color: OFF_WHITE,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  cardAge: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  rowEmoji: {
    fontSize: 16,
    lineHeight: 22,
    width: 20,
    textAlign: 'center',
  },
  rowBody: {
    flex: 1,
  },
  rowText: {
    color: OFF_WHITE,
    fontSize: 14,
    lineHeight: 20,
  },
  rowTextBrass: {
    color: BRASS,
  },
  rowMeta: {
    color: MUTED,
    fontSize: 12,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  rowMetaBrass: {
    color: BRASS,
  },
  eventsBlock: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  topBack: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  topBackText: {
    color: MUTED,
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
