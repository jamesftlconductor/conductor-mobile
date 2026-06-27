import { View } from 'react-native';
import {
  CalendarClock,
  CircleDot,
  Coins,
  House,
  Package,
  Plane,
  Utensils,
  Wrench,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useTheme } from '@/app/theme';
import { categoryForType } from '@/utils/signalCategories';

// One lucide icon per Customize category. A signal's raw `type` is collapsed to
// its category via categoryForType, so every signal resolves to exactly one.
const CATEGORY_ICON: Record<string, LucideIcon> = {
  delivery: Package,
  food: Utensils,
  service: Wrench,
  financial: Coins,
  travel: Plane,
  deadline: CalendarClock,
  home: House,
  other: CircleDot,
};

// HUD-style signal glyph: a lucide icon tinted in the accent (or an override)
// with a subtle accent glow. Replaces the old per-type emoji.
export function SignalIcon({
  type,
  size = 16,
  color,
  glow = true,
  strokeWidth = 2,
}: {
  type?: string | null;
  size?: number;
  color?: string;
  glow?: boolean;
  strokeWidth?: number;
}) {
  const { accentColor } = useTheme();
  const tint = color ?? accentColor;
  // Accept either a raw signal type (mapped via categoryForType) OR a category
  // key directly (e.g. a Customize picker iterating the 8 keys like 'home',
  // which isn't itself one of its member raw types).
  const key = type && CATEGORY_ICON[type] ? type : categoryForType(type);
  const Icon = CATEGORY_ICON[key] ?? CircleDot;
  return (
    <View
      style={
        glow
          ? {
              shadowColor: tint,
              shadowOpacity: 0.7,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 0 },
            }
          : undefined
      }>
      <Icon size={size} color={tint} strokeWidth={strokeWidth} />
    </View>
  );
}
