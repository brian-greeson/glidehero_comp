import { createHmac } from 'node:crypto';

export function signMapTilerUrl(inputUrl: string, credentials: string): string {
  const separator = inputUrl.includes('?') ? '&' : '?';
  const [key, encodedSecret] = credentials.split(/_(.*)/s, 2);
  if (!key || !encodedSecret || !/^[0-9a-f]+$/i.test(encodedSecret) || encodedSecret.length % 2 !== 0) {
    throw new RangeError('MapTiler credentials are invalid.');
  }

  const keyedUrl = `${inputUrl}${separator}key=${encodeURIComponent(key)}`;
  const secret = Buffer.from(encodedSecret, 'hex');
  const signature = createHmac('sha256', secret)
    .update(keyedUrl, 'utf8')
    .digest('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_');
  return `${keyedUrl}&signature=${encodeURIComponent(signature)}`;
}
