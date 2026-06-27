// One-at-a-time interview questions at the bottom of each Movement screen.
// Shows the first unanswered question for the movement; on answer it fades out
// (with a checkmark), persists to AsyncStorage + preferences, then fades the
// next one in. When all are answered it shows a small completion line.

import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check } from 'lucide-react-native';

import { useTheme } from '@/app/theme';
import { useUserId } from '@/hooks/useUserId';
import { MOVEMENTS, MovementKey } from '@/utils/movements';
import {
  MOVEMENT_QUESTIONS,
  MovementQuestion as Question,
  QuestionAnswer,
} from '@/utils/movementQuestions';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

export function MovementQuestions({ movementKey }: { movementKey: MovementKey }) {
  const { theme, accentColor } = useTheme();
  const userId = useUserId();
  const questions = MOVEMENT_QUESTIONS[movementKey] ?? [];
  const storageKey = `movement:${movementKey}:questionsAnswered`;
  // null = still loading from storage (render nothing yet).
  const [answered, setAnswered] = useState<Record<string, QuestionAnswer> | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (cancelled) return;
        try {
          setAnswered(raw ? (JSON.parse(raw) as Record<string, QuestionAnswer>) : {});
        } catch {
          setAnswered({});
        }
      })
      .catch(() => {
        if (!cancelled) setAnswered({});
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  if (answered === null) return null;

  const next = questions.find((q) => !(q.id in answered));
  const label = MOVEMENTS.find((m) => m.key === movementKey)?.label ?? 'This';

  const onAnswer = (q: Question, value: QuestionAnswer) => {
    const updated = { ...answered, [q.id]: value };
    setAnswered(updated);
    AsyncStorage.setItem(storageKey, JSON.stringify(updated)).catch(() => {});
    if (userId) {
      fetch(`${API_BASE}/signals?type=preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          preferences: { movementAnswers: { [`${movementKey}:${q.id}`]: value } },
        }),
      }).catch(() => {});
    }
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: accentColor }]}>Tell The Conductor</Text>
      <View style={[styles.divider, { backgroundColor: accentColor + '1f' }]} />
      {next ? (
        <QuestionCard
          key={next.id}
          question={next}
          accentColor={accentColor}
          muted={theme.muted}
          onAnswer={(v) => onAnswer(next, v)}
        />
      ) : (
        <Text style={[styles.complete, { color: accentColor }]}>
          ✓ {label} profile complete
        </Text>
      )}
    </View>
  );
}

function QuestionCard({
  question,
  accentColor,
  muted,
  onAnswer,
}: {
  question: Question;
  accentColor: string;
  muted: string;
  onAnswer: (value: QuestionAnswer) => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null); // single+text picked option
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);

  // Fade in on mount (also when the next question replaces this one via key).
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [opacity]);

  const finish = (value: QuestionAnswer) => {
    if (done) return;
    setDone(true);
    Animated.timing(opacity, { toValue: 0, duration: 280, useNativeDriver: true }).start(() => {
      onAnswer(value);
    });
  };

  const onPill = (opt: string) => {
    if (done) return;
    if (question.type === 'multi') {
      setMultiSel((s) => (s.includes(opt) ? s.filter((x) => x !== opt) : [...s, opt]));
      return;
    }
    if (question.type === 'single+text' && opt === question.followUpOn) {
      setChosen(opt); // reveal the follow-up text input; don't finish yet
      return;
    }
    if (question.type === 'single+text') {
      finish({ option: opt });
      return;
    }
    finish(opt); // plain single
  };

  const showText = question.type === 'single+text' && chosen === question.followUpOn;

  return (
    <Animated.View style={[styles.card, { borderColor: accentColor + '66', opacity }]}>
      {done ? (
        <View style={styles.checkWrap}>
          <Check size={16} color={accentColor} />
        </View>
      ) : null}
      <Text style={styles.prompt}>{question.prompt}</Text>
      <Text style={[styles.why, { color: muted }]}>{question.why}</Text>

      <View style={styles.pills}>
        {question.options.map((opt) => {
          const active = question.type === 'multi' ? multiSel.includes(opt) : chosen === opt;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onPill(opt)}
              activeOpacity={0.7}
              style={[
                styles.pill,
                { borderColor: accentColor + (active ? 'ff' : '4d') },
                active ? { backgroundColor: accentColor + '22' } : null,
              ]}>
              <Text style={[styles.pillText, { color: active ? accentColor : '#ffffff' }]}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showText ? (
        <View style={styles.textRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={question.followUpPlaceholder}
            placeholderTextColor={muted}
            style={[styles.input, { borderColor: accentColor + '4d' }]}
          />
          <TouchableOpacity
            onPress={() => finish({ option: chosen as string, text: text.trim() })}
            style={[styles.actionBtn, { borderColor: accentColor }]}>
            <Text style={[styles.actionText, { color: accentColor }]}>Save</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {question.type === 'multi' ? (
        <TouchableOpacity
          onPress={() => multiSel.length > 0 && finish(multiSel)}
          disabled={multiSel.length === 0}
          style={[
            styles.actionBtn,
            styles.multiDone,
            { borderColor: accentColor, opacity: multiSel.length ? 1 : 0.4 },
          ]}>
          <Text style={[styles.actionText, { color: accentColor }]}>Done</Text>
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  divider: { height: 1, marginTop: 8, marginBottom: 10 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  checkWrap: { position: 'absolute', top: 10, right: 10 },
  prompt: { color: '#ffffff', fontSize: 15, fontWeight: '500', lineHeight: 20 },
  why: { fontSize: 12, fontStyle: 'italic', marginTop: 4, lineHeight: 16 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pill: { borderWidth: 1, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 14 },
  pillText: { fontSize: 13, fontWeight: '500' },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#ffffff',
    fontSize: 14,
  },
  actionBtn: { borderWidth: 1, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 16 },
  actionText: { fontSize: 13, fontWeight: '600' },
  multiDone: { alignSelf: 'flex-start', marginTop: 12 },
  complete: { fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },
});
