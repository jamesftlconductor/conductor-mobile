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
  },
  {
    key: 'family',
    emoji: '👨‍👩‍👧',
    label: 'The Family Movement',
    title: 'THE FAMILY MOVEMENT',
    subtitle: 'the people you come home to',
    route: '/movement-family',
    direction: 'down',
    arrow: '↓',
    discoveredKey: 'movement:family:discovered',
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
