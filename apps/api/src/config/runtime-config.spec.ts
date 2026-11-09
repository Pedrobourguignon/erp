import { corsOrigins, redisConnection } from './runtime-config';

describe('redisConnection', () => {
  it('should default to localhost:6379 without a password', () => {
    expect(redisConnection({})).toEqual({ host: 'localhost', port: 6379 });
  });

  it('should read host and port from the environment', () => {
    expect(redisConnection({ REDIS_HOST: 'redis', REDIS_PORT: '6380' })).toEqual({
      host: 'redis',
      port: 6380,
    });
  });

  it('should pass the password when there is one (managed Redis always has one)', () => {
    expect(redisConnection({ REDIS_HOST: 'r', REDIS_PASSWORD: 's3cret' })).toEqual({
      host: 'r',
      port: 6379,
      password: 's3cret',
    });
  });

  it('should treat an empty password as none', () => {
    expect(redisConnection({ REDIS_PASSWORD: '' })).not.toHaveProperty('password');
  });

  it('should fall back to the default port when REDIS_PORT is not a number', () => {
    expect(redisConnection({ REDIS_PORT: 'abc' }).port).toBe(6379);
  });
});

describe('corsOrigins', () => {
  it('should default to the local web app', () => {
    expect(corsOrigins({})).toEqual(['http://localhost:3000']);
  });

  it('should read the plural CORS_ORIGINS documented in .env.example', () => {
    expect(corsOrigins({ CORS_ORIGINS: 'https://app.cliente.com' })).toEqual([
      'https://app.cliente.com',
    ]);
  });

  it('should still honour the singular CORS_ORIGIN', () => {
    expect(corsOrigins({ CORS_ORIGIN: 'https://a.com' })).toEqual(['https://a.com']);
  });

  it('should prefer the plural when both are set', () => {
    expect(corsOrigins({ CORS_ORIGINS: 'https://new.com', CORS_ORIGIN: 'https://old.com' })).toEqual([
      'https://new.com',
    ]);
  });

  it('should split a comma-separated list and trim spaces and trailing slashes', () => {
    expect(
      corsOrigins({ CORS_ORIGINS: ' https://a.com/ , https://b.com ,, http://localhost:3000 ' }),
    ).toEqual(['https://a.com', 'https://b.com', 'http://localhost:3000']);
  });

  it('should fall back to the default when the value is blank', () => {
    expect(corsOrigins({ CORS_ORIGINS: '  ' })).toEqual(['http://localhost:3000']);
  });
});
