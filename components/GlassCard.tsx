import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '../app/theme';

// Frosted glass card — a "manufactured glass panel" used on Ground to lift
// content off the weather photo. Neither expo-blur, @react-native-community/blur
// nor expo-linear-gradient is installed, so: the dark 0.72 tint stands in for
// the blur, and the light-catch / inner-shadow gradients are drawn with
// react-native-svg. Light is treated as coming from above — hence the brighter
// top border, the top highlight, and the dark inner-shadow at the top edge.
export function GlassCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { accentColor } = useTheme();
  return (
    <View style={[styles.card, style]}>
      {children}
      {/* Non-interactive glass surface FX layered over the content edges. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {/* Top highlight — glass catching light from above (0.04 → 0, 40px). */}
        <View style={styles.topLight}>
          <Svg width="100%" height={40}>
            <Defs>
              <LinearGradient id="glassTopLight" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#ffffff" stopOpacity={0.04} />
                <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="40" fill="url(#glassTopLight)" />
          </Svg>
        </View>
        {/* Inner shadow at the very top inside edge — glass thickness (0.25 → 0). */}
        <View style={styles.topShadow}>
          <Svg width="100%" height={8}>
            <Defs>
              <LinearGradient id="glassTopShadow" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity={0.25} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="8" fill="url(#glassTopShadow)" />
          </Svg>
        </View>
        {/* Inner accent glow — faint energized rim just inside the border. */}
        <View style={[styles.innerGlow, { borderColor: accentColor + '0a' }]} />
        {/* Corner bracket clamps — accent at 0.35 (59 hex), 1.5px, 16px arms. */}
        <View style={[styles.bracket, styles.bracketTL, { borderColor: accentColor + '59' }]} />
        <View style={[styles.bracket, styles.bracketTR, { borderColor: accentColor + '59' }]} />
        <View style={[styles.bracket, styles.bracketBL, { borderColor: accentColor + '59' }]} />
        <View style={[styles.bracket, styles.bracketBR, { borderColor: accentColor + '59' }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(8, 12, 20, 0.72)',
    // Per-side borders, light from above: bright top, dim bottom, mid sides.
    borderTopWidth: 0.5,
    borderBottomWidth: 0.5,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.18)',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    borderRightColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  topLight: { position: 'absolute', top: 0, left: 0, right: 0, height: 40 },
  topShadow: { position: 'absolute', top: 0, left: 0, right: 0, height: 8 },
  innerGlow: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderWidth: 1,
    borderRadius: 15,
  },
  bracket: { position: 'absolute', width: 16, height: 16 },
  bracketTL: { top: 6, left: 6, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  bracketTR: { top: 6, right: 6, borderTopWidth: 1.5, borderRightWidth: 1.5 },
  bracketBL: { bottom: 6, left: 6, borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
  bracketBR: { bottom: 6, right: 6, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
});
