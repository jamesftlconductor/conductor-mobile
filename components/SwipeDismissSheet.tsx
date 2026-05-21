// Reusable swipe-down-to-dismiss wrapper for bottom sheets.
//
// Rewritten 2026-05-18 to use the v3+ Gesture API. The previous
// implementation imported `useAnimatedGestureHandler` from
// react-native-reanimated, but that hook was removed in v3.
// With reanimated v4.1.1 installed, the import was `undefined`
// at runtime — every sheet using this wrapper crashed on render.
//
// Usage: replace the existing Pressable/View that holds the sheet
// content with <SwipeDismissSheet onClose={...}>{content}</SwipeDismissSheet>.

import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  onClose: () => void;
  style?: any;
  children: ReactNode;
  threshold?: number;
  velocityThreshold?: number;
  // When false, the Pan gesture is disabled — useful for the
  // arm-delay pattern on bottom sheets so the same tap that opened
  // the sheet can't have its finger-release velocity register as a
  // swipe-down dismissal. Defaults to true (gesture always active).
  enabled?: boolean;
};

export function SwipeDismissSheet({
  onClose,
  style,
  children,
  threshold = 80,
  velocityThreshold = 500,
  enabled = true,
}: Props) {
  const translateY = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(enabled !== false)
    .activeOffsetY([-1, 1])
    .onUpdate((event) => {
      // Only track downward drags.
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (event.translationY > threshold || event.velocityY > velocityThreshold) {
        translateY.value = withTiming(600, { duration: 180 }, () => {
          runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 12, stiffness: 100 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[style, animatedStyle]}>
        <View style={styles.dragHandle} />
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
});
