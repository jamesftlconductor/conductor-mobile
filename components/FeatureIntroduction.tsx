// First-tap feature introduction modal. Pairs with useDiscovered to
// onboard a user to surfaces they haven't met yet. Caller passes the
// content as props so the same modal renders any intro the calling
// screen needs.

import React from 'react';
import { Modal, Text, Pressable } from 'react-native';

import { useTheme } from '@/app/theme';

interface Props {
  visible: boolean;
  featureId: string;
  name: string;
  description: string;
  icon: string;
  onDismiss: () => void;
}

export default function FeatureIntroduction({
  visible,
  name,
  description,
  icon,
  onDismiss,
}: Props) {
  const { theme, accentColor } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}>
      {/* Pressable backdrop — tapping outside the card dismisses. */}
      <Pressable
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 32,
        }}
        onPress={onDismiss}>
        {/* Inner Pressable absorbs the press so a tap on the card doesn't
            fall through to the backdrop AND — critically — gives the card
            its own touch responder. The previous version nested the "Got it"
            TouchableOpacity inside a plain <View> inside the backdrop
            TouchableOpacity; on iOS that View never claimed the responder,
            so the parent backdrop swallowed the press and the button wasn't
            reliably tappable. This mirrors the working modal pattern (Pressable
            backdrop + Pressable absorber) used elsewhere on the Ground screen. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.surface,
            borderRadius: 16,
            padding: 24,
            width: '100%',
            alignItems: 'center',
          }}>
          <Text style={{ fontSize: 32, marginBottom: 12 }}>{icon}</Text>
          <Text
            style={{
              color: '#F5F0E8',
              fontSize: 18,
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: 8,
            }}>
            {name}
          </Text>
          <Text
            style={{
              color: theme.muted,
              fontSize: 14,
              lineHeight: 22,
              textAlign: 'center',
              marginBottom: 20,
            }}>
            {description}
          </Text>
          <Pressable
            onPress={onDismiss}
            hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
            style={({ pressed }) => ({
              paddingVertical: 8,
              paddingHorizontal: 16,
              opacity: pressed ? 0.6 : 1,
            })}>
            <Text style={{ color: accentColor, fontSize: 15, fontWeight: '600' }}>
              Got it →
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
