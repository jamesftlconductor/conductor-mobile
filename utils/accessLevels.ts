// Conductor access level — how much The Conductor is allowed to see. Chosen in
// onboarding, changeable in Settings → The Score → Conductor Access. Persisted
// as the `conductorAccessLevel` preference (POST /api/signals?type=preferences).

export type AccessLevel = 'essentials' | 'informed' | 'full';

export type AccessLevelInfo = {
  key: AccessLevel;
  /** lucide icon name conveying "how open the eye is". */
  title: string;
  description: string;
};

export const ACCESS_LEVELS: AccessLevelInfo[] = [
  {
    key: 'essentials',
    title: 'Essentials',
    description:
      'Time blocks and signals. Private by default. The Conductor catches conflicts without seeing meeting details.',
  },
  {
    key: 'informed',
    title: 'Informed',
    description:
      'Meeting titles included. The Conductor understands your day better and catches more conflicts.',
  },
  {
    key: 'full',
    title: 'Full Picture',
    description:
      'Everything visible. The Conductor works hardest for you — references meetings, emails, and patterns together.',
  },
];

export const DEFAULT_ACCESS_LEVEL: AccessLevel = 'essentials';

export function accessLevelInfo(key?: string | null): AccessLevelInfo {
  return ACCESS_LEVELS.find((l) => l.key === key) ?? ACCESS_LEVELS[0];
}
