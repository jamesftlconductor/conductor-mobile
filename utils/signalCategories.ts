// Brief Customize categories — 8 user-facing categories, each grouping several
// raw backend signal `type` values. Used by Settings (the Customize UI), Ground
// (brief filtering) and Hover (radar dot filter + priority size). The AsyncStorage
// keys `conductorSignalPriority` (ordered array of category keys) and
// `conductorSignalVisibility` ({ categoryKey: boolean }) store these 8 keys.

export const SIGNAL_CATEGORIES: { key: string; label: string; types: string[] }[] = [
  { key: 'delivery', label: 'Delivery', types: ['package', 'delivery'] },
  { key: 'food', label: 'Food', types: ['food', 'grocery'] },
  { key: 'service', label: 'Service', types: ['service', 'appointment', 'reminder'] },
  { key: 'financial', label: 'Financial', types: ['financial'] },
  { key: 'travel', label: 'Travel', types: ['travel', 'reservation'] },
  { key: 'deadline', label: 'Deadline', types: ['deadline', 'anticipated'] },
  { key: 'home', label: 'Home', types: ['supplies', 'junior', 'school', 'schedule'] },
  { key: 'other', label: 'Other', types: ['local_safety', 'milestone', 'unknown'] },
];

export const SIGNAL_CATEGORY_KEYS = SIGNAL_CATEGORIES.map((c) => c.key);

const TYPE_TO_CATEGORY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of SIGNAL_CATEGORIES) for (const t of c.types) m[t] = c.key;
  return m;
})();

// Map a raw backend signal type to its Customize category key. Unknown/unmapped
// types fall into 'other' so they always belong to exactly one category.
export function categoryForType(type?: string | null): string {
  const t = (type || '').toLowerCase().trim();
  return TYPE_TO_CATEGORY[t] || 'other';
}

export function labelForCategory(key: string): string {
  return SIGNAL_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
