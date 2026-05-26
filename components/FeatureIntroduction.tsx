// First-tap feature introduction modal. Pairs with useDiscovered to
// onboard a user to surfaces they haven't met yet. Caller passes the
// content as props so the same modal renders any intro the calling
// screen needs.

import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      {/* Outer TouchableOpacity is the tap-outside-to-dismiss
          backdrop. activeOpacity:1 keeps it from visibly flashing
          on tap; only the dismiss handler fires. */}
      <TouchableOpacity
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 32,
        }}
        activeOpacity={1}
        onPress={onDismiss}>
        <View
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
          <TouchableOpacity onPress={onDismiss}>
            <Text style={{ color: accentColor, fontSize: 15, fontWeight: '600' }}>
              Got it →
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
