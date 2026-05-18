// Swipe-left-to-reveal-actions row. Drop in around any list item
// to expose a Rest / Remove pair behind it. Snaps to reveal at 80px
// of leftward drag; snaps back if released earlier. Action buttons
// slide in from the right as the row slides left.

import { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PanGestureHandler, PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedGestureHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const BRASS = '#b8960c';
const REMOVE = '#d97757';

const SNAP_OPEN = -180; // distance row slides left when actions revealed
const SNAP_THRESHOLD = -60;

type Props = {
  onRest?: () => void;
  onRemove?: () => void;
  children: ReactNode;
  // Optional override labels — defaults match the spec.
  restLabel?: string;
  removeLabel?: string;
};

export function SwipeableRow({
  onRest,
  onRemove,
  children,
  restLabel = 'Rest ✓',
  removeLabel = 'Remove',
}: Props) {
  const translateX = useSharedValue(0);

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent>({
    onActive: (event) => {
      // Clamp downward + rightward — only leftward drag reveals actions.
      if (event.translationX < 0) {
        translateX.value = Math.max(event.translationX, SNAP_OPEN);
      }
    },
    onEnd: (event) => {
      if (event.translationX < SNAP_THRESHOLD || event.velocityX < -500) {
        translateX.value = withSpring(SNAP_OPEN, { damping: 18, stiffness: 180 });
      } else {
        translateX.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    },
  });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  function closeAndRun(fn?: () => void) {
    translateX.value = withTiming(0, { duration: 160 });
    if (fn) {
      // Defer the action a beat so the snap-closed animation has time
      // to read before any list re-render shifts things.
      setTimeout(fn, 80);
    }
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.actionsRow} pointerEvents="box-none">
        {onRest ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.restBtn]}
            onPress={() => {
              runOnJS(closeAndRun)(onRest);
            }}>
            <Text style={styles.restText}>{restLabel}</Text>
          </TouchableOpacity>
        ) : null}
        {onRemove ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.removeBtn]}
            onPress={() => {
              runOnJS(closeAndRun)(onRemove);
            }}>
            <Text style={styles.removeText}>{removeLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <PanGestureHandler
        onGestureEvent={gestureHandler}
        activeOffsetX={[-12, 12]}
        failOffsetY={[-10, 10]}>
        <Animated.View style={[styles.row, rowStyle]}>{children}</Animated.View>
      </PanGestureHandler>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  row: {
    backgroundColor: '#0f0f0f',
  },
  actionsRow: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  actionBtn: {
    width: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restBtn: {
    backgroundColor: 'rgba(184, 150, 12, 0.18)',
  },
  removeBtn: {
    backgroundColor: 'rgba(217, 119, 87, 0.15)',
  },
  restText: {
    color: BRASS,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  removeText: {
    color: REMOVE,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
});
