import { router, Tabs, usePathname } from 'expo-router';
import { RadioTower, Settings as SettingsIcon } from 'lucide-react-native';
import React, { useRef } from 'react';
import { Dimensions, PanResponder, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Three tabs only: Ground (The Brief) → Hover (The Conductor) → Settings (The
// Hubs). Vitals is hidden from the bar (href: null) but its route is kept so it
// can be absorbed into The Conductor tab later. Swipe order mirrors the bar.
const SWIPE_ROUTES = ['/(tabs)', '/(tabs)/hover', '/(tabs)/settings'] as const;

// Only swipes that START in the outer 20% of the screen width switch tabs.
// Center-originating swipes are left for the active screen (e.g. Hover's
// directional navigation), which would otherwise be pre-empted by this
// root responder.
const { width: SCREEN_W } = Dimensions.get('window');
const EDGE_FRACTION = 0.2;

// Resolve the current tab index from the live pathname.
function indexFromPath(path: string): number {
  if (path.startsWith('/hover')) return 1;
  if (path.startsWith('/settings')) return 2;
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
      // twice as horizontal as vertical (so vertical scrolls pass through) —
      // AND only when the swipe STARTED in the outer 20% of the width. Center
      // swipes fall through to the active screen's own gesture handler.
      onMoveShouldSetPanResponder: (_evt, g) => {
        const horizontal = Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
        if (!horizontal) return false;
        return g.x0 < SCREEN_W * EDGE_FRACTION || g.x0 > SCREEN_W * (1 - EDGE_FRACTION);
      },
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
        {/* Vitals — hidden from the tab bar for now (to be absorbed into The
            Conductor tab). href: null keeps the route reachable but off the bar. */}
        <Tabs.Screen name="vitals" options={{ href: null }} />
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
