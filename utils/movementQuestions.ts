// Per-movement interview questions — surfaced one-at-a-time at the bottom of
// each Movement screen so The Conductor steadily learns the household. Answers
// persist to AsyncStorage (`movement:{key}:questionsAnswered`) and POST to
// preferences as `movementAnswers['{key}:{qid}']`.

import { MovementKey } from '@/utils/movements';

export type QuestionType = 'single' | 'multi' | 'single+text';

export type MovementQuestion = {
  id: string;
  prompt: string;
  /** One-line "why this helps this movement". */
  why: string;
  type: QuestionType;
  options: string[];
  /** For 'single+text': the option that reveals a follow-up text input. */
  followUpOn?: string;
  followUpPlaceholder?: string;
};

/** Persisted answer: a single option, a multi-select list, or an option plus
 *  an optional free-text follow-up. */
export type QuestionAnswer = string | string[] | { option: string; text?: string };

export const MOVEMENT_QUESTIONS: Record<MovementKey, MovementQuestion[]> = {
  home: [
    { id: 'q1', prompt: 'Do you rent or own?', why: 'Shapes which upkeep and document signals matter to you.', type: 'single', options: ['Own', 'Rent'] },
    { id: 'q2', prompt: 'What type of home?', why: 'Tunes the systems and maintenance worth watching.', type: 'single', options: ['House', 'Condo', 'Apartment', 'Other'] },
    { id: 'q3', prompt: 'Major systems to watch?', why: 'So service reminders target what you actually have.', type: 'multi', options: ['HVAC', 'Roof', 'Plumbing', 'Electrical', 'Pool'] },
    { id: 'q4', prompt: 'Roughly when was it built?', why: 'Older homes need earlier warnings on aging systems.', type: 'single', options: ['Before 1980', '1980-2000', '2000-2015', 'After 2015'] },
  ],
  work: [
    { id: 'q1', prompt: 'Typical working hours?', why: 'So conflicts are flagged against your real day.', type: 'single', options: ['9-5', 'Early', 'Late', 'Flexible', 'Shifts'] },
    { id: 'q2', prompt: 'Where do you work?', why: 'Helps separate home vs office logistics.', type: 'single', options: ['Home', 'Office', 'Hybrid', 'Varies'] },
    { id: 'q3', prompt: "How's your work week typically?", why: 'Calibrates how protective The Conductor is of your time.', type: 'single', options: ['Structured', 'Flexible', 'Intense', 'Varies'] },
  ],
  family: [
    { id: 'q1', prompt: 'Partner in the household?', why: 'So shared logistics route to the right person.', type: 'single+text', options: ['Yes', 'No'], followUpOn: 'Yes', followUpPlaceholder: "Partner's name" },
    { id: 'q2', prompt: 'Any children?', why: 'Drives school, activity, and care signals.', type: 'single+text', options: ['Yes', 'No'], followUpOn: 'Yes', followUpPlaceholder: 'How many, names / ages' },
    { id: 'q3', prompt: 'Any pets?', why: 'Vet and care reminders join the Family movement.', type: 'single+text', options: ['Yes', 'No'], followUpOn: 'Yes', followUpPlaceholder: 'Type + name' },
    { id: 'q4', prompt: 'Any custody arrangements?', why: 'Helps schedule around shared-time weeks.', type: 'single', options: ['Yes', 'No', 'N/A'] },
  ],
  wellness: [
    { id: 'q1', prompt: 'Apple Health connected?', why: 'Unlocks vitals, sleep, and readiness in this movement.', type: 'single', options: ['Yes', 'Let me connect', 'No'] },
    { id: 'q2', prompt: 'Daily medications?', why: 'Enables refill and dose reminders.', type: 'single+text', options: ['Yes', 'No'], followUpOn: 'Yes', followUpPlaceholder: 'Who + what' },
    { id: 'q3', prompt: 'Last physical exam?', why: 'So The Conductor can nudge overdue checkups.', type: 'single', options: ['This year', 'Last year', '2+ years', 'Not sure'] },
    { id: 'q4', prompt: 'Any health context to share?', why: 'Stays private — only shapes how gently it watches.', type: 'single+text', options: ['Skip', "I'll share (private)"], followUpOn: "I'll share (private)", followUpPlaceholder: 'Anything worth knowing (private)' },
  ],
};
