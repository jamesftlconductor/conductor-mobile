import { Platform } from 'react-native';
import {
  isHealthDataAvailableAsync,
  queryCategorySamples,
  queryQuantitySamples,
  queryStatisticsForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';

// Kept as a const tuple so we can pass it to requestAuthorization without
// re-typing each identifier elsewhere.
const READ_TYPES = [
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierBodyMass',
] as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type HealthSnapshot = {
  sleep: { duration: number | null; efficiency: number | null };
  hrv: { current: number | null; baseline7d: number | null };
  restingHR: number | null;
  steps: number;
  activeCalories: number;
  asOf: number;
};

// Apple sleep-stage values for HKCategoryTypeIdentifierSleepAnalysis.
// 0 = inBed, 1 = asleepUnspecified (legacy), 2 = awake, 3/4/5 = asleepCore/Deep/REM (iOS 16+).
const ASLEEP_VALUES = new Set([1, 3, 4, 5]);
const IN_BED_VALUE = 0;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Diagnostic marker — non-throwing, fire-and-forget. Same pattern the push
// registration used: posts a single key into the user's preferences (server-
// side shallow-merges), so the backend reflects the last step the function
// reached even when it returns null silently. Hardcodes the userId because
// this file doesn't carry that constant; matches PUSH_USER_ID in index.tsx.
async function postHealthMarker(step: string, extra?: Record<string, unknown>) {
  try {
    await fetch('https://conductor-ivory.vercel.app/api/signals?type=preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'james_totalhome_gmail_com',
        preferences: {
          lastHealthStep: step,
          lastHealthAt: new Date().toISOString(),
          ...(extra || {}),
        },
      }),
    });
  } catch {
    // Diagnostic must never crash the caller.
  }
}

export async function fetchHealthSnapshot(): Promise<HealthSnapshot | null> {
  await postHealthMarker('fetch-start');

  if (Platform.OS !== 'ios') {
    await postHealthMarker('fetch-not-ios');
    return null;
  }

  try {
    const available = await isHealthDataAvailableAsync();
    if (!available) {
      await postHealthMarker('fetch-not-available');
      return null;
    }

    // requestAuthorization is idempotent — Apple shows the prompt only on the
    // first request per type. After that this call resolves without UI.
    await requestAuthorization({ toRead: READ_TYPES as unknown as never });

    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
    // Sleep window = yesterday 6pm to today noon. Captures most overnight
    // sessions including post-midnight bedtimes and late risers.
    const sleepWindowStart = new Date(yesterdayStart.getTime() + 18 * HOUR_MS);
    const sleepWindowEnd = new Date(todayStart.getTime() + 12 * HOUR_MS);
    const last24h = new Date(now.getTime() - DAY_MS);
    const last7d = new Date(now.getTime() - 7 * DAY_MS);

    // kingstinct v14 query option shape: date range nests inside
    // filter.date.{startDate,endDate}, limit is required (0 = all samples),
    // ascending is a boolean. The earlier {from, to} shape was a bad guess
    // that the Nitro bridge accepted past the type cast and crashed at
    // runtime ("Value is undefined, expected a number"). Statistics queries
    // use a smaller {filter, unit} shape — no limit, no ascending.
    const queryResults = await Promise.allSettled([
      queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis' as never, {
        filter: { date: { startDate: sleepWindowStart, endDate: sleepWindowEnd } },
        limit: 0,
        ascending: true,
      }),
      queryQuantitySamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN' as never, {
        filter: { date: { startDate: last24h, endDate: now } },
        limit: 1,
        ascending: false,
        unit: 'ms',
      }),
      queryQuantitySamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN' as never, {
        filter: { date: { startDate: last7d, endDate: now } },
        limit: 0,
        unit: 'ms',
      }),
      queryQuantitySamples('HKQuantityTypeIdentifierRestingHeartRate' as never, {
        filter: { date: { startDate: last24h, endDate: now } },
        limit: 1,
        ascending: false,
        unit: 'count/min',
      }),
      queryStatisticsForQuantity(
        'HKQuantityTypeIdentifierStepCount' as never,
        ['cumulativeSum'],
        {
          filter: { date: { startDate: todayStart, endDate: now } },
          unit: 'count',
        },
      ),
      queryStatisticsForQuantity(
        'HKQuantityTypeIdentifierActiveEnergyBurned' as never,
        ['cumulativeSum'],
        {
          filter: { date: { startDate: yesterdayStart, endDate: todayStart } },
          unit: 'kcal',
        },
      ),
    ]);

    const [sleepRes, hrvRes, hrv7dRes, rhrRes, stepsRes, caloriesRes] = queryResults;

    // Per-query diagnostic — zero samples across the board almost always means
    // HealthKit read permissions weren't granted (Apple deliberately doesn't
    // expose denial state for read access). Use these counts to disambiguate
    // "permission denied" from "permission granted but no data" once the
    // marker lands in Redis.
    const len = (r: PromiseSettledResult<unknown>): number =>
      r.status === 'fulfilled' && Array.isArray(r.value) ? (r.value as unknown[]).length : -1;
    await postHealthMarker('fetch-queries-done', {
      healthSampleCounts: {
        sleep: len(sleepRes),
        hrv: len(hrvRes),
        hrv7d: len(hrv7dRes),
        rhr: len(rhrRes),
        stepsOk: stepsRes.status === 'fulfilled',
        caloriesOk: caloriesRes.status === 'fulfilled',
      },
    });

    // Sleep — sum asleep stages for duration, sum inBed for efficiency denom.
    let sleepDurationMs = 0;
    let inBedMs = 0;
    if (sleepRes.status === 'fulfilled') {
      for (const s of sleepRes.value as ReadonlyArray<{
        value: number;
        startDate: string | Date;
        endDate: string | Date;
      }>) {
        const startMs = new Date(s.startDate).getTime();
        const endMs = new Date(s.endDate).getTime();
        const ms = Math.max(0, endMs - startMs);
        if (ASLEEP_VALUES.has(s.value)) sleepDurationMs += ms;
        else if (s.value === IN_BED_VALUE) inBedMs += ms;
      }
    }
    const sleepDurationHours =
      sleepDurationMs > 0 ? +(sleepDurationMs / 3600000).toFixed(2) : null;
    const sleepEfficiency =
      inBedMs > 0 && sleepDurationMs > 0
        ? +(sleepDurationMs / inBedMs).toFixed(3)
        : null;

    const firstQuantity = (
      r: PromiseSettledResult<readonly { quantity: number }[]>,
    ): number | null =>
      r.status === 'fulfilled' && r.value[0]?.quantity != null
        ? r.value[0].quantity
        : null;

    const hrvCurrentRaw = firstQuantity(
      hrvRes as PromiseSettledResult<readonly { quantity: number }[]>,
    );
    const hrvCurrent = hrvCurrentRaw != null ? +hrvCurrentRaw.toFixed(1) : null;

    let hrvBaseline7d: number | null = null;
    if (hrv7dRes.status === 'fulfilled') {
      const samples = hrv7dRes.value as ReadonlyArray<{ quantity: number }>;
      if (samples.length > 0) {
        const sum = samples.reduce((acc, s) => acc + (s.quantity || 0), 0);
        hrvBaseline7d = +(sum / samples.length).toFixed(1);
      }
    }

    const rhrRaw = firstQuantity(
      rhrRes as PromiseSettledResult<readonly { quantity: number }[]>,
    );
    const restingHR = rhrRaw != null ? Math.round(rhrRaw) : null;

    const sumQuantity = (
      r: PromiseSettledResult<{ sumQuantity?: { quantity?: number } }>,
    ): number =>
      r.status === 'fulfilled' && r.value.sumQuantity?.quantity != null
        ? Math.round(r.value.sumQuantity.quantity)
        : 0;

    const steps = sumQuantity(
      stepsRes as PromiseSettledResult<{ sumQuantity?: { quantity?: number } }>,
    );
    const activeCalories = sumQuantity(
      caloriesRes as PromiseSettledResult<{ sumQuantity?: { quantity?: number } }>,
    );

    return {
      sleep: { duration: sleepDurationHours, efficiency: sleepEfficiency },
      hrv: { current: hrvCurrent, baseline7d: hrvBaseline7d },
      restingHR,
      steps,
      activeCalories,
      asOf: Date.now(),
    };
  } catch (error) {
    // Best-effort. Permission denial, simulator without health, network — all
    // fall through here. Caller will see null and skip the upload. The marker
    // surfaces the underlying error message so we can tell which it was.
    await postHealthMarker('fetch-threw', { lastHealthError: String(error) });
    return null;
  }
}
