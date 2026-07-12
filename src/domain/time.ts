export const nowIso = () => new Date().toISOString();

export const addSeconds = (iso: string, seconds: number) =>
  new Date(new Date(iso).getTime() + seconds * 1000).toISOString();

export const diffSeconds = (endIso: string, startIso: string) =>
  Math.max(0, Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));

export const isAtOrPast = (now: string, then: string | null) => Boolean(then && new Date(now) >= new Date(then));
