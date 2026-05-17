// Contextual tutorial tooltip. Renders a dark pill with brass border
// and an off-white message, positioned absolutely beneath the
// triggering element. Designed to be mounted once on first use of
// a feature and never again — the calling screen gates rendering on
// an AsyncStorage flag.
//
// The tooltip never blocks interaction by default. Tap "Got it" (or
// outside, where the parent passes the dismiss handler) to dismiss.
// Some callers auto-dismiss after a few seconds — that's handled by
// the parent via the visible prop.

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const BG = 'rgba(0,0,0,0.85)';
const BRASS = '#b8960c';
const OFF_WHITE = '#f0ede8';

type Props = {
  visible: boolean;
  message: string;
  onDismiss: () => void;
  arrow?: 'up' | 'down' | 'none';
  showButton?: boolean;
  // Optional absolute-position offsets. When unset, callers should
  // wrap the tooltip in a parent that provides its own positioning.
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
};

export function Tooltip({
  visible,
  message,
  onDismiss,
  arrow = 'up',
  showButton = true,
  top,
  left,
  right,
  bottom,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 220,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  if (!visible) return null;

  const positionStyle: any = { position: 'absolute' };
  if (top != null) positionStyle.top = top;
  if (left != null) positionStyle.left = left;
  if (right != null) positionStyle.right = right;
  if (bottom != null) positionStyle.bottom = bottom;

  return (
    <Animated.View style={[positionStyle, styles.wrap, { opacity }]} pointerEvents="box-none">
      {arrow === 'up' && <View style={styles.arrowUp} />}
      <View style={styles.bubble}>
        <Text style={styles.message}>{message}</Text>
        {showButton && (
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.btn}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Text style={styles.btnText}>Got it</Text>
          </TouchableOpacity>
        )}
      </View>
      {arrow === 'down' && <View style={styles.arrowDown} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', maxWidth: 320 },
  bubble: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BRASS,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  message: {
    color: OFF_WHITE,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  btn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  btnText: {
    color: BRASS,
    fontSize: 12,
    fontWeight: '600',
  },
  arrowUp: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: BRASS,
    marginBottom: -1,
  },
  arrowDown: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: BRASS,
    marginTop: -1,
  },
});
