export function normalizeArenaCountryCode(countryCode: string): string {
  const normalized = countryCode.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(normalized)) {
    throw new Error(`Invalid ISO country code for Arena route: ${countryCode}`);
  }
  return normalized;
}

export function arenaSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'arena';
}

export function arenaPath(input: { sourceId: number; name: string; countryCode: string }): string {
  return `/arena/${normalizeArenaCountryCode(input.countryCode)}/${arenaSlug(input.name)}-${input.sourceId}`;
}

export function parseArenaSourceId(routeSlug: string): number | null {
  const match = /-(\d+)$/.exec(routeSlug);
  if (!match) return null;
  const sourceId = Number(match[1]);
  return Number.isSafeInteger(sourceId) && sourceId > 0 ? sourceId : null;
}

export function isCanonicalArenaRoute(
  input: { sourceId: number; name: string; countryCode: string },
  countryCode: string,
  routeSlug: string,
): boolean {
  let normalizedCode: string;
  try {
    normalizedCode = normalizeArenaCountryCode(countryCode);
  } catch {
    return false;
  }
  if (countryCode !== normalizedCode) return false;
  return arenaPath(input) === `/arena/${normalizedCode}/${routeSlug}`;
}
