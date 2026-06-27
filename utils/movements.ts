// The four Movements — full-screen destinations reached by directional swipe
// from The Conductor (Hover). Shared by the radar swipe nav, the directional
// hint labels, the Movement screens, and Settings → The Baton → Your Movements.

export type MovementKey = 'home' | 'work' | 'family' | 'wellness';
export type SwipeDirection = 'up' | 'right' | 'down' | 'left';

export type Movement = {
  key: MovementKey;
  emoji: string;
  /** "The Home Movement" — used in lists/ranking. */
  label: string;
  /** "THE HOME MOVEMENT" — the glass-card header. */
  title: string;
  /** What the movement watches. */
  subtitle: string;
  route: string;
  direction: SwipeDirection;
  /** Arrow glyph matching the swipe direction. */
  arrow: string;
  /** AsyncStorage key flipped true once the user has swiped this way. */
  discoveredKey: string;
  /** Per-movement GlassCard tint. */
  glassTint: string;
  /** Per-movement corner-bracket color. Omitted = the theme accent. */
  bracketColor?: string;
  /** Vivid signature color used in the chord indicator, brief text, signal
   *  chip borders, and anywhere a movement is referenced. */
  color: string;
};

export const MOVEMENTS: Movement[] = [
  {
    key: 'home',
    emoji: '🏠',
    label: 'The Home Movement',
    title: 'THE HOME MOVEMENT',
    subtitle: 'your house, maintained',
    route: '/movement-home',
    direction: 'up',
    arrow: '↑',
    discoveredKey: 'movement:home:discovered',
    glassTint: 'rgba(20, 14, 6, 0.72)', // warm amber
    bracketColor: '#c9a227', // warm brass
    color: '#d2a24c', // warm amber
  },
  {
    key: 'work',
    emoji: '💼',
    label: 'The Work Movement',
    title: 'THE WORK MOVEMENT',
    subtitle: 'your schedule, protected',
    route: '/movement-work',
    direction: 'right',
    arrow: '→',
    discoveredKey: 'movement:work:discovered',
    glassTint: 'rgba(6, 10, 20, 0.72)', // cool blue-black
    // bracketColor omitted → theme accent (precise, professional)
    color: '#5b9bd5', // cool blue
  },
  {
    key: 'family',
    emoji: '👨‍👩‍👧',
    label: 'The Family Movement',
    title: 'THE FAMILY MOVEMENT',
    subtitle: 'the people in your life',
    route: '/movement-family',
    direction: 'down',
    arrow: '↓',
    discoveredKey: 'movement:family:discovered',
    glassTint: 'rgba(20, 10, 10, 0.72)', // warm rose-black
    bracketColor: 'rgba(200, 100, 80, 0.6)', // warm rose accent
    color: '#d17a6a', // warm rose
  },
  {
    key: 'wellness',
    emoji: '❤️',
    label: 'The Wellness Movement',
    title: 'THE WELLNESS MOVEMENT',
    subtitle: 'your health, considered',
    route: '/movement-wellness',
    direction: 'left',
    arrow: '←',
    discoveredKey: 'movement:wellness:discovered',
    glassTint: 'rgba(6, 14, 10, 0.72)', // deep green-black
    bracketColor: 'rgba(80, 160, 100, 0.6)', // calm green accent
    color: '#5cb377', // calm green
  },
];

export const MOVEMENT_BY_DIRECTION: Record<SwipeDirection, Movement> = MOVEMENTS.reduce(
  (acc, m) => {
    acc[m.direction] = m;
    return acc;
  },
  {} as Record<SwipeDirection, Movement>,
);

/** Default rank order (key list) for "Your Movements" before the user reorders. */
export const MOVEMENT_KEYS: MovementKey[] = MOVEMENTS.map((m) => m.key);
