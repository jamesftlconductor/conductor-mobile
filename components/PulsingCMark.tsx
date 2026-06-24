import { useEffect, useRef } from 'react';
import { Animated, Easing, type ImageStyle, type StyleProp } from 'react-native';

import { useTheme } from '@/app/theme';

// Pulsing C mark — the brand-forward replacement for ActivityIndicator
// across loading states. The C icon breathes its opacity 0.4 → 1 → 0.4
// on a 1.4s cycle (useNativeDriver, so it keeps animating even while JS
// is busy fetching). `size` drives both width and height since icon.png
// is square; pass ~30 for screen/section placeholders and ~18 inside
// buttons.
export function PulsingCMark({
  size = 28,
  style,
}: {
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  const { logoColor } = useTheme();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.Image
      source={require('../assets/c-mark.png')}
      resizeMode="contain"
      style={[{ width: size, height: size, opacity: pulse, tintColor: logoColor }, style]}
    />
  );
}
