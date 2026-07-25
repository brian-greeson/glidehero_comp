export type GliderCatalogEntry = {
  id: string;
  manufacturer: string;
  model: string;
  size: string;
  enRating: string;
};

function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? right.length;
}

function score(query: string, value: string): number {
  const q = normalize(query); const v = normalize(value);
  if (!q) return 0;
  if (v === q) return 1_000;
  if (v.includes(q)) return 700 - (v.length - q.length);
  let qi = 0;
  for (const char of v) if (char === q[qi]) qi += 1;
  if (qi === q.length) return 300 - (v.length - q.length);
  let best = 0;
  for (let start = 0; start < q.length; start += 1) {
    const part = q.slice(start);
    if (part && v.includes(part)) best = Math.max(best, part.length);
  }
  if (best >= Math.min(4, q.length)) return 100 + best;
  const distance = editDistance(q, v);
  const allowedDistance = Math.max(1, Math.floor(Math.max(q.length, v.length) * 0.3));
  return distance <= allowedDistance ? 500 - (distance * 20) - Math.abs(v.length - q.length) : 0;
}

function tokenScore(query: string, value: string): number {
  const queryTokens = tokens(query);
  const valueTokens = tokens(value);
  if (!queryTokens.length || !valueTokens.length) return 0;
  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const valueToken of valueTokens) {
      if (queryToken === valueToken) {
        best = Math.max(best, 300);
        continue;
      }
      if (valueToken.startsWith(queryToken) || queryToken.startsWith(valueToken)) {
        const shorterLength = Math.min(queryToken.length, valueToken.length);
        if (shorterLength >= 3) best = Math.max(best, 260 - Math.abs(queryToken.length - valueToken.length));
        continue;
      }
      const distance = editDistance(queryToken, valueToken);
      const allowedDistance = Math.max(1, Math.floor(Math.max(queryToken.length, valueToken.length) * 0.25));
      if (distance <= allowedDistance) best = Math.max(best, 220 - (distance * 20));
    }
    // Requiring every query token to match keeps a fuzzy make token from
    // returning every model made by that manufacturer.
    if (!best) return 0;
    total += best;
  }
  return 400 + Math.round(total / queryTokens.length);
}

export type GliderModelSearchResult = {
  manufacturer: string;
  model: string;
  sizes: Array<{ id: string; value: string; enRating: string }>;
};

export function searchGliderModels(entries: readonly GliderCatalogEntry[], query: string, limit = 8): GliderModelSearchResult[] {
  const grouped = new Map<string, GliderModelSearchResult & { score: number }>();
  for (const entry of entries) {
    const key = `${entry.manufacturer}\u0000${entry.model}`;
    const valueScore = Math.max(
      score(query, entry.manufacturer),
      score(query, entry.model),
      score(query, `${entry.manufacturer} ${entry.model}`),
      tokenScore(query, `${entry.manufacturer} ${entry.model}`),
    );
    if (!valueScore) continue;
    const current = grouped.get(key) ?? { manufacturer: entry.manufacturer, model: entry.model, sizes: [], score: valueScore };
    current.score = Math.max(current.score, valueScore);
    if (!current.sizes.some((size) => size.value === entry.size)) {
      current.sizes.push({ id: entry.id, value: entry.size, enRating: entry.enRating });
    }
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.score - a.score || a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model)).slice(0, limit)
    .map(({ manufacturer, model, sizes }) => ({ manufacturer, model, sizes }));
}
