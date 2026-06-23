// Maps a backend weather `conditions` string to one of the bundled
// weather Lottie animations (assets/weather/*.json). The backend value is
// free-form-ish, so we normalize generously and fall back to null (the
// Ground screen then shows its plain dark background).
//
// The 9 condition slugs are the contract between this mapper and the asset
// filenames — see scripts/gen-weather-lottie.mjs.

export type WeatherCondition =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy'
  | 'cloudy'
  | 'rain'
  | 'heavy-rain'
  | 'storm'
  | 'fog'
  | 'sunrise';

// Static require map — Metro needs literal require paths to bundle assets.
const SOURCES: Record<WeatherCondition, any> = {
  'clear-day': require('../assets/weather/clear-day.json'),
  'clear-night': require('../assets/weather/clear-night.json'),
  'partly-cloudy': require('../assets/weather/partly-cloudy.json'),
  cloudy: require('../assets/weather/cloudy.json'),
  rain: require('../assets/weather/rain.json'),
  'heavy-rain': require('../assets/weather/heavy-rain.json'),
  storm: require('../assets/weather/storm.json'),
  fog: require('../assets/weather/fog.json'),
  sunrise: require('../assets/weather/sunrise.json'),
};

const KNOWN = Object.keys(SOURCES) as WeatherCondition[];

export function resolveWeatherCondition(
  conditions: string | null | undefined,
  opts: { isNight?: boolean } = {},
): WeatherCondition | null {
  if (!conditions) return null;
  const raw = conditions.toLowerCase().trim();
  const isNight = !!opts.isNight;

  // Already a known slug (allow spaces/underscores in place of dashes).
  const slug = raw.replace(/[\s_]+/g, '-');
  if ((KNOWN as string[]).includes(slug)) return slug as WeatherCondition;

  if (raw.includes('thunder') || raw.includes('storm') || raw.includes('lightning')) {
    return 'storm';
  }
  if (raw.includes('sunrise') || raw.includes('dawn')) return 'sunrise';
  if (raw.includes('rain') || raw.includes('shower') || raw.includes('drizzle')) {
    return raw.includes('heavy') || raw.includes('downpour') || raw.includes('torrential')
      ? 'heavy-rain'
      : 'rain';
  }
  if (raw.includes('fog') || raw.includes('mist') || raw.includes('haze') || raw.includes('smoke')) {
    return 'fog';
  }
  // Snow/sleet have no dedicated art yet — read as overcast.
  if (raw.includes('snow') || raw.includes('sleet') || raw.includes('flurr')) return 'cloudy';
  if (raw.includes('cloud') || raw.includes('overcast')) {
    return raw.includes('part') || raw.includes('few') || raw.includes('scattered') || raw.includes('mostly sun')
      ? 'partly-cloudy'
      : 'cloudy';
  }
  if (raw.includes('clear') || raw.includes('sun') || raw.includes('fair')) {
    return isNight ? 'clear-night' : 'clear-day';
  }
  return null;
}

export function weatherLottieSource(
  conditions: string | null | undefined,
  opts: { isNight?: boolean } = {},
): any | null {
  const c = resolveWeatherCondition(conditions, opts);
  return c ? SOURCES[c] : null;
}
