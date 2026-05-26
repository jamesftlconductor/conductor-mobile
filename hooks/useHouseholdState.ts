// Household weather-vane state — drives the minimap's border color
// and pulse cadence so the user can read the household's emotional
// temperature at a glance. Polls /api/signals?type=urgentCount (which
// now carries emotionalState/Intensity) + /api/alert/active every
// 5 minutes. Best-effort: any fetch failure leaves the state as
// 'clear' until the next tick, which is the right baseline.
//
// State priority (highest → lowest):
//   red_alert > grief > urgent (count>3 OR stress) > joy > stress > busy > clear

import { useEffect, useState } from 'react';

import { useUserId } from './useUserId';

const API_BASE = 'https://conductor-ivory.vercel.app/api';
const POLL_MS = 5 * 60 * 1000;

export type WeatherState =
  | 'red_alert'
  | 'grief'
  | 'urgent'
  | 'joy'
  | 'stress'
  | 'busy'
  | 'clear';

export type HouseholdWeatherState = {
  weatherState: WeatherState;
  borderColor: string;
  // null when no pulse should run (busy/clear). Milliseconds per
  // half-cycle of the opacity oscillation.
  pulseSpeed: number | null;
  urgentCount: number;
};

const STATE_CONFIG: Record<WeatherState, { color: string; pulse: number | null }> = {
  red_alert: { color: '#ef4444', pulse: 400  },
  grief:     { color: '#7c3aed', pulse: 3000 },
  urgent:    { color: '#f59e0b', pulse: 1500 },
  joy:       { color: '#d4af37', pulse: 2000 },
  stress:    { color: '#ea580c', pulse: 2000 },
  busy:      { color: '#b8960c', pulse: null },
  clear:     { color: '#b8960c', pulse: null },
};

export function useHouseholdState(): HouseholdWeatherState {
  const userId = useUserId();
  const [state, setState] = useState<HouseholdWeatherState>({
    weatherState: 'clear',
    borderColor: STATE_CONFIG.clear.color,
    pulseSpeed: null,
    urgentCount: 0,
  });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    async function fetchState() {
      try {
        const [urgentRes, alertRes] = await Promise.all([
          fetch(`${API_BASE}/signals?type=urgentCount&userId=${userId}`),
          fetch(`${API_BASE}/alert?action=active&userId=${userId}`),
        ]);

        const urgentData: { count?: number; emotionalState?: string; emotionalIntensity?: string } =
          urgentRes.ok ? await urgentRes.json() : {};
        const alertData: { active?: boolean } | null =
          alertRes.ok ? await alertRes.json() : null;

        if (cancelled) return;

        let weatherState: WeatherState = 'clear';
        const count = typeof urgentData.count === 'number' ? urgentData.count : 0;

        if (alertData?.active) {
          weatherState = 'red_alert';
        } else if (urgentData.emotionalState === 'grief') {
          weatherState = 'grief';
        } else if (urgentData.emotionalState === 'joyful' && urgentData.emotionalIntensity === 'high') {
          weatherState = 'joy';
        } else if (urgentData.emotionalState === 'stressful' && urgentData.emotionalIntensity === 'high') {
          weatherState = 'stress';
        } else if (count > 3) {
          weatherState = 'urgent';
        } else if (count > 0) {
          weatherState = 'busy';
        } else {
          weatherState = 'clear';
        }

        const cfg = STATE_CONFIG[weatherState];
        setState({
          weatherState,
          borderColor: cfg.color,
          pulseSpeed: cfg.pulse,
          urgentCount: count,
        });
      } catch {
        // silent — keep last known state
      }
    }

    fetchState();
    const interval = setInterval(fetchState, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userId]);

  return state;
}
