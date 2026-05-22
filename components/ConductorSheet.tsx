// Root-mounted bottom sheet for The Conductor — the household's
// always-listening intelligence. Opens from any minimap tap or device
// shake; supports context-aware suggestion chips, free-form questions,
// inline answer cards with voice playback, action buttons, and a
// scrollback of recent Q&A pairs (this session only).
//
// State machine:
//   - sheet visibility lives in hooks/useConductorSheet (external store)
//   - per-open input/history/loading state lives here; reset whenever
//     `visible` flips to false so each open is a clean slate
//
// Backdrop arm-delay: the same tap that opens the sheet can carry
// velocity into the SwipeDismissSheet's Pan gesture, immediately
// dismissing it. We gate both the backdrop Pressable and the
// SwipeDismissSheet's `enabled` prop behind a 300ms timer so the
// opening tap can't be the closing tap.

import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTheme } from '@/app/theme';
import { closeConductorSheet, useConductorSheetState } from '@/hooks/useConductorSheet';
import { debugLog } from '@/utils/debugLog';
import { SwipeDismissSheet } from './SwipeDismissSheet';

const USER_ID = 'james_totalhome_gmail_com';
const API_BASE = 'https://conductor-ivory.vercel.app/api';
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_HEIGHT = Math.round(SCREEN_HEIGHT * 0.65);
const MAX_HISTORY_PAIRS = 5;

// Per-context suggestion chips. Default list covers the catch-all
// "user opened from shake / from a non-mapped screen" case.
const SUGGESTIONS: Record<string, string[]> = {
  ground: [
    "What's urgent today?",
    "How's my week looking?",
    "What did Conductor catch?",
    "Tell me a joke",
  ],
  hover: [
    "What's on the radar?",
    "Show me urgent signals",
    "What's Mia's schedule?",
    "Tell me a joke",
  ],
  vault: [
    "What's expiring soon?",
    "What subscriptions do I have?",
    "What's my biggest deadline?",
  ],
  settings: [
    "How do I change my brief time?",
    "What does Conductor see?",
    "How do I add a crew member?",
  ],
  horizon: [
    "What's coming this month?",
    "What deadlines are on the edge?",
    "What's furthest out?",
  ],
  crew: [
    "Who has a birthday coming up?",
    "What does Mia have today?",
    "Show me crew schedules",
  ],
  default: [
    "What's happening today?",
    "Catch me up",
    "What should I handle first?",
    "Tell me a joke",
  ],
};

const CONTEXT_LABEL: Record<string, string> = {
  ground: 'Ground',
  hover: 'Hover',
  horizon: 'Horizon',
  programme: 'Programme',
  calendar: 'Calendar',
  vault: 'Vault',
  crew: 'Crew',
  compass: 'Compass',
  journal: 'Journal',
  inventory: 'Inventory',
  providers: 'Providers',
  maintenance: 'Maintenance',
  network: 'Network',
  directory: 'Directory',
  communicate: 'Communicate',
  transition: 'Transition',
  junior: 'Junior',
  settings: 'Settings',
  'privacy-dashboard': 'Privacy',
  'recurring-events': 'Recurring',
  channel: 'Channel',
  shake: 'Shake',
  'first-brief-question': 'Onboarding',
};

function contextLabelFor(context: string): string {
  return CONTEXT_LABEL[context] || 'Your house';
}

function suggestionsFor(context: string): string[] {
  return SUGGESTIONS[context] || SUGGESTIONS.default;
}

type QAPair = {
  id: number;
  question: string;
  // null while the answer is in flight — lets the UI render the
  // user's question bubble immediately on submit and add the
  // Conductor's response bubble below when the network call
  // resolves, instead of disappearing the question and showing only
  // loading dots.
  answer: string | null;
};

type AskResponse = {
  answer?: string;
  spokenAnswer?: string;
  navigation?: { path: string; label?: string } | null;
  createSignal?: { description?: string } | null;
  isEasterEgg?: boolean;
};

let pairCounter = 1;

export function ConductorSheet() {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const { visible, context } = useConductorSheetState();

  // Per-open state — fully reset whenever the sheet closes so each
  // open is a fresh session. History is intentionally session-scoped
  // (not persisted) — The Conductor isn't a chat log surface.
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<QAPair[]>([]);
  const [actions, setActions] = useState<AskResponse | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const submittingRef = useRef(false);

  // Backdrop arm-delay — same pattern that fixed the open-tap-closes
  // bug. Applied to backdrop Pressable AND SwipeDismissSheet enabled.
  const [backdropActive, setBackdropActive] = useState(false);
  useEffect(() => {
    if (!visible) {
      setBackdropActive(false);
      return;
    }
    const t = setTimeout(() => setBackdropActive(true), 300);
    return () => clearTimeout(t);
  }, [visible]);

  // Reset all per-open state on close + log every visible transition
  // so future regressions are traceable through debugLog.
  useEffect(() => {
    debugLog('Sheet', `visible→${visible} context=${context}`);
    if (!visible) {
      setInput('');
      setHistory([]);
      setActions(null);
      setLoading(false);
      submittingRef.current = false;
      Speech.stop();
    }
  }, [visible, context]);

  // Mount-once log so we can confirm the sheet IS mounted at root.
  useEffect(() => {
    debugLog('Sheet', 'ConductorSheet mounted at root');
    return () => debugLog('Sheet', 'ConductorSheet UNMOUNTED');
  }, []);

  // Auto-scroll to the bottom whenever the history grows OR the
  // pending answer fills in.
  useEffect(() => {
    if (history.length === 0) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [history.length, history[history.length - 1]?.answer]);

  async function submit(rawQuestion: string) {
    const q = rawQuestion.trim();
    if (!q || submittingRef.current) return;
    submittingRef.current = true;
    setInput('');
    setActions(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // Add the user's question to history IMMEDIATELY so it renders
    // as a right-aligned bubble before the network call returns.
    // answer: null marks the pair as pending — the renderer shows
    // loading dots in place of the Conductor bubble.
    const pairId = pairCounter++;
    setHistory((prev) => {
      const next = [...prev, { id: pairId, question: q, answer: null }];
      return next.slice(-MAX_HISTORY_PAIRS);
    });
    setLoading(true);

    let answer: string;
    let data: AskResponse = {};
    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          question: q,
          screenContext: context,
        }),
      });
      data = res.ok ? await res.json() : {};
      answer = typeof data?.answer === 'string' && data.answer.length > 0
        ? data.answer
        : "The Conductor couldn't answer that one. Try rephrasing?";
    } catch (err: any) {
      debugLog('Sheet', `submit failed: ${err?.message || String(err)}`);
      answer = "The Conductor can't reach the network right now.";
    }

    // Fill the pending pair's answer field in place — preserves
    // chronological position even if the user submitted a follow-up
    // while waiting. Match by pairId rather than slot index.
    setHistory((prev) =>
      prev.map((p) => (p.id === pairId ? { ...p, answer } : p)),
    );
    setActions(data || null);
    setLoading(false);
    submittingRef.current = false;

    // Voice playback if the user opted in.
    try {
      const voiceOn = await AsyncStorage.getItem('voiceResponsesEnabled');
      if (voiceOn === 'true') {
        const speakText = (data?.spokenAnswer && data.spokenAnswer.length > 0)
          ? data.spokenAnswer
          : answer;
        Speech.stop();
        Speech.speak(speakText, { rate: 0.88, pitch: 1.0, language: 'en-US' });
      }
    } catch { /* speech is best-effort */ }
  }

  function handleSuggestionTap(text: string) {
    Haptics.selectionAsync().catch(() => {});
    submit(text);
  }

  // Action buttons — only rendered when the response carries an
  // actionable hint. Navigate goes via expo-router and closes the
  // sheet; Create signal opens the AddSignalSheet by routing to the
  // host screen (Ground handles AddSignalSheet rendering).
  function actNavigate() {
    if (!actions?.navigation?.path) return;
    closeConductorSheet();
    setTimeout(() => router.push(actions.navigation!.path as never), 120);
  }
  function actCreateSignal() {
    closeConductorSheet();
    // The AddSignalSheet is mounted on Ground; routing there with a
    // query param lets that screen surface the composer on focus.
    setTimeout(() => router.push('/(tabs)?addSignal=1' as never), 120);
  }
  function actGotIt() {
    setActions(null);
  }

  const chips = suggestionsFor(context);
  const latestPair = history.length > 0 ? history[history.length - 1] : null;
  // Index of the first Conductor response across the visible history,
  // used to decide where to render the "THE CONDUCTOR" label.
  const firstAnsweredIdx = history.findIndex((p) => p.answer !== null);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={closeConductorSheet}>
      <Pressable
        style={styles.backdrop}
        onPress={backdropActive ? closeConductorSheet : undefined}>
        <SwipeDismissSheet
          style={[styles.sheet, { height: SHEET_HEIGHT }]}
          onClose={closeConductorSheet}
          enabled={backdropActive}>
          <Pressable onPress={() => {}} style={{ flex: 1 }}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              // The sheet sits at the bottom of the screen (height
              // SHEET_HEIGHT). KAV measures keyboard height against
              // the screen, so we don't need a screen-relative
              // offset — but a small offset prevents a one-pixel
              // gap on devices with a home indicator.
              keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
              style={{ flex: 1 }}>
              {/* Header */}
              <View style={styles.headerRow}>
                <Text style={styles.title}>The Conductor</Text>
                <View style={styles.contextPill}>
                  <Text style={styles.contextPillText}>📍 {contextLabelFor(context)}</Text>
                </View>
              </View>
              <View style={styles.divider} />

              {/* Suggestion chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsRow}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                {chips.map((chip) => (
                  <TouchableOpacity
                    key={chip}
                    onPress={() => handleSuggestionTap(chip)}
                    activeOpacity={0.6}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    style={styles.chip}>
                    <Text style={styles.chipText}>{chip}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Conversation area — chat bubbles. Each pair renders
                  a user bubble (right-aligned, accent) immediately on
                  submit; the Conductor bubble (left-aligned, surface)
                  appears below when answer fills in. While answer is
                  null, loading dots render in place of the response
                  bubble. */}
              <ScrollView
                ref={scrollRef}
                style={styles.conversation}
                contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}>
                {history.map((p, idx) => (
                  <View key={p.id}>
                    {/* User bubble — always rendered */}
                    <View style={styles.userBubbleRow}>
                      <View style={styles.userBubble}>
                        <Text style={styles.userBubbleText}>{p.question}</Text>
                      </View>
                    </View>

                    {/* Conductor bubble OR loading dots */}
                    {p.answer === null ? (
                      <View style={styles.conductorBubbleRow}>
                        <LoadingDots accentColor={accentColor} />
                      </View>
                    ) : (
                      <View style={styles.conductorBubbleRow}>
                        <View style={{ maxWidth: '75%' }}>
                          {idx === firstAnsweredIdx ? (
                            <Text style={styles.conductorLabel}>THE CONDUCTOR</Text>
                          ) : null}
                          <View style={styles.conductorBubble}>
                            <Text style={styles.conductorBubbleText}>{p.answer}</Text>
                          </View>
                          {/* Action buttons attach to the latest
                              answered pair only. */}
                          {idx === history.length - 1
                            && (actions?.navigation || actions?.createSignal) ? (
                            <View style={styles.actionRow}>
                              {actions?.navigation?.path ? (
                                <TouchableOpacity
                                  onPress={actNavigate}
                                  activeOpacity={0.6}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                  style={styles.actionBtn}>
                                  <Text style={styles.actionBtnText}>
                                    {actions.navigation.label || 'Navigate'} →
                                  </Text>
                                </TouchableOpacity>
                              ) : null}
                              {actions?.createSignal ? (
                                <TouchableOpacity
                                  onPress={actCreateSignal}
                                  activeOpacity={0.6}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                  style={styles.actionBtn}>
                                  <Text style={styles.actionBtnText}>Create signal</Text>
                                </TouchableOpacity>
                              ) : null}
                              <TouchableOpacity
                                onPress={actGotIt}
                                activeOpacity={0.6}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                style={[styles.actionBtn, styles.actionBtnGhost]}>
                                <Text style={styles.actionBtnGhostText}>Got it</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>

              {/* Input bar */}
              <View style={styles.inputBar}>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    inputRef.current?.focus();
                  }}
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.micBtn}>
                  <Text style={styles.micGlyph}>🎙</Text>
                </TouchableOpacity>
                <TextInput
                  ref={inputRef}
                  value={input}
                  onChangeText={setInput}
                  onSubmitEditing={() => submit(input)}
                  placeholder="Ask The Conductor anything..."
                  placeholderTextColor={theme.muted}
                  returnKeyType="send"
                  blurOnSubmit={false}
                  style={styles.input}
                  autoCorrect
                  autoComplete="off"
                  textContentType="none"
                />
                <TouchableOpacity
                  onPress={() => submit(input)}
                  disabled={!input.trim() || loading}
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[
                    styles.sendBtn,
                    { backgroundColor: input.trim() && !loading ? accentColor : theme.muted },
                  ]}>
                  <Text style={styles.sendGlyph}>↑</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </SwipeDismissSheet>
      </Pressable>
    </Modal>
  );
}

// Three accent-colored dots that pulse in sequence while a question
// is in flight. Sits in the conversation pane in place of the answer
// card so the layout doesn't jump on response.
function LoadingDots({ accentColor }: { accentColor: string }) {
  const a = useRef(new Animated.Value(0.3)).current;
  const b = useRef(new Animated.Value(0.3)).current;
  const c = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    function pulse(v: Animated.Value, delay: number) {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
    }
    const loops = [pulse(a, 0), pulse(b, 150), pulse(c, 300)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a, b, c]);
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 24, gap: 8 }}>
      {[a, b, c].map((v, i) => (
        <Animated.View
          key={i}
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accentColor, opacity: v }}
        />
      ))}
    </View>
  );
}

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  card?: string;
};

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 10,
    },
    title: {
      color: accentColor,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.1,
    },
    contextPill: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: theme.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border || 'rgba(255,255,255,0.08)',
    },
    contextPillText: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 0.2,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border || 'rgba(255,255,255,0.08)',
    },
    chipsRow: {
      flexGrow: 0,
      paddingVertical: 12,
    },
    chip: {
      borderWidth: 1,
      borderColor: accentColor,
      borderRadius: 16,
      paddingVertical: 6,
      paddingHorizontal: 14,
    },
    chipText: {
      color: accentColor,
      fontSize: 11,
      fontWeight: '500',
      letterSpacing: 0.2,
    },
    conversation: {
      flex: 1,
    },
    // User bubble — right-aligned, accent background, asymmetric
    // radius (sharp corner toward sender). max width 75% of column.
    userBubbleRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 10,
      marginBottom: 4,
    },
    userBubble: {
      maxWidth: '75%',
      backgroundColor: accentColor,
      borderRadius: 16,
      borderBottomRightRadius: 4,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    userBubbleText: {
      color: '#ffffff',
      fontSize: 14,
      lineHeight: 20,
    },
    // Conductor bubble — left-aligned, surface background, sharp
    // corner toward sender (bottom-left).
    conductorBubbleRow: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      marginTop: 4,
      marginBottom: 12,
    },
    conductorLabel: {
      color: accentColor,
      fontSize: 10,
      letterSpacing: 2,
      fontWeight: '600',
      marginBottom: 4,
      marginLeft: 4,
    },
    conductorBubble: {
      backgroundColor: theme.background,
      borderRadius: 16,
      borderBottomLeftRadius: 4,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border || 'rgba(255,255,255,0.08)',
    },
    conductorBubbleText: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 20,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 14,
    },
    actionBtn: {
      borderWidth: 1,
      borderColor: accentColor,
      borderRadius: 16,
      paddingVertical: 6,
      paddingHorizontal: 14,
    },
    actionBtnText: {
      color: accentColor,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
    actionBtnGhost: {
      borderColor: theme.muted,
    },
    actionBtnGhostText: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '500',
    },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border || 'rgba(255,255,255,0.08)',
      backgroundColor: theme.surface,
      gap: 8,
    },
    micBtn: {
      padding: 4,
    },
    micGlyph: {
      fontSize: 18,
    },
    input: {
      flex: 1,
      color: theme.text,
      fontSize: 14,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 36,
    },
    sendBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendGlyph: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: '700',
    },
  });
}
