// -----------------------------------------------------------------------------
// HTTP client of the FoxInsights Customer API, the official API of the OilFox
// tank sensors (documentation https://github.com/foxinsights/customer-api,
// docs/v1/README.md and docs/v1/swagger.yml, version 1 of 2021-11-08):
//
//   POST /customer-api/v1/login    JSON { email, password }
//                                  -> { token_type, access_token, refresh_token }
//   POST /customer-api/v1/token    form refresh_token=… -> the same; the
//                                  refresh token sent is invalidated
//   GET  /customer-api/v1/device   Bearer -> { items: [device, …] }
//
// The access token lives 15 minutes (documentation). It is kept in memory
// until the `exp` of its JWT (or 14 minutes), then renewed with the refresh
// token; a refused refresh token or access token gets one new sign-in.
// Nothing is written to disk: a restart signs in again.
//
// Fair use policy (README): "Getting the status of all of your device every
// hour is considered to be of fair use"; past the quota the API answers 429.
// The app reads once an hour (app.js); this client spaces the requests by 2 s
// and pauses every request after a 429 (1 hour, or the Retry-After), a 5xx or
// no answer (10 minutes doubling up to 2 hours).
//
// Answers seen live (2026-10-28):
//   - login, unknown account: 404 {"statusCode":404,"errorCode":"GENERIC__NOT_FOUND"};
//   - login, a missing field: 400 {"statusCode":400,"errorCode":"GENERIC__BAD_REQUEST"};
//   - token, invalid refresh token: 401 {"statusCode":401,"errorCode":"GENERIC__UNAUTHORIZED"};
//   - device with a wrong Bearer: 401 (an HTML page);
//   - device WITHOUT an Authorization header: 200 {"items":[]} — an empty
//     list that does not mean an empty account: the client never sends a
//     data request without a token.
// -----------------------------------------------------------------------------

const BASE_URL = 'https://api.oilfox.io';
const TIMEOUT_MS = 30000;
const SPACING_MS = 2000;
const RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000;
const MIN_PAUSE_MS = 10 * 60 * 1000;
const MAX_PAUSE_MS = 2 * 60 * 60 * 1000;
const RENEW_BEFORE_MS = 60 * 1000;
const DEFAULT_TOKEN_MS = 14 * 60 * 1000;

/**
 * @description An error of the OilFox API.
 */
class OilFoxError extends Error {
  /**
   * @param {string} kind - `auth` (credentials refused), `token` (the tokens
   * refused), `rate_limit`, `server`, `http`, `unreachable`, `failed`.
   * @param {string} message - What went wrong (never a credential).
   * @param {object} [extra] - `{ status, code, endpoint, retryAfter }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'OilFoxError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * @description The seconds of a Retry-After header (a number or an HTTP date).
 * @param {string|null} header - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Seconds, null when absent or unreadable.
 */
function retryAfterSeconds(header, now) {
  if (header === null || header === undefined || header === '') {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - now) / 1000)) : null;
}

/**
 * @description When a JWT expires, from its `exp` claim (never verified: only read).
 * @param {string} token - The JWT.
 * @returns {number|null} The instant (ms), null when unreadable.
 */
function jwtExpiry(token) {
  const payload = String(token ?? '').split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const exp = Number(claims?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * @description The OilFox client.
 * @param {object} options - Options.
 * @param {Function} options.getCredentials - `() => ({ email, password })`.
 * @param {string} options.userAgent - The User-Agent of every request.
 * @param {Function} [options.fetch] - The fetch implementation (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {Function} [options.now] - `() => number` in ms.
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @returns {object} The client.
 */
function createOilFoxClient({
  getCredentials,
  userAgent,
  fetch: fetchFn = globalThis.fetch,
  baseUrl = BASE_URL,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let chain = Promise.resolve();
  let lastRequestEnd = -Infinity;
  let pausedUntil = 0;
  let failures = 0;
  let tokens = null;
  let requests = 0;
  let signIns = 0;
  let refreshes = 0;

  /**
   * @description Run a function in the queue: one request at a time.
   * @param {Function} run - `() => Promise`.
   * @returns {Promise<*>} Its result.
   */
  function queued(run) {
    const result = chain.then(run);
    chain = result.catch(() => {});
    return result;
  }

  /**
   * @description Pause every request after a failure of the service.
   * @param {number} [base] - The first pause (ms).
   * @param {number|null} [retryAfter] - Seconds asked by the service.
   */
  function pause(base = MIN_PAUSE_MS, retryAfter = null) {
    failures += 1;
    const backoff = base * 2 ** Math.min(failures - 1, 4);
    const asked = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
    pausedUntil = Math.max(
      pausedUntil,
      now() + Math.min(Math.max(backoff, asked, base), MAX_PAUSE_MS),
    );
  }

  /**
   * @description Send a request now, spaced from the previous one.
   * @param {string} path - The path.
   * @param {object} init - `{ method, headers, body }`.
   * @returns {Promise<{ response: Response, body: object|null }>} The answer.
   */
  async function send(path, { method = 'GET', headers = {}, body } = {}) {
    if (pausedUntil > now()) {
      throw new OilFoxError('rate_limit', 'OilFox paused after errors', {
        endpoint: path,
        retryAfter: Math.ceil((pausedUntil - now()) / 1000),
      });
    }
    const wait = lastRequestEnd + SPACING_MS - now();
    if (wait > 0) {
      await sleep(wait);
    }
    requests += 1;
    let response;
    let text;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: { 'user-agent': userAgent, accept: 'application/json', ...headers },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await response.text().catch(() => '');
    } catch (err) {
      pause();
      throw new OilFoxError('unreachable', `OilFox unreachable: ${err.message}`, {
        endpoint: path,
      });
    } finally {
      lastRequestEnd = now();
    }
    let json;
    try {
      const parsed = JSON.parse(text);
      json = parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      json = null;
    }
    if (response.status === 429) {
      pause(RATE_LIMIT_PAUSE_MS, retryAfterSeconds(response.headers.get('retry-after'), now()));
      throw new OilFoxError('rate_limit', `HTTP 429 on ${path}`, { status: 429, endpoint: path });
    }
    if (response.status >= 500) {
      pause();
      throw new OilFoxError('server', `HTTP ${response.status} on ${path}`, {
        status: response.status,
        endpoint: path,
      });
    }
    return { response, body: json };
  }

  /**
   * @description Keep the tokens of a login or refresh answer.
   * @param {object|null} body - The answer.
   * @param {string} endpoint - The path (errors).
   * @returns {object} The tokens kept.
   */
  function keepTokens(body, endpoint) {
    const access = typeof body?.access_token === 'string' ? body.access_token.trim() : '';
    const refresh = typeof body?.refresh_token === 'string' ? body.refresh_token.trim() : '';
    if (!access) {
      throw new OilFoxError('failed', 'OilFox gave no access token', { endpoint });
    }
    tokens = {
      access,
      refresh: refresh || null,
      expiresAt: jwtExpiry(access) ?? now() + DEFAULT_TOKEN_MS,
    };
    failures = 0;
    return tokens;
  }

  /**
   * @description Sign in with the e-mail and the password.
   * @returns {Promise<object>} The tokens.
   */
  async function signIn() {
    const { email, password } = getCredentials();
    if (!email || !password) {
      throw new OilFoxError('auth', 'No e-mail or password', {
        code: 'missing',
        endpoint: '/customer-api/v1/login',
      });
    }
    const endpoint = '/customer-api/v1/login';
    signIns += 1;
    tokens = null;
    const { response, body } = await send(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if ([400, 401, 403, 404].includes(response.status)) {
      // 404 GENERIC__NOT_FOUND: no account with this e-mail (seen live);
      // 401 / 403: the password; 400: a field the API refuses.
      const code = response.status === 404 ? 'unknown_account' : 'refused';
      throw new OilFoxError('auth', `OilFox refused the sign-in (HTTP ${response.status})`, {
        status: response.status,
        code,
        endpoint,
      });
    }
    if (!response.ok) {
      throw new OilFoxError('http', `HTTP ${response.status} on ${endpoint}`, {
        status: response.status,
        endpoint,
      });
    }
    return keepTokens(body, endpoint);
  }

  /**
   * @description New tokens from the refresh token, else a new sign-in.
   * @returns {Promise<object>} The tokens.
   */
  async function renew() {
    const refresh = tokens?.refresh;
    if (!refresh) {
      return signIn();
    }
    const endpoint = '/customer-api/v1/token';
    refreshes += 1;
    // The refresh token is single use: forget it whatever the answer.
    tokens = null;
    const { response, body } = await send(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refresh }).toString(),
    });
    if (!response.ok) {
      return signIn();
    }
    return keepTokens(body, endpoint);
  }

  /**
   * @description The access token: the one kept while valid, else renewed.
   * @returns {Promise<string>} The token.
   */
  async function accessToken() {
    if (tokens && tokens.expiresAt - RENEW_BEFORE_MS > now()) {
      return tokens.access;
    }
    return (await renew()).access;
  }

  /**
   * @description The devices of the account, with one new sign-in when the
   * access token is refused.
   * @returns {Promise<object>} `{ items }`.
   */
  function devices() {
    const endpoint = '/customer-api/v1/device';
    return queued(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const bearer = attempt === 0 ? await accessToken() : (await signIn()).access;
        const { response, body } = await send(endpoint, {
          headers: { authorization: `Bearer ${bearer}` },
        });
        if (response.status === 401 || response.status === 403) {
          tokens = null;
          if (attempt === 0) {
            continue;
          }
          throw new OilFoxError(
            'token',
            `OilFox refused the access token (HTTP ${response.status})`,
            {
              status: response.status,
              endpoint,
            },
          );
        }
        if (!response.ok) {
          throw new OilFoxError('http', `HTTP ${response.status} on ${endpoint}`, {
            status: response.status,
            endpoint,
          });
        }
        if (!body || !Array.isArray(body.items)) {
          throw new OilFoxError('failed', `Unexpected answer of ${endpoint}`, { endpoint });
        }
        failures = 0;
        return body;
      }
      throw new OilFoxError('failed', `No answer of ${endpoint}`, { endpoint });
    });
  }

  return {
    /**
     * @description Sign in now (the test button), whatever the tokens kept.
     * @returns {Promise<object>} The tokens.
     */
    signIn: () => queued(signIn),
    devices,
    /**
     * @description Forget the tokens (another account).
     */
    forgetToken() {
      tokens = null;
    },
    /**
     * @description Until when the client pauses after errors (0: not paused).
     * @returns {number} The instant (ms).
     */
    pausedUntil: () => (pausedUntil > now() ? pausedUntil : 0),
    /**
     * @description When the access token expires (null: none kept).
     * @returns {number|null} The instant (ms).
     */
    tokenExpiresAt: () => tokens?.expiresAt ?? null,
    /**
     * @description How many requests, sign-ins and refreshes were sent since the start.
     * @returns {{ requests: number, signIns: number, refreshes: number }} The counts.
     */
    counts: () => ({ requests, signIns, refreshes }),
  };
}

export {
  BASE_URL,
  SPACING_MS,
  RATE_LIMIT_PAUSE_MS,
  MIN_PAUSE_MS,
  MAX_PAUSE_MS,
  OilFoxError,
  retryAfterSeconds,
  jwtExpiry,
  createOilFoxClient,
};
