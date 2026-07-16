export function formatClaimedArea(squareMeters, locale) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(squareMeters / 1_000_000)} km²`;
}

export function formatCount(count, locale) {
  return new Intl.NumberFormat(locale).format(count);
}
