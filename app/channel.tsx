// Crew Channel — household-scoped message log with Conductor system
// notes inline. Backend at /api/channel; this screen polls every 10s
// for new messages, marks the user's unread counter to zero on mount,
// and posts via /api/channel POST.
//
// Message-bubble style discriminator:
//   - senderId === currentUser  → right-aligned accent bubble
//   - senderId === 'conductor'  → centered muted italic with conductor mark
//   - otherwise                 → left-aligned surface bubble + name
//
// @Conductor mention support — if the user starts a message with
// "@Conductor" / "@conductor", we POST to /api/ask first and append
// the answer as a Conductor system message. Falls through to a
// regular channel post on /api/ask failure so the user's text still
// shows up.

import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@/app/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useUserId } from '@/hooks/useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';
const POLL_MS = 10_000;

type ChannelMessage = {
  id: string;
  householdId: string;
  senderId: string;
  senderName: string;
  text: string | null;
  attachedSignalId: string | number | null;
  mediaUrl: string | null;
  mediaType: string | null;
  createdAt: string;
};

export default function ChannelScreen() {
  const userId = useUserId();
  if (!userId) return null;
  const { theme, accentColor } = useTheme();
  const styles = useMemo(() => makeStyles(theme, accentColor), [theme, accentColor]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/channel?userId=${userId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.messages)) {
        setMessages(data.messages);
      }
    } catch { /* silent */ }
  }, []);

  // On mount: load + mark-read; set up the 10s poll.
  useEffect(() => {
    load();
    fetch(`${API_BASE}/channel/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId }),
    }).catch(() => {});
    pollTimer.current = setInterval(load, POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [load]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');

    const isAskConductor = /^@conductor\b/i.test(text);

    try {
      // Persist the user's message either way so the conversation
      // history is intact even if the Ask Conductor branch fails.
      await fetch(`${API_BASE}/channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, text }),
      });

      if (isAskConductor) {
        // Strip the prefix before forwarding to /api/ask.
        const question = text.replace(/^@conductor\s*/i, '').trim();
        if (question.length > 0) {
          try {
            const askRes = await fetch(`${API_BASE}/ask`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: userId, question }),
            });
            if (askRes.ok) {
              const askData = await askRes.json();
              const answer = typeof askData?.answer === 'string' ? askData.answer : null;
              if (answer) {
                await fetch(`${API_BASE}/channel`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userId: userId,
                    senderId: 'conductor',
                    text: answer,
                  }),
                });
              }
            }
          } catch { /* fall through — user's text already posted */ }
        }
      }

      await load();
    } catch (err) {
      console.warn('[channel] send failed:', err);
    } finally {
      setSending(false);
    }
  }

  function renderItem({ item }: { item: ChannelMessage }) {
    const isConductor = item.senderId === 'conductor';
    const isMine = item.senderId === userId;

    if (isConductor) {
      return (
        <View style={styles.conductorRow}>
          <Text style={styles.conductorMark}>◉</Text>
          <Text style={styles.conductorText}>
            {item.text}
          </Text>
        </View>
      );
    }

    return (
      <View style={[styles.row, { justifyContent: isMine ? 'flex-end' : 'flex-start' }]}>
        <View style={{ maxWidth: '75%' }}>
          {!isMine ? (
            <Text style={styles.senderName}>{item.senderName}</Text>
          ) : null}
          <View
            style={[
              styles.bubble,
              isMine ? styles.bubbleMine : styles.bubbleOther,
            ]}>
            {item.text ? (
              <Text style={[styles.bubbleText, isMine && { color: '#0f0f0f' }]}>
                {item.text}
              </Text>
            ) : null}
          </View>
          {item.mediaUrl && (item.mediaType || '').startsWith('image') ? (
            <Image source={{ uri: item.mediaUrl }} style={styles.mediaImage} />
          ) : null}
          {item.attachedSignalId ? (
            <TouchableOpacity
              activeOpacity={0.6}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => router.push(`/horizon` as never)}
              style={styles.signalCard}>
              <Text style={styles.signalCardText} numberOfLines={1}>
                Attached signal — open in Horizon →
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Crew Channel" screenContext="channel" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}>
        {messages.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>Your crew channel is quiet.</Text>
            <Text style={styles.emptySub}>
              Messages, signal updates, and Conductor notes all appear here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 }}
          />
        )}

        <View style={styles.inputBar}>
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                'Attach',
                'Coming soon — signal pickers + photo/video attachments.',
                [{ text: 'OK' }],
              )
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.attachBtn}>
            <Text style={styles.attachGlyph}>📎</Text>
          </TouchableOpacity>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Message your household…"
            placeholderTextColor={theme.muted}
            style={styles.input}
            multiline
          />
          <TouchableOpacity
            onPress={send}
            disabled={!input.trim() || sending}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[
              styles.sendBtn,
              { backgroundColor: input.trim() ? accentColor : theme.muted },
            ]}>
            <Text style={styles.sendGlyph}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

import { useMemo } from 'react';

type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  border?: string;
};

function makeStyles(theme: ThemeColors, accentColor: string) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      marginVertical: 4,
    },
    senderName: {
      color: theme.muted,
      fontSize: 10,
      letterSpacing: 0.5,
      marginBottom: 2,
      marginLeft: 4,
    },
    bubble: {
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    bubbleMine: {
      backgroundColor: accentColor,
      borderRadius: 16,
      borderBottomRightRadius: 4,
    },
    bubbleOther: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      borderBottomLeftRadius: 4,
    },
    bubbleText: {
      color: theme.text,
      fontSize: 14,
      lineHeight: 19,
    },
    conductorRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginVertical: 10,
      gap: 6,
      paddingHorizontal: 24,
    },
    conductorMark: {
      color: accentColor,
      fontSize: 12,
    },
    conductorText: {
      color: theme.muted,
      fontSize: 13,
      fontStyle: 'italic',
      flexShrink: 1,
      textAlign: 'center',
    },
    mediaImage: {
      width: 200,
      height: 200,
      borderRadius: 8,
      marginTop: 6,
    },
    signalCard: {
      marginTop: 6,
      backgroundColor: theme.surface,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border || 'rgba(255,255,255,0.08)',
    },
    signalCardText: {
      color: theme.muted,
      fontSize: 12,
    },
    emptyWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 40,
    },
    emptyTitle: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 8,
    },
    emptySub: {
      color: theme.muted,
      fontSize: 13,
      textAlign: 'center',
      lineHeight: 19,
    },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border || 'rgba(255,255,255,0.08)',
      backgroundColor: theme.background,
    },
    attachBtn: {
      paddingVertical: 8,
      paddingHorizontal: 6,
    },
    attachGlyph: {
      fontSize: 20,
    },
    input: {
      flex: 1,
      color: theme.text,
      fontSize: 14,
      minHeight: 36,
      maxHeight: 100,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    sendBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendGlyph: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
