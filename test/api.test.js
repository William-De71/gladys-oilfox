// The OilFox client against the fake OilFox: tokens, refusals, pauses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOilFoxClient,
  jwtExpiry,
  retryAfterSeconds,
  RATE_LIMIT_PAUSE_MS,
  MIN_PAUSE_MS,
} from '../src/oilfox-api.js';
import { createFakeOilFox, jwt, EMAIL, PASSWORD, TOKEN_MS } from './helpers/fake-oilfox.js';

const NOW = Date.parse('2026-10-28T09:00:00Z');

/**
 * @description A client on the fake OilFox.
 * @param {object} [credentials] - `{ email, password }`.
 * @returns {object} `{ api, fake, clock }`.
 */
function client(credentials = { email: EMAIL, password: PASSWORD }) {
  const clock = { now: NOW };
  const fake = createFakeOilFox({ clock });
  const api = createOilFoxClient({
    getCredentials: () => credentials,
    userAgent: 'gladys-oilfox/test',
    fetch: (url, init) => fake.fetch(url, init),
    baseUrl: fake.baseUrl,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
  });
  return { api, fake, clock };
}

test('the expiry of a JWT and the Retry-After header are read safely', () => {
  assert.equal(jwtExpiry(jwt(NOW + TOKEN_MS, 1)), Math.floor((NOW + TOKEN_MS) / 1000) * 1000);
  assert.equal(jwtExpiry('not-a-jwt'), null);
  assert.equal(jwtExpiry('a.!!!.c'), null);
  assert.equal(retryAfterSeconds('120', NOW), 120);
  assert.equal(retryAfterSeconds(new Date(NOW + 60000).toUTCString(), NOW), 60);
  assert.equal(retryAfterSeconds(null, NOW), null);
});

test('sign-in with JSON, the devices with the Bearer, the token kept while valid', async () => {
  const { api, fake, clock } = client();
  const answer = await api.devices();
  assert.equal(answer.items.length, 3);
  const [login, device] = fake.calls;
  assert.equal(login.method, 'POST');
  assert.deepEqual(JSON.parse(login.body), { email: EMAIL, password: PASSWORD });
  assert.match(device.authorization, /^Bearer /);
  clock.now += 5 * 60 * 1000;
  await api.devices();
  assert.equal(fake.callsTo('/customer-api/v1/login').length, 1);
  assert.equal(fake.callsTo('/customer-api/v1/token').length, 0, 'still valid');
});

test('an expired token is renewed with the single-use refresh token (a form)', async () => {
  const { api, fake, clock } = client();
  await api.devices();
  clock.now += TOKEN_MS;
  await api.devices();
  const [refresh] = fake.callsTo('/customer-api/v1/token');
  assert.equal(refresh.body, 'refresh_token=refresh-1');
  clock.now += TOKEN_MS;
  await api.devices();
  assert.equal(fake.callsTo('/customer-api/v1/token')[1].body, 'refresh_token=refresh-2');
  assert.equal(fake.callsTo('/customer-api/v1/login').length, 1);
  assert.deepEqual(api.counts(), { requests: 6, signIns: 1, refreshes: 2 });
});

test('a refused refresh token or access token falls back to a new sign-in', async () => {
  const { api, fake, clock } = client();
  await api.devices();
  clock.now += TOKEN_MS;
  // Someone else used the refresh token: it is gone.
  const answer = await fake.fetch(`${fake.baseUrl}/customer-api/v1/token`, {
    method: 'POST',
    body: 'refresh_token=refresh-1',
  });
  assert.equal(answer.status, 200, 'the test used it');
  await api.devices();
  assert.equal(fake.callsTo('/customer-api/v1/login').length, 2);
});

test('the sign-in errors: unknown account, wrong password, missing credentials', async () => {
  const unknown = client({ email: 'nobody@example.org', password: PASSWORD });
  await assert.rejects(unknown.api.devices(), {
    kind: 'auth',
    code: 'unknown_account',
    status: 404,
  });
  const wrong = client({ email: EMAIL, password: 'not-the-password' });
  await assert.rejects(wrong.api.devices(), { kind: 'auth', code: 'refused', status: 401 });
  const none = client({ email: '', password: '' });
  await assert.rejects(none.api.devices(), { kind: 'auth', code: 'missing' });
  assert.equal(none.fake.calls.length, 0);
});

test('a 429 pauses an hour (or the Retry-After), a 5xx or no answer 10 minutes', async () => {
  const { api, fake, clock } = client();
  fake.rateLimited = true;
  await assert.rejects(api.devices(), { kind: 'rate_limit', status: 429 });
  assert.equal(api.pausedUntil(), clock.now + RATE_LIMIT_PAUSE_MS);
  const calls = fake.calls.length;
  await assert.rejects(api.devices(), { kind: 'rate_limit' });
  assert.equal(fake.calls.length, calls, 'no request while paused');
  fake.rateLimited = false;
  clock.now += RATE_LIMIT_PAUSE_MS;
  assert.equal((await api.devices()).items.length, 3);

  const down = client();
  down.fake.down = true;
  await assert.rejects(down.api.devices(), { kind: 'unreachable' });
  assert.equal(down.api.pausedUntil(), down.clock.now + MIN_PAUSE_MS);
});

test('an answer without items is an error, never an empty account', async () => {
  const { api, fake } = client();
  const original = fake.fetch;
  fake.fetch = async (url, init) =>
    new URL(url).pathname === '/customer-api/v1/device'
      ? new Response('{"unexpected":true}', { status: 200 })
      : original(url, init);
  await assert.rejects(api.devices(), { kind: 'failed' });
  // The real API answers an empty list without the header: the client always sends it.
  const bare = await original(`${fake.baseUrl}/customer-api/v1/device`, {});
  assert.deepEqual(await bare.json(), { items: [] });
});
