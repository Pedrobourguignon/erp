type Env = Record<string, string | undefined>;

export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
}

/**
 * One place for how every Redis client (queues, cache) connects. A managed
 * Redis (Coolify, cloud) always has a password; before this, none of the three
 * clients sent one, so such a Redis refused every connection.
 */
export function redisConnection(env: Env = process.env): RedisConnectionOptions {
  const port = Number.parseInt(env.REDIS_PORT ?? '', 10);
  const connection: RedisConnectionOptions = {
    host: env.REDIS_HOST || 'localhost',
    port: Number.isNaN(port) ? 6379 : port,
  };
  if (env.REDIS_PASSWORD) {
    connection.password = env.REDIS_PASSWORD;
  }
  return connection;
}

const DEFAULT_ORIGIN = 'http://localhost:3000';

/**
 * Allowed browser origins. `.env.example` documents `CORS_ORIGINS` (plural) but
 * the code only read `CORS_ORIGIN`, so following the example changed nothing and
 * the real site stayed blocked. Both names work now, and a comma-separated list
 * is accepted.
 */
export function corsOrigins(env: Env = process.env): string[] {
  const raw = env.CORS_ORIGINS?.trim() || env.CORS_ORIGIN?.trim() || '';
  const list = raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin !== '');
  return list.length > 0 ? list : [DEFAULT_ORIGIN];
}
