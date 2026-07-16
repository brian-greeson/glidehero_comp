export type LocationLookup = {
  country: string;
  state: string;
  city: string;
  altitudeMeters: number;
  timezone: string;
};

export interface LocationLookupService {
  lookup(input: { latitude: number; longitude: number }): Promise<LocationLookup>;
}

type NominatimResponse = {
  address?: Record<string, string | undefined>;
};

type OpenMeteoResponse = {
  elevation?: number;
  timezone?: string;
};

function nearestCity(address: Record<string, string | undefined>): string {
  return address.city
    ?? address.town
    ?? address.village
    ?? address.municipality
    ?? address.county
    ?? address.state_district
    ?? '';
}

export function createLocationLookupService(
  fetchImpl: typeof fetch = fetch,
  options: { now?: () => number; delay?: (milliseconds: number) => Promise<void> } = {},
): LocationLookupService {
  const now = options.now ?? Date.now;
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let nextNominatimRequestAt = 0;
  let gate = Promise.resolve();

  async function reverseGeocode(latitude: number, longitude: number): Promise<NominatimResponse> {
    let release!: () => void;
    const previous = gate;
    gate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = nextNominatimRequestAt - now();
      if (wait > 0) await delay(wait);
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.search = new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
        format: 'jsonv2',
        addressdetails: '1',
        zoom: '10',
      }).toString();
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'accept-language': 'en',
          'user-agent': 'GlideHero-Admin-Area-Editor/0.1',
        },
      });
      if (!response.ok) throw new Error(`Nominatim lookup failed with ${response.status}.`);
      return await response.json() as NominatimResponse;
    } finally {
      nextNominatimRequestAt = now() + 1000;
      release();
    }
  }

  return {
    async lookup({ latitude, longitude }) {
      const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
      weatherUrl.search = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        timezone: 'auto',
        forecast_days: '0',
      }).toString();
      const [place, weatherResponse] = await Promise.all([
        reverseGeocode(latitude, longitude),
        fetchImpl(weatherUrl, { headers: { accept: 'application/json' } }),
      ]);
      if (!weatherResponse.ok) throw new Error(`Open-Meteo lookup failed with ${weatherResponse.status}.`);
      const weather = await weatherResponse.json() as OpenMeteoResponse;
      const address = place.address ?? {};
      if (!address.country || !weather.timezone || !Number.isFinite(weather.elevation)) {
        throw new Error('Location lookup returned incomplete data.');
      }
      return {
        country: address.country,
        state: address.state ?? address.province ?? address.region ?? address.county ?? '',
        city: nearestCity(address),
        altitudeMeters: Math.round(weather.elevation!),
        timezone: weather.timezone,
      };
    },
  };
}
