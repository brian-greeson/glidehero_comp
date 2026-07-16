const COUNTRY_CODES: Readonly<Record<string, string>> = {
  Austria: 'at',
  Brazil: 'br',
  Canada: 'ca',
  Colombia: 'co',
  Czechia: 'cz',
  France: 'fr',
  Germany: 'de',
  India: 'in',
  Italy: 'it',
  Liechtenstein: 'li',
  Mexico: 'mx',
  Portugal: 'pt',
  Slovenia: 'si',
  Spain: 'es',
  Switzerland: 'ch',
  'United Kingdom': 'gb',
  'United States': 'us',
};

export function arenaCountryCode(country: string): string {
  const code = COUNTRY_CODES[country];
  if (!code) throw new Error(`No ISO country code is configured for arena country: ${country}`);
  return code;
}

export function arenaSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'arena';
}

export function arenaPath(input: { sourceId: number; name: string; country: string }): string {
  return `/arena/${arenaCountryCode(input.country)}/${arenaSlug(input.name)}-${input.sourceId}`;
}

export function parseArenaSourceId(routeSlug: string): number | null {
  const match = /-(\d+)$/.exec(routeSlug);
  if (!match) return null;
  const sourceId = Number(match[1]);
  return Number.isSafeInteger(sourceId) && sourceId > 0 ? sourceId : null;
}

export function isCanonicalArenaRoute(
  input: { sourceId: number; name: string; country: string },
  countryCode: string,
  routeSlug: string,
): boolean {
  return arenaPath(input) === `/arena/${countryCode}/${routeSlug}`;
}

export function supportedArenaCountries(): readonly string[] {
  return Object.keys(COUNTRY_CODES);
}
