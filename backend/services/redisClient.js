const { createClient } = require('redis');

const REDIS_CLIENT_KEY = '__academicAtelierRedisClient';
const REDIS_CONNECT_PROMISE_KEY = '__academicAtelierRedisConnectPromise';
const REDIS_DISABLED_KEY = '__academicAtelierRedisDisabled';

const getConfiguredRedisUrl = () => String(process.env.REDIS_URL || '').trim();

const getGlobalScope = () => global;

const hasRedisConfigured = () => Boolean(getConfiguredRedisUrl());

const markRedisDisabled = () => {
  const scope = getGlobalScope();
  scope[REDIS_DISABLED_KEY] = true;
};

const isRedisDisabled = () => {
  const scope = getGlobalScope();
  return Boolean(scope[REDIS_DISABLED_KEY]);
};

const getRedisClient = async () => {
  const scope = getGlobalScope();
  const redisUrl = getConfiguredRedisUrl();

  if (!redisUrl || isRedisDisabled()) {
    return null;
  }

  const existingClient = scope[REDIS_CLIENT_KEY];
  if (existingClient?.isOpen) {
    return existingClient;
  }

  if (scope[REDIS_CONNECT_PROMISE_KEY]) {
    await scope[REDIS_CONNECT_PROMISE_KEY];
    return scope[REDIS_CLIENT_KEY]?.isOpen ? scope[REDIS_CLIENT_KEY] : null;
  }

  const client = createClient({ url: redisUrl });
  client.on('error', (error) => {
    console.error('Redis client error:', error?.message || error);
  });

  scope[REDIS_CONNECT_PROMISE_KEY] = client
    .connect()
    .then(() => {
      scope[REDIS_CLIENT_KEY] = client;
      return client;
    })
    .catch((error) => {
      console.warn(
        'Redis is unavailable. Falling back to in-memory state for this process.',
        error?.message || error
      );
      markRedisDisabled();
      try {
        client.disconnect();
      } catch {
        // no-op
      }
      return null;
    })
    .finally(() => {
      scope[REDIS_CONNECT_PROMISE_KEY] = null;
    });

  const connectedClient = await scope[REDIS_CONNECT_PROMISE_KEY];
  return connectedClient?.isOpen ? connectedClient : null;
};

module.exports = {
  getRedisClient,
  hasRedisConfigured,
};
