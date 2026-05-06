export type Signal = {
  id: number | string;
  description?: string;
  sender?: string;
  status?: string;
  eta?: string | null;
  type?: string;
  state?: string;
};

export type TypeMeta = { emoji: string; color: string; label: string };

export const TYPE_META: Record<string, TypeMeta> = {
  package:     { emoji: '📦', color: '#60a5fa', label: 'Package' },
  food:        { emoji: '🍽', color: '#f59e0b', label: 'Food' },
  grocery:     { emoji: '🛒', color: '#a3e635', label: 'Grocery' },
  service:     { emoji: '🔧', color: '#86efac', label: 'Service' },
  reservation: { emoji: '🗓', color: '#f9a8d4', label: 'Reservation' },
  travel:      { emoji: '✈️', color: '#2dd4bf', label: 'Travel' },
  deadline:    { emoji: '⚠️', color: '#fbbf24', label: 'Deadline' },
  urgent:      { emoji: '🚨', color: '#ef4444', label: 'Urgent' },
};

export const DEFAULT_META = TYPE_META.urgent;

export const LEGEND_ORDER = [
  'package',
  'food',
  'grocery',
  'service',
  'reservation',
  'travel',
  'deadline',
  'urgent',
];

export function metaFor(s: Signal): TypeMeta {
  if (s.type && TYPE_META[s.type]) return TYPE_META[s.type];
  return DEFAULT_META;
}

export function typeKeyFor(s: Signal): string {
  if (s.type && TYPE_META[s.type]) return s.type;
  return 'urgent';
}
