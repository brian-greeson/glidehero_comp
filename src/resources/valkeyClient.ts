import { GlideClient } from '@valkey/valkey-glide';

export async function createValkeyClient(connectionUrl: string): Promise<GlideClient> {
  const url = new URL(connectionUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('VALKEY_URL must use redis:// or rediss://.');
  }

  return GlideClient.createClient({
    addresses: [{ host: url.hostname, port: url.port ? Number(url.port) : 6379 }],
    useTLS: url.protocol === 'rediss:',
    databaseId: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    credentials: url.password
      ? { username: decodeURIComponent(url.username || 'default'), password: decodeURIComponent(url.password) }
      : undefined,
    requestTimeout: 5_000,
  });
}
