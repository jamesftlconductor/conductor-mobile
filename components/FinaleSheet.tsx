import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
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
import * as Haptics from 'expo-haptics';
import Svg, {
  Circle,
  Defs,
  Path,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { metaFor, Signal, TYPE_META } from './signalTypes';
import { SignalIcon } from './SignalIcon';
import { CameraScanner } from './CameraScanner';
import { SMSComposerSheet } from './SMSComposerSheet';
import { SwipeDismissSheet } from './SwipeDismissSheet';
import { GlassCard } from './GlassCard';
import { Tooltip } from './Tooltip';
import { useTheme } from '../app/theme';
import { useUserId } from '@/hooks/useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';

// ── Finale HUD identity ──────────────────────────────────────────────
// The Finale sheet has its own visual language — a simplified Jarvis-style
// holographic HUD — but rendered in the user's chosen accent (not a fixed
// hue) so it stays consistent with the rest of the app.
const HUD_BG = '#0a0e16';
// Monospace face for the technical readouts / bracket notation.
const MONO = Platform.select({ ios: 'Courier', android: 'monospace' });
// Circumference of the central gauge ring (r = 52).
const GAUGE_C = 2 * Math.PI * 52;

type ThemeColors = { background: string; surface: string; text: string; muted: string };

// Status cycle for the edit-mode tap-to-advance picker. Keep in sync
// with the values produced by the import classifier; "Unknown" is the
// fall-through option for signals where status genuinely isn't known.
const STATUS_CYCLE = [
  'In Transit',
  'Out for Delivery',
  'Delivered',
  'Delayed',
  'Unknown',
];

type SingleProps = {
  mode: 'single';
  visible: boolean;
  signal: Signal;
  resolving?: boolean;
  userId?: string;
  onClose: () => void;
  onRest: (s: Signal) => void;
  onHold: (s: Signal) => void;
  onUpdate?: (updated: Signal) => void;
};

type CategoryProps = {
  mode: 'category';
  visible: boolean;
  // Drives the header emoji/label via TYPE_META. Optional — a trip
  // cluster passes `title` instead of a type key.
  categoryTypeKey?: string;
  // Overrides the header when set (used by Hover trip-cluster expansion,
  // e.g. "Paris trip — June 12-23"). Takes precedence over categoryTypeKey.
  title?: string;
  signals: Signal[];
  bottomInset?: number;
  onClose: () => void;
  onRest: (s: Signal) => void;
  // When provided, tapping a row body opens that signal (used by the
  // trip cluster to drill into an individual leg). The Rest button stays.
  onSelect?: (s: Signal) => void;
};

type FinaleSheetProps = SingleProps | CategoryProps;

export function FinaleSheet(props: FinaleSheetProps) {
  const userId = useUserId();
  if (!userId) return null;
  if (props.mode === 'single') {
    return <SingleSheet {...props} />;
  }

  return <CategorySheet {...props} />;
}

function CategorySheet(props: CategoryProps) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const { visible, categoryTypeKey, title, signals, bottomInset = 0, onClose, onRest, onSelect } = props;
  const categoryMeta = categoryTypeKey ? TYPE_META[categoryTypeKey] : undefined;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable
        style={[styles.modalBackdrop, styles.filterBackdrop]}
        onPress={onClose}>
        <Pressable style={styles.filterSheet} onPress={() => {}}>
          <GlassCard style={styles.filterGlass}>
          {/* Faint schematic grid behind the content. */}
          <View pointerEvents="none" style={styles.gridPattern}>
            <Svg width="100%" height="100%">
              <Defs>
                <Pattern id="finaleGridCat" width={26} height={26} patternUnits="userSpaceOnUse">
                  <Path d="M26 0H0V26" stroke={accentColor} strokeWidth={0.5} fill="none" />
                </Pattern>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#finaleGridCat)" />
            </Svg>
          </View>
          <RadialGlow accentColor={accentColor} />
          <View style={styles.filterHeader}>
            <View style={styles.filterTitleRow}>
              {title ? (
                <>
                  <Text style={styles.filterTitleEmoji}>✈️</Text>
                  <Text style={[styles.filterTitle, { color: accentColor }]}>
                    {title}
                  </Text>
                </>
              ) : categoryMeta ? (
                <>
                  <View style={{ marginRight: 2 }}>
                    <SignalIcon type={categoryTypeKey} size={18} />
                  </View>
                  <Text style={[styles.filterTitle, { color: categoryMeta.color }]}>
                    {categoryMeta.label}
                  </Text>
                </>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.clearFilterText}>Reset</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.filterList}
            contentContainerStyle={{ paddingBottom: 32 + bottomInset }}>
            {signals.length === 0 ? (
              <Text style={styles.filterEmpty}>This category is quiet.</Text>
            ) : (
              signals.map((s) => {
                const bodyContent = (
                  <>
                    <Text style={styles.filterItemDescription} numberOfLines={2}>
                      {s.description || 'Unknown signal'}
                    </Text>
                    {!!s.sender && (
                      <Text style={styles.filterItemMeta}>From {s.sender}</Text>
                    )}
                    {!!s.status && (
                      <Text style={styles.filterItemMeta}>Status {s.status}</Text>
                    )}
                    <Text style={styles.filterItemMeta}>ETA {s.eta || 'Unknown'}</Text>
                  </>
                );
                return (
                  <View key={String(s.id)} style={styles.filterItem}>
                    <View style={[styles.filterItemEmoji, { alignItems: 'center', justifyContent: 'center' }]}>
                      <SignalIcon type={s.type} size={20} />
                    </View>
                    {onSelect ? (
                      <TouchableOpacity
                        style={styles.filterItemBody}
                        activeOpacity={0.7}
                        onPress={() => onSelect(s)}>
                        {bodyContent}
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.filterItemBody}>{bodyContent}</View>
                    )}
                    <TouchableOpacity
                      style={styles.filterRestBtn}
                      onPress={() => onRest(s)}>
                      <Text style={styles.filterRestBtnText}>Rest</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </ScrollView>
          </GlassCard>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Single-mode is its own component so it can hold edit-mode state via
// hooks without breaking the discriminated-union shape of the public
// FinaleSheet props.
function SingleSheet({
  visible,
  signal,
  resolving,
  userId,
  onClose,
  onRest,
  onHold,
  onUpdate,
}: SingleProps) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const MUTED = theme.muted;
  const meta = metaFor(signal);

  // Central gauge: maps days-until-ETA to a fill fraction + a big centered
  // readout. Closer ETAs fill the ring further (urgency). Falls back to
  // carry-forward briefCount, then a neutral half-ring when no ETA exists.
  const gauge = useMemo(() => {
    const eta = signal.eta;
    if (eta) {
      const t = Date.parse(eta);
      if (!Number.isNaN(t)) {
        const days = Math.round((t - Date.now()) / 86400000);
        const value = Math.max(0.05, Math.min(1, 1 - days / 21));
        return {
          value,
          big: days <= 0 ? '0' : String(days),
          unit: days <= 0 ? 'NOW' : Math.abs(days) === 1 ? 'DAY' : 'DAYS',
        };
      }
    }
    const bc = (signal as Signal & { briefCount?: number }).briefCount;
    if (typeof bc === 'number' && bc > 0) {
      return { value: Math.min(1, bc / 7), big: String(bc), unit: 'BRIEFS' };
    }
    return { value: 0.5, big: '—', unit: 'ACTIVE' };
  }, [signal.eta, signal.id]);

  // Short bracketed signal identifier — last 4 of the id, like [#4F2A].
  const signalId = String(signal.id).replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase().padStart(4, '0');

  // Age in days since ingestion — drives one of the bottom micro-dials.
  const ageDays = useMemo(() => {
    const c = signal.createdAt;
    if (!c) return 0;
    const t = Date.parse(c);
    if (Number.isNaN(t)) return 0;
    return Math.max(0, Math.round((Date.now() - t) / 86400000));
  }, [signal.createdAt]);
  const briefCount = (signal as Signal & { briefCount?: number }).briefCount ?? 0;
  const [editing, setEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState(signal.description || '');
  const [editedEta, setEditedEta] = useState(signal.eta || '');
  const [showFinaleTip, setShowFinaleTip] = useState(false);
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem('tutorial_finale');
        if (!seen) setShowFinaleTip(true);
      } catch { /* ignore */ }
    })();
  }, [visible]);
  function dismissFinaleTip() {
    if (!showFinaleTip) return;
    setShowFinaleTip(false);
    AsyncStorage.setItem('tutorial_finale', 'done').catch(() => {});
  }
  const [editedStatus, setEditedStatus] = useState(signal.status || 'Unknown');
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [attribSuggestion, setAttribSuggestion] = useState<{
    name: string;
    confidence: number;
  } | null>(null);
  const [attribAssigning, setAttribAssigning] = useState(false);
  const dimOpacity = useRef(new Animated.Value(1)).current;

  // Crew attribution suggestion. Fires when the sheet opens for an
  // unattributed signal: fetch crew, score each member against the
  // signal's sender + description, surface the top match above the
  // 70% confidence threshold as a tappable banner. The banner
  // disappears after Assign — no need to re-poll the API.
  useEffect(() => {
    if (!visible) { setAttribSuggestion(null); return; }
    const sigWithAttrib = signal as Signal & { crewMemberId?: string | null };
    if (sigWithAttrib.crewMemberId) { setAttribSuggestion(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=crew&userId=${userId || ''}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const crew = Array.isArray(data?.crew) ? data.crew : [];
        if (crew.length === 0) return;

        // Score each crew member. Sender match against senderPatterns
        // is the strongest signal; description-name match plus
        // school/doctor name matches stack on top. type==='medical'
        // gives a medium bump on members with prescriptions.
        type Scored = { name: string; confidence: number };
        const scored: Scored[] = [];
        const desc = (signal.description || '').toLowerCase();
        const sender = (signal.sender || '').toLowerCase();
        for (const m of crew) {
          if (!m || !m.name) continue;
          let conf = 0;
          const memberName = String(m.name).toLowerCase();
          if (Array.isArray(m.senderPatterns)) {
            for (const p of m.senderPatterns) {
              const pat = String(p || '').toLowerCase().trim();
              if (pat && sender.includes(pat)) { conf = Math.max(conf, 90); break; }
            }
          }
          if (desc.includes(memberName) && memberName.length >= 3) {
            conf = Math.max(conf, 80);
          }
          const schoolName = m?.school?.name ? String(m.school.name).toLowerCase() : '';
          if (schoolName && schoolName.length >= 3 && desc.includes(schoolName)) {
            conf = Math.max(conf, 85);
          }
          if (Array.isArray(m.doctors)) {
            for (const d of m.doctors) {
              const dn = d?.name ? String(d.name).toLowerCase() : '';
              if (dn && dn.length >= 4 && (desc.includes(dn) || sender.includes(dn))) {
                conf = Math.max(conf, 80);
                break;
              }
            }
          }
          if (signal.type === 'medical' && Array.isArray(m.prescriptions) && m.prescriptions.length > 0) {
            conf = Math.max(conf, 60);
          }
          if (conf > 0) scored.push({ name: m.name, confidence: conf });
        }
        if (cancelled) return;
        scored.sort((a, b) => b.confidence - a.confidence);
        if (scored[0] && scored[0].confidence > 70) {
          setAttribSuggestion(scored[0]);
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [visible, signal.id, signal.description, signal.sender, signal.type, userId]);

  async function acceptAttribSuggestion() {
    if (!attribSuggestion || attribAssigning) return;
    setAttribAssigning(true);
    try {
      await fetch(`${API_BASE}/signals?type=crew-attribution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          signalId: signal.id,
          crewMemberName: attribSuggestion.name,
        }),
      });
      // Stamp locally so the row reflects the change without a parent
      // refresh — mirrors the existing CrewAttributionRow pattern.
      (signal as Signal & { crewMemberId?: string | null }).crewMemberId =
        attribSuggestion.name;
      setAttribSuggestion(null);
    } catch {
      // Silent on failure; user can still tap the manual attribution
      // row below.
    } finally {
      setAttribAssigning(false);
    }
  }

  // Suggestion engine: fetch a one-sentence contextual next-step from
  // /api/suggest when the sheet opens for a new signal. Backend caches
  // by signalId with a 12h TTL, so re-taps within the window are
  // instant. Silent failure — on any error we just don't render the
  // suggestion block, keeping the sheet visually intact.
  useEffect(() => {
    if (!visible || !signal.id) {
      setSuggestion(null);
      setSuggestionLoading(false);
      return;
    }
    let cancelled = false;
    setSuggestion(null);
    setSuggestionLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/suggest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            signalId: signal.id,
            signalType: signal.type || 'unknown',
            description: signal.description || '',
            sender: signal.sender || '',
            status: signal.status || '',
            eta: signal.eta || '',
          }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data && typeof data.suggestion === 'string' && data.suggestion.length > 0) {
          setSuggestion(data.suggestion);
        }
      } catch {
        // silent — leave suggestion null
      } finally {
        if (!cancelled) setSuggestionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, signal.id, signal.type, signal.description, signal.sender, signal.status, signal.eta, userId]);

  // Reset edit state when a different signal opens — without this, an
  // unsaved edit on signal A would leak into signal B if the user
  // closed A and tapped B.
  useEffect(() => {
    setEditing(false);
    setEditedDescription(signal.description || '');
    setEditedEta(signal.eta || '');
    setEditedStatus(signal.status || 'Unknown');
  }, [signal.id]);

  const cycleStatus = () => {
    const i = STATUS_CYCLE.indexOf(editedStatus);
    const next = STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
    setEditedStatus(next);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const updated: Signal = {
      ...signal,
      description: editedDescription,
      eta: editedEta || null,
      status: editedStatus,
    };
    // Best-effort PATCH. The backend currently validates `state` and
    // rejects without it, so this call may 400 until /api/signals.js
    // accepts description/eta/status fields. Local state still updates
    // so the user sees their edit immediately.
    try {
      await fetch(`${API_BASE}/signals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: signal.id,
          userId,
          description: editedDescription,
          eta: editedEta || null,
          status: editedStatus,
        }),
      });
    } catch (err) {
      console.warn('Signal edit save failed:', err);
    }
    onUpdate?.(updated);
    setSaving(false);
    setEditing(false);
    // Subtle dim/return on the now-displayed description to acknowledge
    // the save without a flashy toast.
    Animated.sequence([
      Animated.timing(dimOpacity, {
        toValue: 0.4,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(dimOpacity, {
        toValue: 1,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleCancel = () => {
    setEditedDescription(signal.description || '');
    setEditedEta(signal.eta || '');
    setEditedStatus(signal.status || 'Unknown');
    setEditing(false);
  };

  // ── Swipe-to-act: swipe LEFT → Rest, RIGHT → Hold (the fast path; the tap
  // buttons stay the considered path). Only CLEAR horizontal gestures are
  // claimed, so vertical swipe-DOWN still reaches SwipeDismissSheet to close.
  // All driven on the JS thread (setValue + non-native springs) so dragX can
  // also feed the tint opacity without a native/JS driver conflict.
  const dragX = useRef(new Animated.Value(0)).current;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const swipeActionRef = useRef<{ rest: () => void; hold: () => void }>({ rest: () => {}, hold: () => {} });
  swipeActionRef.current = {
    rest: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      dismissFinaleTip();
      onRest(signal);
    },
    hold: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      dismissFinaleTip();
      onHold(signal);
    },
  };
  const swipePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !editingRef.current && Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        dragX.setValue(g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -60) {
          swipeActionRef.current.rest();
          dragX.setValue(0);
        } else if (g.dx > 60) {
          swipeActionRef.current.hold();
          dragX.setValue(0);
        } else {
          Animated.spring(dragX, { toValue: 0, useNativeDriver: false }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragX, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  ).current;
  const restTintOpacity = dragX.interpolate({ inputRange: [-120, 0], outputRange: [0.25, 0], extrapolate: 'clamp' });
  const holdTintOpacity = dragX.interpolate({ inputRange: [0, 120], outputRange: [0, 0.25], extrapolate: 'clamp' });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <SwipeDismissSheet style={styles.sheet} onClose={onClose}>
          <Pressable onPress={() => {}}>
          {/* Glass panel — the weather/Ground shows behind it; GlassCard
              provides the tint, rim lighting, inner glow and corner brackets.
              Wrapped in a horizontally-draggable Animated.View for swipe-to-act. */}
          <Animated.View
            {...swipePan.panHandlers}
            style={{ transform: [{ translateX: dragX }] }}>
          <GlassCard style={styles.finaleGlass}>
          {/* Faint technical-schematic grid behind the content. */}
          <View pointerEvents="none" style={styles.gridPattern}>
            <Svg width="100%" height="100%">
              <Defs>
                <Pattern id="finaleGrid" width={26} height={26} patternUnits="userSpaceOnUse">
                  <Path d="M26 0H0V26" stroke={accentColor} strokeWidth={0.5} fill="none" />
                </Pattern>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#finaleGrid)" />
            </Svg>
          </View>
          <RadialGlow accentColor={accentColor} />
          {/* HEADER — bracketed signal type (left); id + ADJUST (right). */}
          <View style={styles.hudHeader}>
            <Text style={styles.hudTypeLabel} numberOfLines={1}>
              [{(meta.label || 'SIGNAL').toUpperCase()}]
            </Text>
            <View style={styles.hudHeaderRight}>
              <Text style={styles.hudSignalId}>[#{signalId}]</Text>
              {!editing && (
                <TouchableOpacity
                  onPress={() => setEditing(true)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.editLink}>ADJUST</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {!editing ? (
            <>
              {/* CENTRAL GAUGE — urgency ring filled by days-until-ETA, big
                  centered readout at its core. */}
              <View style={styles.gaugeWrap}>
                <Svg width={124} height={124} viewBox="0 0 124 124">
                  <Circle
                    cx={62}
                    cy={62}
                    r={52}
                    stroke={accentColor}
                    strokeWidth={2}
                    fill="none"
                    opacity={0.15}
                  />
                  <Circle
                    cx={62}
                    cy={62}
                    r={52}
                    stroke={accentColor}
                    strokeWidth={2.5}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${gauge.value * GAUGE_C} ${GAUGE_C}`}
                    transform="rotate(-90 62 62)"
                  />
                  <Circle
                    cx={62}
                    cy={62}
                    r={44}
                    stroke={accentColor}
                    strokeWidth={0.6}
                    fill="none"
                    opacity={0.25}
                  />
                  <Circle cx={62} cy={10} r={2.4} fill={accentColor} />
                </Svg>
                <View style={styles.gaugeCenter} pointerEvents="none">
                  <Text style={styles.gaugeBig}>{gauge.big}</Text>
                  <Text style={styles.gaugeUnit}>{gauge.unit}</Text>
                </View>
              </View>

              {/* DESCRIPTION — hero text with a bracket rule on its left edge. */}
              <View style={styles.descRow}>
                <View style={styles.descBracket} />
                <Animated.Text
                  style={[styles.sheetDescription, { opacity: dimOpacity }]}>
                  {signal.description || 'Unknown signal'}
                </Animated.Text>
              </View>

              {attribSuggestion ? (
                <View style={styles.attribSuggestion}>
                  <Text style={styles.attribSuggestionText} numberOfLines={2}>
                    Looks like this might belong to {attribSuggestion.name} →
                  </Text>
                  <TouchableOpacity
                    onPress={acceptAttribSuggestion}
                    disabled={attribAssigning}
                    activeOpacity={0.6}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={styles.attribAssignBtn}>
                      {attribAssigning ? '...' : 'Assign'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.metaBlock}>
                {[
                  { k: 'FROM', v: signal.sender || '—' },
                  { k: 'STATUS', v: signal.status ? signal.status.toUpperCase() : 'UNKNOWN' },
                  { k: 'ETA', v: signal.eta || 'PENDING' },
                  { k: 'TYPE', v: (meta.label || 'SIGNAL').toUpperCase() },
                ].map((row) => (
                  <View key={row.k} style={styles.hudMetaRow}>
                    <Text style={styles.hudMetaLabel}>[{row.k}]</Text>
                    <Text style={styles.hudMetaValue} numberOfLines={1}>
                      {row.v}
                    </Text>
                  </View>
                ))}
                {(signal as Signal & { recurring?: boolean; recurringInterval?: number }).recurring ? (
                  <Text style={styles.recurringLine}>
                    🔄  Recurring — every {(signal as Signal & { recurringInterval?: number }).recurringInterval ?? '?'} days
                  </Text>
                ) : null}
                {(() => {
                  // Carry-forward escalation badge. Surfaces only at the
                  // brief.js threshold (>=3 mornings without resolving) so
                  // a brand-new signal doesn't show a stale "carried
                  // forward 0 days" line. Amber to read as a soft prompt,
                  // not an alert.
                  const bc = (signal as Signal & { briefCount?: number }).briefCount;
                  if (typeof bc !== 'number' || bc < 3) return null;
                  return (
                    <Text style={styles.carryForwardLine}>
                      ⏳  Carried forward {bc} days
                    </Text>
                  );
                })()}
                <CrewAttributionRow
                  signal={signal}
                  userId={userId || ''}
                  onAttributed={(name) => {
                    // Stamp locally so the row reflects the change
                    // without a parent refresh. Server already
                    // persisted via the POST.
                    (signal as Signal & { crewMemberId?: string | null }).crewMemberId = name;
                  }}
                />
                <SignalPhotosRow signal={signal} userId={userId || ''} />
                <SignalSMSLink signal={signal} userId={userId || ''} />
              </View>

              {/* Emotional tag — only surfaces for high-intensity signals
                  (auto-classified by the import pipeline). Routine
                  package deliveries stay quiet; the user only has to
                  classify when Conductor already thinks it's a big
                  enough moment to matter. Tap to override. */}
              {signal.emotionalIntensity === 'high' ? (
                <EmotionalTagRow
                  signal={signal}
                  userId={userId || ''}
                  onUpdate={(updated) => onUpdate?.(updated)}
                />
              ) : null}

              {(suggestionLoading || suggestion) && (
                <View style={styles.suggestionBlock}>
                  <Text style={styles.suggestionLabel}>NEXT STEP</Text>
                  <Text style={styles.suggestionText}>
                    {suggestion || '…'}
                  </Text>
                </View>
              )}

              {showFinaleTip ? (
                <View style={styles.finaleTipWrap} pointerEvents="box-none">
                  <Tooltip
                    visible={showFinaleTip}
                    message="Rest when it's handled. Hold when you're aware but not ready."
                    arrow="down"
                    showButton={false}
                    onDismiss={dismissFinaleTip}
                  />
                </View>
              ) : null}

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnNoted]}
                  onPress={() => { dismissFinaleTip(); onClose(); }}>
                  <BtnCorners color={theme.muted} />
                  <Text style={styles.btnNotedText}>Noted</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={() => { dismissFinaleTip(); onHold(signal); }}>
                  <BtnCorners color={accentColor} />
                  <Text style={styles.btnSecondaryText}>Hold</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, resolving && { opacity: 0.5 }]}
                  onPress={() => { dismissFinaleTip(); onRest(signal); }}
                  disabled={resolving}>
                  <BtnCorners color={HUD_BG} />
                  <Text style={styles.btnPrimaryText}>Rest</Text>
                </TouchableOpacity>
              </View>

              {signal.sender ? (
                <TouchableOpacity
                  onPress={() => {
                    const senderName = signal.sender || '';
                    Alert.alert(
                      'Camouflage',
                      `Hide all future signals from ${senderName}? This can be undone in Settings.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Hide signals',
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await fetch(`${API_BASE}/signals?type=camouflage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  userId: userId,
                                  ruleType: 'sender',
                                  value: senderName,
                                }),
                              });
                            } catch {
                              // Best-effort — rule may not have landed.
                            }
                            onClose();
                          },
                        },
                      ]
                    );
                  }}
                  activeOpacity={0.6}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.camouflageLinkWrap}>
                  <Text style={styles.camouflageLink}>
                    Never show signals from {signal.sender}
                  </Text>
                </TouchableOpacity>
              ) : null}

            </>
          ) : (
            <>
              <TextInput
                style={styles.editDescription}
                value={editedDescription}
                onChangeText={setEditedDescription}
                placeholder="Description"
                placeholderTextColor={MUTED}
                multiline
                autoCorrect
                autoComplete="off"
                textContentType="none"
              />
              <View style={styles.metaBlock}>
                {!!signal.sender && (
                  <Text style={styles.metaLine}>From {signal.sender}</Text>
                )}
                <TouchableOpacity
                  onPress={cycleStatus}
                  style={styles.editMetaRow}>
                  <Text style={styles.editLabel}>Status</Text>
                  <Text style={styles.editValue}>{editedStatus}</Text>
                </TouchableOpacity>
                <View style={styles.editMetaRow}>
                  <Text style={styles.editLabel}>ETA</Text>
                  <TextInput
                    style={styles.editEtaInput}
                    value={editedEta}
                    onChangeText={setEditedEta}
                    placeholder="Add date..."
                    placeholderTextColor={MUTED}
                  />
                </View>
              </View>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={handleCancel}
                  disabled={saving}>
                  <Text style={styles.btnSecondaryText}>Avert</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnSave, saving && { opacity: 0.5 }]}
                  onPress={handleSave}
                  disabled={saving}>
                  <Text style={styles.btnSaveText}>Remember</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          {/* Swipe tint — green = Rest (left), amber = Hold (right). */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#34d399', opacity: restTintOpacity }]} />
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#f59e0b', opacity: holdTintOpacity }]} />
          </GlassCard>
          </Animated.View>
          </Pressable>
        </SwipeDismissSheet>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Signal photo attachment row. "📷 Add photo" tap opens
// CameraScanner with scanType:'signal_photo'. On success the
// signed proxy URL is appended to a local thumbnail list; the
// backend already wrote the photo into signal.photos[] during
// the /api/scan call.
function SignalPhotosRow({ signal, userId }: { signal: Signal; userId: string }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [showScanner, setShowScanner] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  return (
    <View style={styles.photosBlock}>
      {photoUrls.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoThumbs}>
          {photoUrls.map((u, i) => (
            <Image key={i} source={{ uri: u }} style={styles.photoThumb} />
          ))}
        </ScrollView>
      ) : null}
      <TouchableOpacity
        onPress={() => setShowScanner(true)}
        style={styles.addPhotoBtn}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
        <Text style={styles.addPhotoText}>📷 Add photo</Text>
      </TouchableOpacity>
      <CameraScanner
        visible={showScanner}
        userId={userId}
        scanType="signal_photo"
        signalId={signal.id}
        onClose={() => setShowScanner(false)}
        onResult={(r) => {
          if (r.photoUrl) setPhotoUrls((p) => [...p, r.photoUrl as string]);
        }}
      />
    </View>
  );
}

// "Send text update" inline link → opens SMSComposerSheet for this
// signal. Keeps the call-site tiny so it slots cleanly under the
// photo attachment row without re-flowing the meta block.
function SignalSMSLink({ signal, userId }: { signal: Signal; userId: string }) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.smsLinkBtn}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
        <Text style={styles.smsLinkText}>📱 Send text update</Text>
      </TouchableOpacity>
      <SMSComposerSheet
        visible={open}
        userId={userId}
        signalId={signal.id}
        signalDescription={signal.description}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

// Crew attribution row in the Finale sheet. Renders either:
//   - "Belongs to → {Name}" with a Change link (already attributed)
//   - "Assign to crew member →" muted link (unattributed)
// Tap opens a bottom sheet listing crew members + a Household option;
// tap one to POST the attribution and update parent local state.
// "How does this feel?" — surfaced inside SingleSheet only for
// signals the import pipeline (or manual override) marked as
// high-intensity. The 4-pill row defaults to the auto-classified
// valence; a tap saves the override via PATCH and updates local
// signal state so the brief sees the change on next regeneration.
//
// Hidden entirely for medium/low intensity signals — every routine
// package delivery would otherwise force the user to repeatedly
// classify items they don't care about emotionally.
const VALENCE_PILLS: { id: 'joyful' | 'neutral' | 'stressful' | 'grief'; emoji: string; label: string }[] = [
  { id: 'joyful',    emoji: '😊', label: 'Joyful' },
  { id: 'neutral',   emoji: '😐', label: 'Neutral' },
  { id: 'stressful', emoji: '😟', label: 'Stressful' },
  { id: 'grief',     emoji: '💔', label: 'Grief' },
];

function EmotionalTagRow({
  signal,
  userId,
  onUpdate,
}: {
  signal: Signal;
  userId: string;
  onUpdate: (updated: Signal) => void;
}) {
  const { theme, accentColor } = useTheme();
  const [current, setCurrent] = useState<Signal['emotionalValence']>(
    signal.emotionalValence || 'neutral'
  );

  function save(next: NonNullable<Signal['emotionalValence']>) {
    if (next === current) return;
    setCurrent(next);
    const updated: Signal = { ...signal, emotionalValence: next };
    onUpdate(updated);
    fetch(`${API_BASE}/signals`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: signal.id,
        userId,
        emotionalValence: next,
      }),
    }).catch(() => { /* silent — local state already reflects choice */ });
  }

  return (
    <View style={{ marginTop: 14, marginBottom: 4 }}>
      <Text style={{
        color: theme.muted,
        fontSize: 10,
        letterSpacing: 1.5,
        fontWeight: '600',
        marginBottom: 8,
      }}>
        HOW DOES THIS FEEL?
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {VALENCE_PILLS.map((p) => {
          const active = current === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => save(p.id)}
              activeOpacity={0.6}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={{
                flex: 1,
                paddingVertical: 8,
                paddingHorizontal: 4,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: active ? accentColor : 'rgba(255,255,255,0.08)',
                backgroundColor: active ? 'rgba(0,212,255,0.10)' : 'transparent',
                alignItems: 'center',
              }}>
              <Text style={{ fontSize: 16 }}>{p.emoji}</Text>
              <Text style={{
                color: active ? accentColor : theme.muted,
                fontSize: 10,
                fontWeight: active ? '600' : '400',
                marginTop: 2,
              }}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function CrewAttributionRow({
  signal,
  userId,
  onAttributed,
}: {
  signal: Signal & { crewMemberId?: string | null };
  userId: string;
  onAttributed: (name: string | null) => void;
}) {
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [crew, setCrew] = useState<{ name: string; photoUrl?: string | null; memberType?: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(signal.crewMemberId || null);
  useEffect(() => {
    let cancelled = false;
    if (!open) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/signals?type=crew&userId=${userId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data?.crew)
          ? data.crew
              .filter((m: any) => m && m.name)
              .map((m: any) => ({ name: m.name, photoUrl: m.photoUrl, memberType: m.memberType }))
          : [];
        setCrew(list);
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  async function assign(name: string | null) {
    setCurrent(name);
    setOpen(false);
    onAttributed(name);
    try {
      await fetch(`${API_BASE}/signals?type=crew-attribution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, signalId: signal.id, crewMemberName: name }),
      });
    } catch {
      // ignore — next sheet open will reflect server truth
    }
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.attributionRow}
        activeOpacity={0.6}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Text style={styles.attributionLabel}>Belongs to →</Text>
        <Text style={current ? styles.attributionName : styles.attributionAssign}>
          {current || 'Assign to crew member'}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.attributionBackdrop} onPress={() => setOpen(false)}>
          <SwipeDismissSheet style={styles.attributionSheet} onClose={() => setOpen(false)}>
            <Pressable onPress={() => {}}>
            <Text style={styles.attributionSheetTitle}>Assign signal to</Text>
            <TouchableOpacity
              onPress={() => assign(null)}
              style={styles.attributionMemberRow}>
              <View style={styles.attributionPhotoFallback}>
                <Text style={styles.attributionPhotoInitials}>🏠</Text>
              </View>
              <Text style={styles.attributionMemberName}>Household (unassigned)</Text>
            </TouchableOpacity>
            {crew.map((m) => (
              <TouchableOpacity
                key={m.name}
                onPress={() => assign(m.name)}
                style={styles.attributionMemberRow}>
                {m.photoUrl ? (
                  <Image source={{ uri: m.photoUrl }} style={styles.attributionPhoto} />
                ) : (
                  <View style={styles.attributionPhotoFallback}>
                    <Text style={styles.attributionPhotoInitials}>
                      {m.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={styles.attributionMemberName}>{m.name}</Text>
              </TouchableOpacity>
            ))}
            </Pressable>
          </SwipeDismissSheet>
        </Pressable>
      </Modal>
    </>
  );
}

// ── HUD chrome ───────────────────────────────────────────────────────
// Four L-shaped corner clamps that frame the sheet like a targeting
// bezel. Purely decorative; rendered absolutely at the sheet edges.
// Very subtle radial wash — a touch lighter at the sheet's upper-center —
// behind all content. Holographic depth without washing out readability.
function RadialGlow({ accentColor }: { accentColor: string }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="finaleGlow" cx="50%" cy="36%" r="68%">
            <Stop offset="0" stopColor={accentColor} stopOpacity={0.06} />
            <Stop offset="1" stopColor={accentColor} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#finaleGlow)" />
      </Svg>
    </View>
  );
}

// Subtle 1px corner-bracket marks on the edges of an action button.
function BtnCorners({ color }: { color: string }) {
  const arm = { position: 'absolute' as const, width: 7, height: 7, borderColor: color, opacity: 0.7 };
  return (
    <>
      <View pointerEvents="none" style={[arm, { top: 4, left: 4, borderLeftWidth: 1, borderTopWidth: 1 }]} />
      <View pointerEvents="none" style={[arm, { top: 4, right: 4, borderRightWidth: 1, borderTopWidth: 1 }]} />
      <View pointerEvents="none" style={[arm, { bottom: 4, left: 4, borderLeftWidth: 1, borderBottomWidth: 1 }]} />
      <View pointerEvents="none" style={[arm, { bottom: 4, right: 4, borderRightWidth: 1, borderBottomWidth: 1 }]} />
    </>
  );
}

function CornerBrackets({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return (
    <>
      <View pointerEvents="none" style={[styles.cornerBracket, styles.cornerTL]} />
      <View pointerEvents="none" style={[styles.cornerBracket, styles.cornerTR]} />
      <View pointerEvents="none" style={[styles.cornerBracket, styles.cornerBL]} />
      <View pointerEvents="none" style={[styles.cornerBracket, styles.cornerBR]} />
    </>
  );
}

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    modalBackdrop: {
      flex: 1,
      // Lighter dim so Ground's weather shows behind the glass sheet.
      backgroundColor: 'rgba(0,0,0,0.32)',
      justifyContent: 'flex-end',
    },
    sheet: {
      // Transparent positioning container — the GlassCard inside is the visible
      // surface (its 0.72 tint replaces the old solid HUD_BG), so the weather
      // shows around the floating glass panel.
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
      paddingBottom: 10,
    },
    // Glass panel holding the single-signal content (extra bottom room).
    finaleGlass: {
      paddingBottom: 28,
    },
    // Faint technical-schematic grid behind the content.
    gridPattern: {
      ...StyleSheet.absoluteFillObject,
      opacity: 0.08,
    },
    // ── Corner clamps (L-shaped, 1.5px stroke, 18px arms) ──
    cornerBracket: {
      position: 'absolute',
      width: 18,
      height: 18,
      borderColor: accentColor,
      shadowColor: accentColor,
      shadowOpacity: 0.7,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 0 },
    },
    cornerTL: { top: 10, left: 10, borderLeftWidth: 1.5, borderTopWidth: 1.5 },
    cornerTR: { top: 10, right: 10, borderRightWidth: 1.5, borderTopWidth: 1.5 },
    cornerBL: { bottom: 10, left: 10, borderLeftWidth: 1.5, borderBottomWidth: 1.5 },
    cornerBR: { bottom: 10, right: 10, borderRightWidth: 1.5, borderBottomWidth: 1.5 },
    // ── Header: bracketed type (left) + id / ADJUST (right) ──
    hudHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    hudTypeLabel: {
      flex: 1,
      color: accentColor,
      fontSize: 11,
      letterSpacing: 2,
      fontFamily: MONO,
      textShadowColor: accentColor,
      textShadowRadius: 6,
      textShadowOffset: { width: 0, height: 0 },
    },
    hudHeaderRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    hudSignalId: {
      color: theme.muted,
      fontSize: 9,
      letterSpacing: 1.2,
      fontFamily: MONO,
    },
    // ── Central gauge ──
    gaugeWrap: {
      alignSelf: 'center',
      width: 124,
      height: 124,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    gaugeCenter: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gaugeBig: {
      color: '#ffffff',
      fontSize: 28,
      fontWeight: '700',
      fontFamily: MONO,
      letterSpacing: 1,
      textShadowColor: accentColor,
      textShadowRadius: 12,
      textShadowOffset: { width: 0, height: 0 },
    },
    gaugeUnit: {
      color: theme.muted,
      fontSize: 9,
      letterSpacing: 3,
      fontFamily: MONO,
      textTransform: 'uppercase',
      marginTop: 3,
    },
    // ── Metadata grid ──
    hudMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: accentColor + '1f',
    },
    hudMetaLabel: {
      color: theme.muted,
      fontSize: 9,
      letterSpacing: 1.5,
      fontFamily: MONO,
      textTransform: 'uppercase',
    },
    hudMetaValue: {
      color: '#ffffff',
      fontSize: 13,
      letterSpacing: 0.5,
      fontWeight: '500',
      maxWidth: '64%',
      textAlign: 'right',
    },
    // ── Bottom telemetry ──
    hudBottomRow: {
      marginTop: 18,
      marginBottom: 18,
    },
    hudWaveWrap: {
      marginBottom: 12,
    },
    telemetryText: {
      color: accentColor,
      fontSize: 8,
      letterSpacing: 1.2,
      fontFamily: MONO,
      opacity: 0.6,
      marginTop: 4,
      textAlign: 'center',
    },
    hudDials: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
    },
    // Thin glowing accent line at the very top of the sheet.
    accentTopLine: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: accentColor,
      shadowColor: accentColor,
      shadowOpacity: 0.8,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 48,
      height: 4,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.2)',
      marginBottom: 16,
    },
    sheetHeaderWrap: {
      position: 'relative',
      marginBottom: 12,
      justifyContent: 'center',
    },
    sheetHeader: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 3,
      fontWeight: '600',
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    editLinkPosition: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    editLink: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 1,
      fontWeight: '500',
    },
    sheetEmoji: {
      fontSize: 40,
      lineHeight: 48,
      textAlign: 'center',
      marginBottom: 16,
      // Soft accent glow behind the type icon.
      textShadowColor: accentColor,
      textShadowRadius: 16,
      textShadowOffset: { width: 0, height: 0 },
    },
    // ── Description with a bracket rule on the left ──
    descRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      marginBottom: 20,
    },
    // A `[`-shaped rule: vertical line with short serifs top & bottom.
    descBracket: {
      width: 7,
      marginRight: 14,
      borderLeftWidth: 2,
      borderTopWidth: 2,
      borderBottomWidth: 2,
      borderColor: accentColor,
      shadowColor: accentColor,
      shadowOpacity: 0.6,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 0 },
    },
    sheetDescription: {
      flex: 1,
      color: '#ffffff',
      fontSize: 22,
      fontWeight: '400',
      lineHeight: 30,
      textAlign: 'left',
      letterSpacing: 0.2,
    },
    editDescription: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '300',
      lineHeight: 26,
      textAlign: 'center',
      marginBottom: 20,
      letterSpacing: 0.2,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
      borderRadius: 8,
      minHeight: 40,
    },
    metaBlock: {
      marginBottom: 24,
      gap: 6,
    },
    recurringLine: {
      color: theme.muted,
      fontSize: 12,
      letterSpacing: 0.3,
      marginTop: 4,
      fontStyle: 'italic',
    },
    carryForwardLine: {
      color: '#f59e0b',
      fontSize: 12,
      letterSpacing: 0.3,
      marginTop: 4,
      fontStyle: 'italic',
    },
    attribSuggestion: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // 8-digit hex suffix = alpha (1a≈10%, 4d≈30%). Keeps the banner
      // accent-tinted regardless of which palette the user picked.
      backgroundColor: accentColor + '1a',
      borderColor: accentColor + '4d',
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginTop: -10,
      marginBottom: 16,
      gap: 12,
    },
    attribSuggestionText: {
      color: theme.text,
      fontSize: 12,
      letterSpacing: 0.2,
      flex: 1,
    },
    attribAssignBtn: {
      color: accentColor,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    metaLine: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 1.5,
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    finaleTipWrap: {
      alignItems: 'center',
      marginBottom: 6,
      paddingHorizontal: 20,
    },
    photosBlock: {
      marginTop: 10,
      alignItems: 'center',
    },
    photoThumbs: { gap: 8, paddingVertical: 4 },
    photoThumb: {
      width: 40,
      height: 40,
      borderRadius: 6,
      marginRight: 8,
    },
    addPhotoBtn: {
      paddingVertical: 6,
    },
    addPhotoText: {
      color: theme.muted,
      fontSize: 12,
      letterSpacing: 0.3,
    },
    smsLinkBtn: {
      paddingVertical: 6,
      alignSelf: 'center',
      marginTop: 4,
    },
    smsLinkText: {
      color: theme.muted,
      fontSize: 12,
      letterSpacing: 0.3,
    },
    attributionRow: {
      marginTop: 12,
      paddingVertical: 6,
      alignItems: 'center',
    },
    attributionLabel: {
      color: theme.muted,
      fontSize: 11,
      letterSpacing: 0.5,
    },
    attributionName: {
      color: accentColor,
      fontSize: 13,
      marginTop: 4,
      fontWeight: '500',
    },
    attributionAssign: {
      color: theme.muted,
      fontSize: 12,
      marginTop: 4,
      fontStyle: 'italic',
    },
    attributionBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    attributionSheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingTop: 22,
      paddingBottom: 36,
      paddingHorizontal: 18,
    },
    attributionSheetTitle: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: 0.3,
      marginBottom: 16,
    },
    attributionMemberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 12,
    },
    attributionPhoto: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: accentColor,
    },
    attributionPhotoFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#2a2a2a',
      borderWidth: 1,
      borderColor: accentColor,
      alignItems: 'center',
      justifyContent: 'center',
    },
    attributionPhotoInitials: {
      color: accentColor,
      fontSize: 14,
      fontWeight: '600',
    },
    attributionMemberName: {
      color: theme.text,
      fontSize: 14,
    },
    suggestionBlock: {
      marginBottom: 24,
      paddingHorizontal: 8,
    },
    suggestionLabel: {
      color: theme.muted,
      fontSize: 10,
      letterSpacing: 1,
      marginBottom: 4,
    },
    suggestionText: {
      color: accentColor,
      fontSize: 13,
      fontStyle: 'italic',
      lineHeight: 18,
      letterSpacing: 0.2,
    },
    editMetaRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    editLabel: {
      color: theme.muted,
      fontSize: 13,
      letterSpacing: 0.3,
    },
    editValue: {
      color: theme.text,
      fontSize: 13,
      letterSpacing: 0.3,
      textDecorationLine: 'underline',
      textDecorationColor: theme.muted,
    },
    editEtaInput: {
      color: theme.text,
      fontSize: 13,
      letterSpacing: 0.3,
      minWidth: 140,
      textAlign: 'left',
      paddingVertical: 2,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255,255,255,0.15)',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
    },
    btn: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Rest — accent fill with a glow.
    btnPrimary: {
      backgroundColor: accentColor,
      shadowColor: accentColor,
      shadowOpacity: 0.6,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    btnPrimaryText: {
      color: HUD_BG,
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    // Hold — outlined accent with a softer glow.
    btnSecondary: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: accentColor,
      shadowColor: accentColor,
      shadowOpacity: 0.35,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 3,
    },
    btnSecondaryText: {
      color: accentColor,
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    // Noted — subtle, muted; just acknowledges + closes.
    btnNoted: {
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.1)',
    },
    btnNotedText: {
      color: theme.muted,
      fontSize: 14,
      fontWeight: '500',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    // Camouflage link sits below the Hold/Rest button row. Small, muted,
    // not styled as a button — it's an escape hatch, not a primary
    // action.
    camouflageLinkWrap: {
      marginTop: 16,
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    camouflageLink: {
      color: theme.muted,
      fontSize: 12,
      letterSpacing: 0.3,
    },
    btnSave: {
      backgroundColor: accentColor,
    },
    btnSaveText: {
      color: theme.background,
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
    filterBackdrop: {
      backgroundColor: 'rgba(0,0,0,0.32)',
    },
    filterSheet: {
      // Transparent positioning container; GlassCard is the visible surface.
      backgroundColor: 'transparent',
      maxHeight: '70%',
      paddingHorizontal: 8,
      paddingBottom: 10,
    },
    // Glass panel for the category list — children manage their own horizontal
    // padding, so drop GlassCard's default 20 and let it shrink to maxHeight.
    filterGlass: {
      padding: 0,
      paddingTop: 6,
      flexShrink: 1,
    },
    filterHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255,255,255,0.06)',
    },
    filterTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    filterTitleEmoji: {
      fontSize: 20,
      lineHeight: 24,
      textShadowColor: accentColor,
      textShadowRadius: 12,
      textShadowOffset: { width: 0, height: 0 },
    },
    filterTitle: {
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    clearFilterText: {
      color: accentColor,
      fontSize: 12,
      letterSpacing: 1,
      fontWeight: '600',
      textTransform: 'uppercase',
    },
    filterList: {
      paddingHorizontal: 24,
      paddingTop: 12,
    },
    filterEmpty: {
      color: theme.muted,
      fontSize: 14,
      textAlign: 'center',
      paddingVertical: 32,
    },
    filterItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255,255,255,0.05)',
      gap: 12,
    },
    filterItemEmoji: {
      fontSize: 24,
      lineHeight: 28,
      width: 28,
      textAlign: 'center',
      textShadowColor: accentColor,
      textShadowRadius: 12,
      textShadowOffset: { width: 0, height: 0 },
    },
    filterItemBody: {
      flex: 1,
      gap: 4,
    },
    filterItemDescription: {
      color: '#ffffff',
      fontSize: 16,
      lineHeight: 21,
      fontWeight: '500',
    },
    filterItemMeta: {
      color: theme.muted,
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    filterRestBtn: {
      backgroundColor: accentColor,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 20,
      alignSelf: 'center',
      shadowColor: accentColor,
      shadowOpacity: 0.6,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 5,
    },
    filterRestBtnText: {
      color: HUD_BG,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
  });
}
