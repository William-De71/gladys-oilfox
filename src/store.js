// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/oilfox.json (mode 0600):
//
//   - `account`        a short SHA-256 of the e-mail address of the account
//                      the readings belong to (never the address, never the
//                      password; the tokens stay in memory);
//   - `devices`        the OilFox devices of the last reading (parse.js);
//                      `readAt` when it succeeded, `triedAt` the last try;
//   - `history`        per device: one point per measurement
//                      (`[metering instant, %, quantity]`), about a year, for
//                      the chart of the tank widget and the daily
//                      consumption, without any extra request;
//   - `seen`           what the scene triggers know, per device;
//   - `accessRefused`  why OilFox refuses the account, or null (the trigger
//                      fires once per refusal);
//   - `lastError`      the last error of a reading (diagnostic).
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_DIR = '/data';
const FILE = 'oilfox.json';
const EMPTY = () => ({
  account: null,
  devices: [],
  readAt: 0,
  triedAt: 0,
  history: {},
  seen: {},
  accessRefused: null,
  lastError: null,
});

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a
 * rename), readable by its owner only.
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => (Number.isFinite(value) ? value : 0);

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save, reset, path }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, FILE);
  let writing = Promise.resolve();
  const store = {
    path,
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      const data = EMPTY();
      data.account = typeof raw.account === 'string' ? raw.account : null;
      data.devices = Array.isArray(raw.devices)
        ? raw.devices.filter((device) => typeof device?.hwid === 'string' && device.hwid)
        : [];
      data.readAt = finite(raw.readAt);
      data.triedAt = finite(raw.triedAt);
      data.history = isObject(raw.history) ? { ...raw.history } : {};
      data.seen = isObject(raw.seen) ? { ...raw.seen } : {};
      data.accessRefused = isObject(raw.accessRefused) ? raw.accessRefused : null;
      data.lastError = isObject(raw.lastError) ? raw.lastError : null;
      store.data = data;
    },
    /**
     * @description Forget what was read (another account).
     */
    reset() {
      store.data = EMPTY();
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, FILE, createStore };
