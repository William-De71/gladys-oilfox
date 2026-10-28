// -----------------------------------------------------------------------------
// A fake FoxInsights Customer API for the tests: an in-memory `fetch` (no
// network), answering like the real API (docs/v1 and the answers seen live on
// 2026-10-28):
//   - POST /customer-api/v1/login { email, password }: an unknown e-mail
//     answers 404 {"statusCode":404,"errorCode":"GENERIC__NOT_FOUND"}, a wrong
//     password 401, a missing field 400;
//   - POST /customer-api/v1/token (form refresh_token): a refresh token is
//     single use; an unknown one answers 401 {"errorCode":"GENERIC__UNAUTHORIZED"};
//   - GET /customer-api/v1/device: a valid Bearer gets `{ items }`, a wrong or
//     expired one 401 (an HTML page), NO Authorization header 200 {"items":[]}.
// Access tokens are JWTs whose `exp` is 15 minutes after their issue on the
// clock of the test. Every call is recorded with that clock.
// Nothing starts on import (node --test also runs test/helpers/).
// -----------------------------------------------------------------------------

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @description A temporary folder standing for /data.
 * @returns {string} The path.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'gladys-oilfox-'));

/**
 * @description A logger that keeps every line (to check what is never logged).
 * @returns {object} The logger, with `lines`.
 */
function recordingLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')}`,
      );
  return {
    lines,
    debug: keep('debug'),
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  };
}

const BASE = 'https://oilfox.test';
const EMAIL = 'tank-owner@example.org';
const PASSWORD = 'not-a-real-password';
const TOKEN_MS = 15 * 60 * 1000;
const fixture = () =>
  JSON.parse(readFileSync(new URL('../fixtures/account.json', import.meta.url), 'utf8'));

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * @description A JWT whose only meaningful claim is `exp` (never signed for real).
 * @param {number} exp - The expiry (ms).
 * @param {number} serial - A number making it unique.
 * @returns {string} The token.
 */
function jwt(exp, serial) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ exp: Math.floor(exp / 1000), n: serial })}.sig`;
}

/**
 * @description The fake OilFox.
 * @param {object} [options] - `{ clock }`: `{ now }` in ms.
 * @returns {object} The fake: `fetch`, `baseUrl`, `calls`, `callsTo`, `items`,
 * `setDevice`, `rateLimited`, `down`, `password`.
 */
function createFakeOilFox({ clock = { now: Date.now() } } = {}) {
  const access = new Map();
  const refresh = new Set();
  let serial = 0;
  const fake = {
    clock,
    baseUrl: BASE,
    calls: [],
    items: fixture().items,
    email: EMAIL,
    password: PASSWORD,
    rateLimited: false,
    down: false,
    /**
     * @description The calls to a path.
     * @param {string} path - The path.
     * @returns {object[]} The calls.
     */
    callsTo: (path) => fake.calls.filter((call) => call.path === path),
    /**
     * @description Change a device of the account.
     * @param {string} hwid - Its hardware id.
     * @param {object} fields - The fields to change (undefined removes).
     */
    setDevice(hwid, fields) {
      const device = fake.items.find((item) => item.hwid === hwid);
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) delete device[key];
        else device[key] = value;
      }
    },
    /**
     * @description Issue a pair of tokens.
     * @returns {object} The answer.
     */
    issue() {
      serial += 1;
      const accessToken = jwt(fake.clock.now + TOKEN_MS, serial);
      const refreshToken = `refresh-${serial}`;
      access.set(accessToken, fake.clock.now + TOKEN_MS);
      refresh.add(refreshToken);
      return { token_type: 'Bearer', access_token: accessToken, refresh_token: refreshToken };
    },
    /**
     * @description The in-memory fetch.
     * @param {string} url - The URL.
     * @param {object} init - `{ method, headers, body }`.
     * @returns {Promise<Response>} The answer.
     */
    async fetch(url, init = {}) {
      const { pathname } = new URL(url);
      const headers = init.headers ?? {};
      fake.calls.push({
        path: pathname,
        method: init.method ?? 'GET',
        at: fake.clock.now,
        authorization: headers.authorization ?? null,
        userAgent: headers['user-agent'],
        body: init.body ?? null,
      });
      if (fake.down) {
        throw new TypeError('fetch failed');
      }
      if (fake.rateLimited) {
        return json(429, { statusCode: 429 }, { 'retry-after': '3600' });
      }
      if (pathname === '/customer-api/v1/login') {
        let body;
        try {
          body = JSON.parse(init.body);
        } catch {
          body = {};
        }
        if (!body.email || !body.password) {
          return json(400, { statusCode: 400, errorCode: 'GENERIC__BAD_REQUEST' });
        }
        if (body.email !== fake.email) {
          return json(404, { statusCode: 404, errorCode: 'GENERIC__NOT_FOUND' });
        }
        if (body.password !== fake.password) {
          return json(401, { statusCode: 401, errorCode: 'GENERIC__UNAUTHORIZED' });
        }
        return json(200, fake.issue());
      }
      if (pathname === '/customer-api/v1/token') {
        const token = new URLSearchParams(String(init.body ?? '')).get('refresh_token');
        if (!refresh.has(token)) {
          return json(401, { statusCode: 401, errorCode: 'GENERIC__UNAUTHORIZED' });
        }
        refresh.delete(token);
        return json(200, fake.issue());
      }
      if (pathname === '/customer-api/v1/device') {
        const header = headers.authorization;
        if (!header) {
          // The real API: no header, an empty list (seen live).
          return json(200, { items: [] });
        }
        const token = header.replace(/^Bearer /, '');
        const until = access.get(token);
        if (!until || until <= fake.clock.now) {
          return new Response('<!doctype html><title>HTTP Status 401 – Unauthorized</title>', {
            status: 401,
            headers: { 'content-type': 'text/html' },
          });
        }
        return json(200, { items: structuredClone(fake.items) });
      }
      return json(404, { statusCode: 404, errorCode: 'GENERIC__NOT_FOUND' });
    },
  };
  return fake;
}

export { createFakeOilFox, dataDir, recordingLogger, jwt, BASE, EMAIL, PASSWORD, TOKEN_MS };
