import { router, Tabs, usePathname } from 'expo-router';
import { Activity, RadioTower, Settings as SettingsIcon } from 'lucide-react-native';
import React, { useRef } from 'react';
import { PanResponder, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Swipe navigation order — mirrors the visible bottom tab bar so a swipe never
// skips a reachable tab: Ground (The Brief) → Hover (The Conductor) → Vitals →
// Settings (The Hubs). NOTE: the product spec described three tabs
// (Brief → Conductor → Hubs); Vitals is included here only because it's still
// a visible tab. Drop it from this array (and the tab bar) to match the
// three-tab model.
const SWIPE_ROUTES = ['/(tabs)', '/(tabs)/hover', '/(tabs)/vitals', '/(tabs)/settings'] as const;

// Resolve the current tab index from the live pathname.
function indexFromPath(path: string): number {
  if (path.startsWith('/hover')) return 1;
  if (path.startsWith('/vitals')) return 2;
  if (path.startsWith('/settings')) return 3;
  return 0; // index / Ground / everything else
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  // Keep the latest pathname in a ref so the (stable) PanResponder closure
  // always reads the current tab without being rebuilt each render.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const panResponder = useRef(
    PanResponder.create({
      // Never pre-empt children — let horizontal ScrollViews, the collapsible
      // Hover bar, and any element with its own horizontal gesture win the
      // touch if they claim it first.
      onMoveShouldSetPanResponderCapture: () => false,
      // Only claim clear horizontal swipes: >20px horizontal AND at least
      // twice as horizontal as vertical (so vertical scrolls pass through).
      onMoveShouldSetPanResponder: (_evt, g) =>
        Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_evt, g) => {
        const SWIPE_THRESHOLD = 60; // guards against accidental nav while scrolling
        if (Math.abs(g.dx) < SWIPE_THRESHOLD) return;
        const current = indexFromPath(pathnameRef.current || '/');
        const nextIndex = g.dx < 0 ? current + 1 : current - 1;
        if (nextIndex < 0 || nextIndex >= SWIPE_ROUTES.length) return;
        router.push(SWIPE_ROUTES[nextIndex] as never);
      },
    })
  ).current;

  return (
    <View style={{ flex: 1 }} {...panResponder.panHandlers}>
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
    </View>
  );
}
