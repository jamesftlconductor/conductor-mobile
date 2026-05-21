// useCatchphrase — reads communicationTone + communicationDetail
// from AsyncStorage and returns the matching feature catchphrase.
// Pure presentational hook; falls back to balanced/standard on any
// read failure so the surface never renders blank.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { getCatchphrase, type Detail, type Tone } from '@/utils/catchphrases';

const TONE_VALUES: readonly Tone[] = ['direct', 'balanced', 'warm'];
const DETAIL_VALUES: readonly Detail[] = ['brief', 'standard', 'thorough'];

function asTone(v: string | null): Tone {
  return v && (TONE_VALUES as readonly string[]).includes(v) ? (v as Tone) : 'balanced';
}
function asDetail(v: string | null): Detail {
  return v && (DETAIL_VALUES as readonly string[]).includes(v) ? (v as Detail) : 'standard';
}

export function useCatchphrase(featureId: string): string {
  const [phrase, setPhrase] = useState<string>(() =>
    getCatchphrase(featureId, 'balanced', 'standard'),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, d] = await Promise.all([
          AsyncStorage.getItem('communicationTone'),
          AsyncStorage.getItem('communicationDetail'),
        ]);
        if (cancelled) return;
        setPhrase(getCatchphrase(featureId, asTone(t), asDetail(d)));
      } catch {
        // keep the default — never render blank.
      }
    })();
    return () => { cancelled = true; };
  }, [featureId]);

  return phrase;
}
