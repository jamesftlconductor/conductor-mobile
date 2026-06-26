// Horizontal swipe navigation across the bottom tabs:
//   Ground (0) → Hover (1) → Vitals (2) → Settings (3)
// Swipe left → next tab, swipe right → previous tab. activeOffsetX defers to
// horizontal intent only and failOffsetY lets vertical scrolling win, so the
// gesture coexists with each screen's ScrollView. Plain function (not a hook)
// so callers can build it after early returns, matching the existing inline
// Gesture.Pan() pattern.

import { router } from 'expo-router';
import { Gesture } from 'react-native-gesture-handler';

const TAB_ROUTES = ['/(tabs)', '/(tabs)/hover', '/(tabs)/vitals', '/(tabs)/settings'];

export function makeTabSwipe(currentIndex: number) {
  return Gesture.Pan()
    .activeOffsetX([-30, 30])
    .failOffsetY([-20, 20])
    .runOnJS(true)
    .onEnd((e) => {
      if (Math.abs(e.translationY) > 80) return;
      if (e.translationX < -60) {
        const next = TAB_ROUTES[currentIndex + 1];
        if (next) router.navigate(next as never);
      } else if (e.translationX > 60) {
        const prev = TAB_ROUTES[currentIndex - 1];
        if (prev) router.navigate(prev as never);
      }
    });
}
