// Reusable swipe-down-to-dismiss wrapper for bottom sheets.
//
// Usage: replace the existing Pressable/View that holds the sheet
// content with <SwipeDismissSheet onClose={...}>{content}</SwipeDismissSheet>.
// The wrapper:
//   - Renders a brass-ish drag handle at the top
//   - Tracks downward pan via PanGestureHandler
//   - Dismisses on release if drag > 80px OR velocity > 500
//   - Springs back to 0 otherwise
//
// Spring config matches the spec: { tension: 100, friction: 12 }-ish
// via withSpring's default mass model — feels snappy.

import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { PanGestureHandler, PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  onClose: () => void;
  style?: any;
  children: ReactNode;
  // Pixels of drag below which we spring back. Default 80 per spec.
  threshold?: number;
  // Velocity (pts/s) above which we dismiss regardless of distance.
  velocityThreshold?: number;
};

export function SwipeDismissSheet({
  onClose,
  style,
  children,
  threshold = 80,
  velocityThreshold = 500,
}: Props) {
  const translateY = useSharedValue(0);

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onActive: (event) => {
      // Only track downward drags — upward should be a no-op so the
      // sheet doesn't lift off the bottom of the screen.
      if (event.translationY > 0) {
        translateY.value = event.translationY;
      }
    },
    onEnd: (event) => {
      if (event.translationY > threshold || event.velocityY > velocityThreshold) {
        // Slide the sheet the rest of the way off-screen before
        // unmounting so dismiss reads as a single continuous motion.
        translateY.value = withTiming(600, { duration: 180 }, () => {
          runOnJS(onClose)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 12, stiffness: 100 });
      }
    },
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <PanGestureHandler onGestureEvent={gestureHandler} activeOffsetY={[-1, 1]}>
      <Animated.View style={[style, animatedStyle]}>
        <View style={styles.dragHandle} />
        {children}
      </Animated.View>
    </PanGestureHandler>
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
