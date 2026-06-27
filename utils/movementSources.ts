// Per-movement "Sources" — what currently feeds each Movement and what could
// feed it better. Rendered as a collapsible section at the bottom of every
// Movement screen. Dynamic items (Google Calendar / Work Calendar for Work,
// Apple HealthKit for Wellness) are injected at runtime by MovementSources
// based on the real connection state; the lists below are the static base.

export type SourceIconKey =
  | 'gmail'
  | 'inventory'
  | 'attom'
  | 'shortcuts'
  | 'email'
  | 'calendar'
  | 'contacts'
  | 'crew'
  | 'classdojo'
  | 'classroom'
  | 'remind'
  | 'healthkit'
  | 'oura'
  | 'whoop'
  | 'garmin';

export type SourceItem = {
  name: string;
  icon: SourceIconKey;
  /** One line of specific value — shown for available (not-connected) sources. */
  value?: string;
};

export type SourcesConfig = {
  connected: SourceItem[];
  available: SourceItem[];
};

export const MOVEMENT_SOURCES: Record<string, SourcesConfig> = {
  home: {
    connected: [
      { name: 'Gmail', icon: 'gmail' },
      { name: 'Home Inventory (manual)', icon: 'inventory' },
    ],
    available: [
      { name: 'ATTOM Property Data', icon: 'attom', value: 'Connect for property intelligence' },
      { name: 'iOS Shortcuts', icon: 'shortcuts', value: 'Automate home signals' },
    ],
  },
  work: {
    // Google Calendar is injected into connected when the work calendar is set.
    connected: [],
    available: [
      { name: 'Work Email', icon: 'email', value: 'Add work email for deadline detection' },
      // Work Calendar is injected into available only when NOT connected.
    ],
  },
  family: {
    connected: [
      { name: 'Google Contacts', icon: 'contacts' },
      { name: 'Crew profiles', icon: 'crew' },
    ],
    available: [
      { name: 'ClassDojo', icon: 'classdojo', value: 'School events and teacher notes' },
      { name: 'Google Classroom', icon: 'classroom', value: 'Assignments and school calendar' },
      { name: 'Remind', icon: 'remind', value: 'School messaging' },
    ],
  },
  wellness: {
    // Apple HealthKit is injected into connected when health data is available.
    connected: [],
    available: [
      { name: 'Oura', icon: 'oura', value: 'Recovery scores and sleep stages' },
      { name: 'Whoop', icon: 'whoop', value: 'Strain and recovery' },
      { name: 'Garmin', icon: 'garmin', value: 'Activity and health data' },
    ],
  },
};
