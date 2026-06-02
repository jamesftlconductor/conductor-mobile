export type Signal = {
  id: number | string;
  description?: string;
  sender?: string;
  status?: string;
  eta?: string | null;
  type?: string;
  state?: string;
  // Optional ingestion/edit timestamps — used by the Hover age-pressure
  // calculation to widen the pulse rate as a signal lingers unresolved.
  lastUpdate?: string;
  createdAt?: string;
  // userId is set on signals the user added themselves (manual or
  // junior-relay). Used by horizon.tsx + Minimap to display an owner
  // tag when the signal isn't tied to the current user.
  userId?: string | null;
  // Emotional layer — set by the import classifier (api/import.js) and
  // by manual signal creation (defaults neutral/low). FinaleSheet
  // surfaces a "How does this feel?" override for high-intensity
  // signals so the user can correct the auto-classification.
  emotionalValence?: 'joyful' | 'neutral' | 'stressful' | 'grief';
  emotionalIntensity?: 'high' | 'medium' | 'low';
  // Set by the backend thread detector (api/import.js) and trip-thread
  // synthesis (api/trip-threads.js). Signals sharing a threadId belong to
  // one trip/thread and are collapsed into a single cluster dot on Hover.
  threadId?: string;
};

export type TypeMeta = { emoji: string; color: string; label: string };

export const TYPE_META: Record<string, TypeMeta> = {
  package:     { emoji: '📦', color: '#60a5fa', label: 'Package' },
  delivery:    { emoji: '🚚', color: '#7dd3fc', label: 'Delivery' },
  food:        { emoji: '🍽', color: '#f59e0b', label: 'Food' },
  grocery:     { emoji: '🛒', color: '#a3e635', label: 'Grocery' },
  service:     { emoji: '🔧', color: '#86efac', label: 'Service' },
  reservation: { emoji: '🗓', color: '#f9a8d4', label: 'Reservation' },
  appointment: { emoji: '📅', color: '#c4b5fd', label: 'Appointment' },
  travel:      { emoji: '✈️', color: '#2dd4bf', label: 'Travel' },
  deadline:    { emoji: '⚠️', color: '#fbbf24', label: 'Deadline' },
  unknown:     { emoji: '📍', color: '#8a8780', label: 'Unknown' },
  urgent:      { emoji: '🚨', color: '#ef4444', label: 'Urgent' },
};

export const DEFAULT_META = TYPE_META.urgent;

// Used when a signal's type isn't recognized AND we want to avoid the 🚨
// fallback (e.g. on middle/outer rings, where ring position is meant to
// convey urgency, not a separate red emoji).
export const NEUTRAL_META: TypeMeta = { emoji: '📍', color: '#8a8780', label: 'Signal' };

export const LEGEND_ORDER = [
  'package',
  'delivery',
  'food',
  'grocery',
  'service',
  'reservation',
  'appointment',
  'travel',
  'deadline',
  'unknown',
  'urgent',
];

export function metaFor(s: Signal): TypeMeta {
  if (s.type && TYPE_META[s.type]) return TYPE_META[s.type];
  return DEFAULT_META;
}

// Ring-aware variant: when the signal's type is unrecognized, only the inner
// ring shows 🚨 (the urgent fallback). Middle/outer rings show a calm neutral
// pin instead, since their visual urgency comes from ring position alone.
export function metaForRing(s: Signal, ring: 'inner' | 'middle' | 'outer'): TypeMeta {
  if (s.type && TYPE_META[s.type]) return TYPE_META[s.type];
  return ring === 'inner' ? DEFAULT_META : NEUTRAL_META;
}

export function typeKeyFor(s: Signal): string {
  if (s.type && TYPE_META[s.type]) return s.type;
  return 'urgent';
}
