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
import { useUserId } from '@/hooks/useUserId';
import { debugLog } from '@/utils/debugLog';
import { SwipeDismissSheet } from './SwipeDismissSheet';

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

// Flat role-keyed message list. The user message is pushed
// immediately on submit; the conductor message is pushed when the
// network call resolves. Decoupling user/conductor entries lets us
// render either side independently without the renderer guessing
// which "half" of a pair a row represents.
type Message =
  | { role: 'user'; id: number; text: string }
  | { role: 'conductor'; id: number; text: string; showLabel?: boolean };

type ActionPayload =
  | { type: 'navigate'; destination: string }
  | { type: 'navigate_offer'; destination: string }
  | { type: 'confirm_setting'; setting: string; value: any; label: string }
  | { type: 'signal_created'; signal: { id: number; description: string; eta?: string | null } }
  | { type: 'setting_changed'; settingKey: string; newValue: any; label: string; detail: string }
  | { type: 'signal_resolved'; signal: { id: number; description: string } }
  | { type: 'resolve_disambiguate'; target: string; candidates: Array<{ id: number; description: string }> }
  | { type: 'resolve_not_found'; target: string };

type AskResponse = {
  answer?: string;
  spokenAnswer?: string;
  action?: ActionPayload | null;
  isEasterEgg?: boolean;
};

let msgCounter = 1;

export function ConductorSheet() {
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const { visible, context } = useConductorSheetState();

  // Per-open state — fully reset whenever the sheet closes so each
  // open is a fresh session. History is intentionally session-scoped
  // (not persisted) — The Conductor isn't a chat log surface.
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
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
      setMessages([]);
      setActions(null);
      setLoading(false);
      submittingRef.current = false;
      Speech.stop();
    }
  }, [visible, context]);

  // Auto-focus the input when the sheet opens — the type bar is now the
  // dominant, primary element, so the keyboard should be ready to go. The
  // delay clears the slide-in animation before focusing.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [visible]);

  // Mount-once log so we can confirm the sheet IS mounted at root.
  useEffect(() => {
    debugLog('Sheet', 'ConductorSheet mounted at root');
    return () => debugLog('Sheet', 'ConductorSheet UNMOUNTED');
  }, []);

  // Auto-scroll to the bottom whenever a new message lands.
  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  async function submit(rawQuestion: string) {
    const q = rawQuestion.trim();
    debugLog('Sheet', `submit("${q.slice(0, 40)}") submitting=${submittingRef.current}`);
    if (!q || submittingRef.current) return;
    submittingRef.current = true;
    setInput('');
    setActions(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // 1. Push the user bubble IMMEDIATELY so it renders before the
    //    network call returns.
    setMessages((prev) => {
      const next: Message[] = [...prev, { role: 'user', id: msgCounter++, text: q }];
      return next.slice(-MAX_HISTORY_PAIRS * 2);
    });
    setLoading(true);

    // 2. Fire the network call and resolve the answer.
    let answer: string;
    let data: AskResponse = {};
    try {
      const res = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
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

    // 3. Push the conductor bubble. showLabel flags the first
    //    Conductor response in the thread so we render the "THE
    //    CONDUCTOR" label once, not above every bubble.
    setMessages((prev) => {
      const hasConductorAlready = prev.some((m) => m.role === 'conductor');
      const next: Message[] = [
        ...prev,
        { role: 'conductor', id: msgCounter++, text: answer, showLabel: !hasConductorAlready },
      ];
      return next.slice(-MAX_HISTORY_PAIRS * 2);
    });
    setActions(data || null);
    setLoading(false);
    submittingRef.current = false;

    // Auto-navigate when The Conductor returned a hard navigate action
    // (vs. an offer). The confirmation bubble briefly shows the answer
    // ("Opening your vault.") then we close + push.
    if (data?.action?.type === 'navigate' && data.action.destination) {
      const dest = data.action.destination;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setTimeout(() => {
        closeConductorSheet();
        setTimeout(() => router.push(dest as never), 120);
      }, 400);
    }

    // Success haptic for committed actions so the user feels the change.
    if (
      data?.action?.type === 'signal_created' ||
      data?.action?.type === 'setting_changed' ||
      data?.action?.type === 'signal_resolved'
    ) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }

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
  // actionable hint. navigate_offer goes via expo-router and closes
  // the sheet; resolve_disambiguate offers chips per candidate.
  function actNavigateOffer() {
    const dest = actions?.action?.type === 'navigate_offer' ? actions.action.destination : null;
    if (!dest) return;
    closeConductorSheet();
    setTimeout(() => router.push(dest as never), 120);
  }
  function actConfirmSetting() {
    closeConductorSheet();
    setTimeout(() => router.push('/settings' as never), 120);
  }
  function actResolveCandidate(description: string) {
    // Re-ask "rest the X signal" with the canonical description so
    // executeResolveSignal can hit a high-confidence single match.
    submit(`Resolve ${description}`);
  }
  function actGotIt() {
    setActions(null);
  }

  const chips = suggestionsFor(context);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={closeConductorSheet}>
      {/* KeyboardAvoidingView lives OUTSIDE SwipeDismissSheet so the
          entire sheet rises with the keyboard. Wrapping the KAV inside
          the fixed-height sheet (the previous structure) couldn't grow
          the sheet beyond SHEET_HEIGHT, so the input bar disappeared
          behind the keyboard. Moving KAV to the screen-level flex
          container — with the backdrop's justifyContent:flex-end
          anchoring the sheet to the bottom — lets padding/height
          behavior push the whole sheet upward by the keyboard's height. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={20}
        style={{ flex: 1 }}>
        <Pressable
          style={styles.backdrop}
          onPress={backdropActive ? closeConductorSheet : undefined}>
          <SwipeDismissSheet
            style={[styles.sheet, { height: SHEET_HEIGHT }]}
            onClose={closeConductorSheet}
            enabled={backdropActive}>
            <Pressable onPress={() => {}} style={{ flex: 1 }}>
              {/* Header */}
              {/* Header — title pinned left, Done pinned right. The
                  context pill takes a flex-shrinkable middle slot so
                  long context labels can never push Done offscreen. */}
              <View style={styles.headerRow}>
                <Text style={styles.title} numberOfLines={1}>The Conductor</Text>
                <View style={styles.contextPill}>
                  <Text style={styles.contextPillText} numberOfLines={1}>
                    📍 {contextLabelFor(context)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    closeConductorSheet();
                  }}
                  activeOpacity={0.6}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.closeBtn}>
                  <Text style={styles.closeBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.divider} />

              {/* Input bar — the dominant, primary element, pinned at the
                  top and auto-focused on open. Chips sit below as secondary
                  options. */}
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

              {/* Suggestion chips — secondary options below the input */}
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

              {/* Conversation area — flat role-keyed bubble list.
                  Each message renders independently in its own
                  alignment. Loading dots render below the latest
                  user message when a request is in flight. */}
              <ScrollView
                ref={scrollRef}
                style={styles.conversation}
                contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}>
                {messages.map((m, idx) => {
                  if (m.role === 'user') {
                    return (
                      <View key={m.id} style={styles.userBubble}>
                        <Text style={styles.userBubbleText}>{m.text}</Text>
                      </View>
                    );
                  }
                  // conductor
                  const isLastConductor = idx === messages.length - 1;
                  return (
                    <View key={m.id} style={styles.conductorBlock}>
                      {m.showLabel ? (
                        <Text style={styles.conductorLabel}>THE CONDUCTOR</Text>
                      ) : null}
                      <View style={styles.conductorBubble}>
                        <Text style={styles.conductorBubbleText}>{m.text}</Text>
                      </View>
                      {isLastConductor && actions?.action ? (
                        <ActionRenderer
                          action={actions.action}
                          styles={styles}
                          accentColor={accentColor}
                          theme={theme}
                          onNavigateOffer={actNavigateOffer}
                          onConfirmSetting={actConfirmSetting}
                          onResolveCandidate={actResolveCandidate}
                          onGotIt={actGotIt}
                        />
                      ) : null}
                    </View>
                  );
                })}
                {/* Loading dots render below the latest user message
                    while a request is in flight — placed AFTER the
                    last message so it always sits at the bottom.
                    alignSelf:flex-start mirrors the conductor side. */}
                {loading ? (
                  <View style={{ alignSelf: 'flex-start' }}>
                    <LoadingDots accentColor={accentColor} />
                  </View>
                ) : null}
              </ScrollView>
            </Pressable>
          </SwipeDismissSheet>
        </Pressable>
      </KeyboardAvoidingView>
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

// Below-bubble action surface. Renders confirmation cards for
// committed actions (signal_created / setting_changed / signal_resolved)
// and offer buttons for the non-committing intents (navigate_offer,
// confirm_setting, resolve_disambiguate, resolve_not_found).
function ActionRenderer({
  action,
  styles,
  accentColor,
  theme,
  onNavigateOffer,
  onConfirmSetting,
  onResolveCandidate,
  onGotIt,
}: {
  action: ActionPayload;
  styles: any;
  accentColor: string;
  theme: ThemeColors;
  onNavigateOffer: () => void;
  onConfirmSetting: () => void;
  onResolveCandidate: (description: string) => void;
  onGotIt: () => void;
}) {
  if (action.type === 'signal_created') {
    const etaLine = action.signal.eta ? `· ${action.signal.eta}` : '';
    return (
      <View style={[styles.confirmCard, { borderLeftColor: accentColor }]}>
        <Text style={styles.confirmLabel}>Added to the radar</Text>
        <Text style={styles.confirmDetail} numberOfLines={2}>
          {action.signal.description} {etaLine}
        </Text>
        <Text style={[styles.confirmDone, { color: accentColor }]}>Done</Text>
      </View>
    );
  }
  if (action.type === 'setting_changed') {
    return (
      <View style={[styles.confirmCard, { borderLeftColor: accentColor }]}>
        <Text style={styles.confirmLabel}>Setting updated</Text>
        <Text style={styles.confirmDetail} numberOfLines={2}>{action.detail}</Text>
        <Text style={[styles.confirmDone, { color: accentColor }]}>Done</Text>
      </View>
    );
  }
  if (action.type === 'signal_resolved') {
    return (
      <View style={[styles.confirmCard, { borderLeftColor: accentColor }]}>
        <Text style={styles.confirmLabel}>Rested</Text>
        <Text style={styles.confirmDetail} numberOfLines={2}>{action.signal.description}</Text>
        <Text style={[styles.confirmDone, { color: accentColor }]}>Done</Text>
      </View>
    );
  }
  if (action.type === 'navigate_offer') {
    return (
      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={onNavigateOffer}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>Take me there →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onGotIt}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[styles.actionBtn, styles.actionBtnGhost]}>
          <Text style={styles.actionBtnGhostText}>Got it</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (action.type === 'confirm_setting') {
    return (
      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={onConfirmSetting}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>Open Your House →</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onGotIt}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[styles.actionBtn, styles.actionBtnGhost]}>
          <Text style={styles.actionBtnGhostText}>Not now</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (action.type === 'resolve_disambiguate') {
    return (
      <View style={styles.actionRow}>
        {action.candidates.map((c) => (
          <TouchableOpacity
            key={c.id}
            onPress={() => onResolveCandidate(c.description)}
            activeOpacity={0.6}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={styles.actionBtn}>
            <Text style={styles.actionBtnText} numberOfLines={1}>{c.description}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={onGotIt}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[styles.actionBtn, styles.actionBtnGhost]}>
          <Text style={styles.actionBtnGhostText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (action.type === 'resolve_not_found') {
    return (
      <View style={styles.actionRow}>
        <TouchableOpacity
          onPress={onGotIt}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={[styles.actionBtn, styles.actionBtnGhost]}>
          <Text style={styles.actionBtnGhostText}>Got it</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return null;
}

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
    // Three-slot header: title (intrinsic width) | context pill
    // (flex-shrinkable) | Done (intrinsic width, always visible).
    // gap spaces the slots; the middle pill shrinks first so neither
    // the title nor the Done button ever gets clipped.
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 10,
      gap: 10,
    },
    title: {
      color: accentColor,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.1,
      flexShrink: 0,
    },
    contextPill: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: theme.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border || 'rgba(255,255,255,0.08)',
      // Middle slot: grows to fill, shrinks under pressure, never
      // pushes the Done button off-screen. marginLeft:'auto' so when
      // there's slack, the pill drifts right toward Done rather than
      // hugging the title.
      flexShrink: 1,
      marginLeft: 'auto',
    },
    contextPillText: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 0.2,
    },
    closeBtn: {
      paddingVertical: 4,
      paddingHorizontal: 6,
      flexShrink: 0,
      minWidth: 44,
      alignItems: 'flex-end',
    },
    closeBtnText: {
      color: accentColor,
      fontSize: 15,
      fontWeight: '600',
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
    // User bubble — right-aligned via alignSelf, accent background,
    // asymmetric radius (sharp corner toward sender, bottom-right).
    // max width 75% of column.
    userBubble: {
      alignSelf: 'flex-end',
      maxWidth: '75%',
      backgroundColor: accentColor,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomRightRadius: 4,
      borderBottomLeftRadius: 16,
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginTop: 10,
      marginBottom: 4,
    },
    userBubbleText: {
      color: '#ffffff',
      fontSize: 14,
      lineHeight: 20,
    },
    // Conductor block — left-aligned wrapper holding the label, the
    // bubble, and any action-renderer surface. alignSelf:flex-start
    // anchors it to the left without needing a parent row.
    conductorBlock: {
      alignSelf: 'flex-start',
      maxWidth: '75%',
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
    // Conductor bubble — surface background per spec. A hairline
    // border keeps it readable when the surface and sheet are the
    // same theme color.
    conductorBubble: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomRightRadius: 16,
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
    confirmCard: {
      marginTop: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderLeftWidth: 3,
      borderLeftColor: accentColor,
      backgroundColor: theme.background,
      borderRadius: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border || 'rgba(255,255,255,0.06)',
      borderRightColor: theme.border || 'rgba(255,255,255,0.06)',
      borderBottomColor: theme.border || 'rgba(255,255,255,0.06)',
    },
    confirmLabel: {
      color: theme.muted,
      fontSize: 10,
      letterSpacing: 1.5,
      fontWeight: '600',
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    confirmDetail: {
      color: theme.text,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 6,
    },
    confirmDone: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
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
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderWidth: 1.5,
      borderColor: accentColor,
      borderRadius: 24,
      backgroundColor: theme.background,
      gap: 6,
    },
    micBtn: {
      padding: 6,
    },
    micGlyph: {
      fontSize: 18,
    },
    input: {
      flex: 1,
      color: theme.text,
      fontSize: 16,
      paddingHorizontal: 8,
      paddingVertical: 10,
      minHeight: 44,
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
