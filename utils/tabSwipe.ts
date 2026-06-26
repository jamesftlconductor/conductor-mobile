// Tab swipe navigation is now handled by a root-level PanResponder in
// app/(tabs)/_layout.tsx (the gesture-handler attempt here never worked
// reliably and competed with the screens' ScrollViews). makeTabSwipe is kept
// as a DISABLED gesture so the existing GestureDetector wrappers in the tab
// screens stay valid but never claim a touch — leaving horizontal swipes for
// the PanResponder. The currentIndex param is ignored.

import { Gesture } from 'react-native-gesture-handler';

export function makeTabSwipe(_currentIndex: number) {
  // Disabled — does not activate, so the root PanResponder owns tab swipes.
  return Gesture.Pan().enabled(false);
}
