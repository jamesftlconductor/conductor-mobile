import { Tabs } from 'expo-router';
import { Activity, RadioTower, Settings as SettingsIcon } from 'lucide-react-native';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ground',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="hover"
        options={{
          title: 'Hover',
          tabBarIcon: ({ color }) => <RadioTower size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="vitals"
        options={{
          title: 'Vitals',
          tabBarIcon: ({ color }) => <Activity size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <SettingsIcon size={26} color={color} />,
        }}
      />
    </Tabs>
  );
}
