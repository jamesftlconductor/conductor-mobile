// Shape of the backend movement content API:
//   GET /api/movement?movement={home|work|family|wellness}&householdId=&userId=
// One endpoint, different fields populated per movement. All optional — screens
// render defensively (the endpoint may not be live yet → empty states/prompts).

import { MovementSignal } from '@/components/MovementScreen';

export const MOVEMENT_API = 'https://conductor-ivory.vercel.app/api/movement';

export type VaultRenewal = { name: string; date?: string };
export type InventoryItem = { name: string; note?: string };
export type WorkBlock = { title: string; start?: string; end?: string };
export type Conflict = { text: string };
export type CrewSummary = {
  name: string;
  photoUrl?: string | null;
  signalCount?: number;
  signals?: MovementSignal[];
};
export type UpcomingDate = { name: string; label?: string; date?: string };
export type HealthSnapshot = { hrv?: number; sleepHours?: number; readiness?: number } | null;
export type MedicalAppointment = { title?: string; date?: string } & Partial<MovementSignal>;
export type MedicationReminder = { name: string; schedule?: string };

export type MovementApiResponse = {
  // home
  activeSignals?: MovementSignal[];
  vaultRenewals?: VaultRenewal[];
  inventory?: InventoryItem[];
  // work
  workBlocksToday?: WorkBlock[];
  conflicts?: Conflict[];
  financialSignals?: MovementSignal[];
  workCalendarConnected?: boolean;
  // family
  crewSummaries?: CrewSummary[];
  upcomingDates?: UpcomingDate[];
  // wellness
  healthSnapshot?: HealthSnapshot;
  medicalAppointments?: MedicalAppointment[];
  medicationReminders?: MedicationReminder[];
};

/** Fetch a movement's content. Returns {} on any failure (best-effort). */
export async function fetchMovement(
  movement: string,
  householdId: string | null,
  userId: string | null,
): Promise<MovementApiResponse> {
  try {
    const params = new URLSearchParams({ movement });
    if (householdId) params.set('householdId', householdId);
    if (userId) params.set('userId', userId);
    const res = await fetch(`${MOVEMENT_API}?${params.toString()}`);
    if (!res.ok) return {};
    const data = await res.json();
    return data && typeof data === 'object' ? (data as MovementApiResponse) : {};
  } catch {
    return {};
  }
}
