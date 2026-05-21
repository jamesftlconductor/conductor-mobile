// Feature catchphrases — surface copy that adapts to the user's
// voice preferences (tone × detail). Read via useCatchphrase or the
// pure getCatchphrase helper. Falls through to balanced/standard
// when the requested combination doesn't exist.
//
// Voice axes mirror Settings → Your Voice — keep these enums in
// sync with that screen and api/brief.js's communicationTone /
// communicationDetail preferences.

export type Tone = 'direct' | 'balanced' | 'warm';
export type Detail = 'brief' | 'standard' | 'thorough';

interface CatchphraseSet {
  direct: { brief: string; standard: string; thorough: string };
  balanced: { brief: string; standard: string; thorough: string };
  warm: { brief: string; standard: string; thorough: string };
}

const FEATURE_CATCHPHRASES: Record<string, CatchphraseSet> = {
  brief: {
    direct: {
      brief: "What matters. Said once.",
      standard: "What matters today, said clearly.",
      thorough: "Every morning: the signals that matter, the context that helps, nothing else.",
    },
    balanced: {
      brief: "Your morning, clear.",
      standard: "What matters today, when you need it.",
      thorough: "Every morning at 7am — three to five sentences that tell you what your household needs to know.",
    },
    warm: {
      brief: "Start the day knowing.",
      standard: "Good morning. Here's what matters.",
      thorough: "Every morning The Conductor reads everything and tells you — warmly, specifically — what your household actually needs to know today.",
    },
  },

  pulse: {
    direct: {
      brief: "Health. Weather. Signals.",
      standard: "Health. Weather. Signals. One sentence.",
      thorough: "The Conductor synthesizes your health data, the weather, and your signal load into one honest sentence about your day.",
    },
    balanced: {
      brief: "Everything considered.",
      standard: "The day, synthesized.",
      thorough: "Health, weather, and signal load — considered together before The Conductor speaks a word.",
    },
    warm: {
      brief: "How today actually feels.",
      standard: "The Conductor reads your day before you do.",
      thorough: "Your health, the weather, and what's on the radar — all considered so The Conductor can tell you what kind of day it actually is.",
    },
  },

  radar: {
    direct: {
      brief: "Everything accounted for.",
      standard: "Your household. Three rings.",
      thorough: "Every active signal in your household — sorted by urgency across three rings. Nothing hidden. Everything visible.",
    },
    balanced: {
      brief: "Your household in motion.",
      standard: "Three rings. Everything in motion.",
      thorough: "Your household's full signal picture — inner ring needs attention today, middle ring is approaching, outer ring is on the horizon.",
    },
    warm: {
      brief: "See everything at once.",
      standard: "Your whole household, visible.",
      thorough: "Everything your household has in motion — visible at a glance, organized by urgency, always there when you need the full picture.",
    },
  },

  vault: {
    direct: {
      brief: "Nothing lapses.",
      standard: "Every deadline. Watched.",
      thorough: "Every insurance policy, subscription, warranty, registration, and lease — tracked and surfaced before anything lapses.",
    },
    balanced: {
      brief: "Nothing lapses.",
      standard: "Every deadline and renewal. Watched.",
      thorough: "The Vault holds everything your household needs to track — and surfaces each item before it becomes a problem.",
    },
    warm: {
      brief: "Your household's memory.",
      standard: "The things your household needs to track. Conductor has them.",
      thorough: "Everything your household is committed to — insurance, subscriptions, warranties, leases — held safely and surfaced before anything slips.",
    },
  },

  crew: {
    direct: {
      brief: "Everyone in the picture.",
      standard: "Your household. Fully accounted for.",
      thorough: "Every person in your household — their schedules, health details, and attributed signals — organized and visible.",
    },
    balanced: {
      brief: "The people who matter.",
      standard: "The people who matter, in the picture.",
      thorough: "Partners, children, pets — each with their own bio, schedule, and attributed signals. The Conductor knows who lives here.",
    },
    warm: {
      brief: "Your people, looked after.",
      standard: "Everyone The Conductor looks after.",
      thorough: "The people you love — their schedules, their health, their activities — all held by The Conductor so you can be fully present with them.",
    },
  },

  horizon: {
    direct: {
      brief: "What's coming.",
      standard: "Beyond the brief. Ahead of schedule.",
      thorough: "Everything beyond the next two weeks — organized by proximity so nothing catches you off guard.",
    },
    balanced: {
      brief: "Further out.",
      standard: "What's coming. Before it arrives.",
      thorough: "The Horizon shows everything The Conductor is watching beyond the immediate — so you can plan ahead, not react.",
    },
    warm: {
      brief: "What's ahead.",
      standard: "The future your household is moving toward.",
      thorough: "Everything coming up — organized into what's soon, what's further out, and what's on the edge — so nothing surprises you.",
    },
  },

  maintenance: {
    direct: {
      brief: "Scheduled. Not forgotten.",
      standard: "Your home, ahead of the season.",
      thorough: "A market-aware annual maintenance schedule for your home — timed to the season, priced to your market, surfaced before it's urgent.",
    },
    balanced: {
      brief: "Your home, ahead.",
      standard: "Your home, ahead of the season.",
      thorough: "The Conductor generates an annual maintenance plan based on your home's systems and your market's seasonal patterns.",
    },
    warm: {
      brief: "Your home, cared for.",
      standard: "The Conductor keeps your home ahead of its needs.",
      thorough: "An annual plan for everything your home needs — scheduled before the season demands it, priced for your market, ready when you are.",
    },
  },

  ask: {
    direct: {
      brief: "Ask. Get an answer.",
      standard: "Ask anything. Get a real answer.",
      thorough: "Ask The Conductor anything about your household — signals, costs, features, or commands. It answers from your actual data.",
    },
    balanced: {
      brief: "Ask The Conductor anything.",
      standard: "Ask anything. The Conductor knows your household.",
      thorough: "The Conductor answers questions, navigates the app, changes settings, and acts on your behalf — all from your actual household data.",
    },
    warm: {
      brief: "The Conductor is listening.",
      standard: "Ask anything. The Conductor is here.",
      thorough: "Whatever you need to know — about your household, about The Conductor, about anything — just ask. The Conductor knows your household and is always ready.",
    },
  },

  weekreview: {
    direct: {
      brief: "The week. Honest.",
      standard: "How the week went. Honestly.",
      thorough: "Every Sunday: signals handled, deadlines caught, streak status. Honest and specific.",
    },
    balanced: {
      brief: "How the week went.",
      standard: "A weekly read on the household.",
      thorough: "Every Sunday evening The Conductor reflects on how the household ran — what was handled, what carried forward, what it noticed.",
    },
    warm: {
      brief: "Your week, reflected.",
      standard: "The week, seen warmly.",
      thorough: "Every Sunday The Conductor tells you honestly and warmly how your household did this week — celebrating what worked, noting what didn't, always on your side.",
    },
  },

  overwatch: {
    direct: {
      brief: "Never stops.",
      standard: "The Conductor doesn't sleep.",
      thorough: "From 11pm to 7am The Conductor watches everything — so your brief is ready the moment you wake up.",
    },
    balanced: {
      brief: "Always watching.",
      standard: "Watching through the night.",
      thorough: "While the household rests, The Conductor prepares — reading signals, checking weather, building tomorrow's brief.",
    },
    warm: {
      brief: "Here while you sleep.",
      standard: "The Conductor is here while you rest.",
      thorough: "You sleep. The Conductor watches. By morning it knows everything your household needs to know — so you can wake up and just live.",
    },
  },

  emotional_intelligence: {
    direct: {
      brief: "The brief reads the room.",
      standard: "The brief adjusts to what's actually happening.",
      thorough: "The Conductor classifies each signal's emotional weight and adjusts the brief accordingly — grief, stress, joy, or neutral.",
    },
    balanced: {
      brief: "The Conductor reads the room.",
      standard: "The Conductor knows the difference between a hard week and a hard life.",
      thorough: "When your household is celebrating, the brief celebrates. When it's grieving, the brief goes quiet. The Conductor reads the room.",
    },
    warm: {
      brief: "The Conductor understands.",
      standard: "The Conductor understands what your household is going through.",
      thorough: "The Conductor knows when to lean in and when to step back — celebrating milestones, going quiet for grief, offering lightness on hard weeks.",
    },
  },

  red_alert: {
    direct: {
      brief: "Urgent. Immediate.",
      standard: "When it matters most. Immediately.",
      thorough: "Weather emergencies, fraud detection, safety alerts — surfaced immediately, above everything else, no matter what.",
    },
    balanced: {
      brief: "When it really matters.",
      standard: "The Conductor escalates when it has to.",
      thorough: "Some things can't wait for the morning brief. Red Alert surfaces them immediately — weather emergencies, fraud, safety concerns.",
    },
    warm: {
      brief: "The Conductor has your back.",
      standard: "When something genuinely urgent happens, The Conductor is there.",
      thorough: "The Conductor watches for the things that can't wait — and when something truly urgent happens, it tells you immediately and clearly.",
    },
  },
};

// Pure synchronous getter for callers that already have the prefs
// in hand (e.g., the live preview block in Voice settings). The
// hook is the right surface for everywhere else.
export function getCatchphrase(
  featureId: string,
  tone: Tone = 'balanced',
  detail: Detail = 'standard',
): string {
  const feature = FEATURE_CATCHPHRASES[featureId];
  if (!feature) return '';
  return feature[tone]?.[detail] || feature.balanced.standard;
}

export function listCatchphraseFeatureIds(): string[] {
  return Object.keys(FEATURE_CATCHPHRASES);
}
