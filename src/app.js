// -----------------------------------------------------------------------------
// The OilFox integration: every handler, registered on a Gladys client.
//
// Brings the OilFox tank sensors of an account (FoxMobile app) into Gladys,
// through the official FoxInsights Customer API, read only:
//   - devices (device.js): one per OilFox sensor (fill level, quantity, days
//     of reach, battery, measurement state);
//   - scene triggers (events.js): new measurement, refill detected, problem of
//     the measurement and its end, sensor late and back, access refused;
//   - scene action: values of a tank (no request);
//   - dashboard widgets (widgets.js): overview, one tank;
//   - configuration buttons: test the connection, diagnostic.
//
// Pace: the fair use policy of FoxInsights calls one reading an hour fair. A
// timer checks every minute what is due: a reading an hour (one request, plus
// the renewal of the 15-minute token), one more 15 minutes after a
// measurement planned by OilFox (once per planned measurement, so a new level
// shows up without waiting up to an hour), a retry 15 minutes after a
// failure, an hour after a refused account. The scene triggers are worked out
// after each reading, never from a scene action.
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and a fake OilFox (test/helpers/fake-oilfox.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createOilFoxClient } from './oilfox-api.js';
import { createStore } from './store.js';
import { parseDevices } from './parse.js';
import {
  tankIds,
  platformId,
  tankOfExternalId,
  defaultName,
  buildTankDevice,
  buildTankStates,
  statusText,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  TANK_OUTPUTS,
  pick,
  rounded,
  isSilent,
  dailyConsumption,
  emptyAt,
  detectTank,
  tankEventData,
  batteryPercent,
} from './events.js';
import {
  WIDGETS,
  messageContent,
  quantityText,
  buildOverviewWidget,
  buildTankWidget,
} from './widgets.js';
import { MINUTE_MS, HOUR_MS, defaultTimeZone, usableTimeZone, localParts } from './time.js';
import { t, all, LANGUAGES } from './i18n.js';

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  DIAGNOSTIC: 'diagnostic',
};
const TICK_MS = MINUTE_MS;
const STARTUP_DELAY_MS = 5 * 1000;
// The fair use policy: one reading an hour.
const READ_EVERY_MS = HOUR_MS;
// A planned measurement is read this long after its time, once.
const AFTER_METERING_MS = 15 * MINUTE_MS;
// A failed reading is tried again after this.
const RETRY_MS = 15 * MINUTE_MS;
// A refused account is tried again this often.
const ACCESS_RETRY_MS = HOUR_MS;
// Re-send unchanged values, so that Gladys does not show them as outdated
// (one measurement a day).
const HEARTBEAT_MS = 6 * HOUR_MS;
// History of the tank widget and of the daily consumption: about a year.
const HISTORY_SPAN_MS = 400 * 24 * HOUR_MS;
const HISTORY_MAX_POINTS = 500;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const USER_AGENT = `gladys-oilfox/${VERSION} (+https://github.com/William-De71/gladys-oilfox)`;

/**
 * @description The account the readings belong to: a short SHA-256 of the e-mail.
 * @param {string} email - The e-mail address.
 * @returns {string|null} The fingerprint.
 */
const accountOf = (email) =>
  email
    ? createHash('sha256').update(String(email).toLowerCase(), 'utf8').digest('hex').slice(0, 16)
    : null;

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.fetch] - HTTP transport of OilFox (tests).
 * @param {string} [options.baseUrl] - The API root (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    fetch: fetchFn,
    baseUrl,
    dataDir,
    now = () => Date.now(),
    sleep,
    timeZone: zone = defaultTimeZone(),
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdNames = new Map();
  let lastStatus = null;
  let lastDiscovery = null;
  let lastAccessTry = 0;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });
  const api = createOilFoxClient({
    getCredentials: () => ({ email: config.email, password: config.password }),
    userAgent: USER_AGENT,
    now,
    ...(sleep ? { sleep } : {}),
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });

  const hasCredentials = () => Boolean(config.email && config.password);

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  // --- What is known ----------------------------------------------------------------

  /**
   * @description The view of a tank the widgets, the scenes and the states use.
   * @param {object} device - parseDevice() entry.
   * @returns {object} The view.
   */
  function viewOf(device) {
    const deviceId = tankIds(gladys, device.hwid).device;
    return {
      device,
      deviceId,
      // The name the user gave in Gladys, else "OilFox <hwid>".
      name: createdNames.get(deviceId) || defaultName(device),
      silent: isSilent(device, now()),
    };
  }

  /**
   * @description The tank a widget or a scene action targets.
   * @param {unknown} externalId - The `source: "devices"` value.
   * @returns {object|null} The device, the first one by default.
   */
  function target(externalId) {
    const id = tankOfExternalId(externalId);
    const devices = store.data.devices;
    return devices.find((device) => platformId(device.hwid) === id) ?? devices[0] ?? null;
  }

  // --- Errors and status -------------------------------------------------------------

  /**
   * @description The message of an error, for a user.
   * @param {object} err - The error (`kind`, `code`).
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    if (err?.kind === 'auth') {
      if (err.code === 'missing') return t('statusNoCredentials', lang);
      return t(err.code === 'unknown_account' ? 'errUnknownAccount' : 'errRefused', lang);
    }
    const key = {
      token: 'errToken',
      rate_limit: 'errPaused',
      server: 'errServer',
      unreachable: 'errUnreachable',
    }[err?.kind];
    if (key) {
      return t(key, lang);
    }
    return t('errFailed', lang, { detail: String(err?.message ?? '').slice(0, 120) });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    if (!hasCredentials()) {
      await reportStatus(false, all('statusNoCredentials'));
      return;
    }
    if (store.data.accessRefused) {
      await reportStatus(
        false,
        all((lang) => errorText(store.data.accessRefused, lang)),
      );
      return;
    }
    if (!store.data.readAt) {
      await reportStatus(true, all('statusWaiting'));
      return;
    }
    if (store.data.devices.length === 0) {
      await reportStatus(false, all('statusNoTank'));
      return;
    }
    const tanks = store.data.devices.length;
    await reportStatus(
      true,
      all((lang) =>
        [
          t('statusOk', lang, { tanks }),
          ...(api.pausedUntil() ? [t('statusPaused', lang)] : []),
        ].join(' '),
      ),
    );
  }

  /**
   * @description Refresh the devices the user created, and their names.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdNames = new Map(devices.map((device) => [device.external_id, device.name ?? '']));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`OilFox: ${key}${data.hwid ? ` (${data.hwid})` : ''}`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the devices of the tanks, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = store.data.devices.map((device) =>
      buildTankDevice(gladys, device, { language: lang }),
    );
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of every created device.
   * @returns {Promise<void>}
   */
  async function publishAllStates() {
    const lang = textLanguage();
    for (const device of store.data.devices) {
      if (!createdNames.has(tankIds(gladys, device.hwid).device)) {
        continue;
      }
      const states = buildTankStates(gladys, device, { language: lang });
      // A late sensor lets its values age: Gladys shows them as outdated.
      const options = isSilent(device, now()) ? {} : { heartbeat: HEARTBEAT_MS };
      await gladys
        .publishChangedStates(states, options)
        .catch((err) =>
          logger.warn(`Unable to publish the states of ${device.hwid}: ${err.message}`),
        );
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description Remember a refusal of the account (the trigger fires once, from the timer).
   * @param {object} err - The error.
   */
  function refused(err) {
    const code = err.kind === 'auth' ? (err.code ?? 'refused') : 'token';
    const signature = `${err.kind}:${code}`;
    const announced =
      store.data.accessRefused?.signature === signature && store.data.accessRefused.announced;
    store.data.accessRefused = { kind: err.kind, code, signature, announced: Boolean(announced) };
    lastAccessTry = now();
  }

  /**
   * @description Note the error of a reading.
   * @param {Error} err - The error.
   */
  function noteError(err) {
    const kind = err.kind ?? 'failed';
    logger.warn(`OilFox reading (${kind}): ${err.message}`);
    store.data.lastError = { kind, message: String(err.message).slice(0, 200), at: now() };
  }

  /**
   * @description Keep a point of history per new measurement.
   * @param {object[]} devices - The devices read.
   */
  function keepHistory(devices) {
    const ids = new Set(devices.map((device) => device.hwid));
    for (const hwid of Object.keys(store.data.history)) {
      if (!ids.has(hwid)) delete store.data.history[hwid];
    }
    for (const device of devices) {
      const history = (store.data.history[device.hwid] ?? []).filter(
        (point) => Array.isArray(point) && now() - point[0] <= HISTORY_SPAN_MS,
      );
      const last = history[history.length - 1];
      const measured = Number.isFinite(device.meteringAt) && (!last || device.meteringAt > last[0]);
      if (measured && (Number.isFinite(device.percent) || Number.isFinite(device.quantity))) {
        history.push([device.meteringAt, device.percent, device.quantity]);
      }
      store.data.history[device.hwid] = history.slice(-HISTORY_MAX_POINTS);
    }
  }

  /**
   * @description Whether a reading is due now.
   * @returns {boolean} True when due.
   */
  function isDue() {
    const at = now();
    const data = store.data;
    if (at - data.triedAt < (data.lastError && data.triedAt > data.readAt ? RETRY_MS : 0)) {
      return false;
    }
    if (!data.readAt || at - data.readAt >= READ_EVERY_MS) {
      return true;
    }
    // A measurement OilFox planned is read once, 15 minutes after its time,
    // 15 minutes at least after the previous reading.
    if (at - data.readAt < AFTER_METERING_MS) {
      return false;
    }
    return data.devices.some(
      (device) =>
        Number.isFinite(device.nextMeteringAt) &&
        at >= device.nextMeteringAt + AFTER_METERING_MS &&
        data.readAt < device.nextMeteringAt + AFTER_METERING_MS,
    );
  }

  /**
   * @description Read the devices of the account, when due (or forced).
   * @param {object} [options] - `{ force }`.
   * @returns {Promise<{ read: boolean, error: object|null }>} What happened.
   */
  async function runReading({ force = false } = {}) {
    if (!hasCredentials()) {
      return { read: false, error: { kind: 'auth', code: 'missing' } };
    }
    if (!force && store.data.accessRefused && now() - lastAccessTry < ACCESS_RETRY_MS) {
      return { read: false, error: store.data.accessRefused };
    }
    if (!force && (!isDue() || api.pausedUntil())) {
      return { read: false, error: null };
    }
    const data = store.data;
    data.triedAt = now();
    lastAccessTry = now();
    let error = null;
    try {
      const devices = parseDevices(await api.devices());
      data.devices = devices;
      data.readAt = now();
      data.lastError = null;
      keepHistory(devices);
      const ids = new Set(devices.map((device) => device.hwid));
      for (const hwid of Object.keys(data.seen)) {
        if (!ids.has(hwid)) delete data.seen[hwid];
      }
      if (data.accessRefused) {
        logger.info('OilFox accepts the account again');
        data.accessRefused = null;
      }
    } catch (err) {
      noteError(err);
      if (['auth', 'token'].includes(err.kind)) {
        refused(err);
      }
      error = err;
    }
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    refreshWidgets();
    return { read: !error, error };
  }

  /**
   * @description Work out the scene events from what was read (timer only).
   * @returns {Promise<void>}
   */
  async function detectEvents() {
    const events = [];
    const lang = textLanguage();
    const refusal = store.data.accessRefused;
    if (refusal && !refusal.announced) {
      events.push({
        key: TRIGGERS.ACCESS_REFUSED,
        data: { reason: refusal.code, message: errorText(refusal, lang).slice(0, 1000) },
      });
      refusal.announced = true;
    }
    for (const device of store.data.devices) {
      const found = detectTank(store.data.seen[device.hwid], device, { now: now() });
      store.data.seen[device.hwid] = found.next;
      const view = viewOf(device);
      for (const event of found.events) {
        events.push({
          key: event.key,
          data: tankEventData(view, event, { language: lang, now: now() }),
        });
      }
    }
    await store.save();
    if (events.length) {
      await publishEvents(events);
      refreshWidgets();
    }
  }

  /**
   * @description One round of the timer: the reading due, then the triggers.
   * @returns {Promise<void>}
   */
  function tick() {
    if (!running) {
      running = (async () => {
        const { read } = await runReading();
        // Time passes for a late sensor even without a reading.
        await detectEvents();
        if (!read) {
          await publishAllStates();
        }
        await refreshStatus();
      })()
        .catch((err) => logger.error('Readings', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    clearTimeout(startTimer);
    if (!timers || stopped) {
      return;
    }
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  /**
   * @description Offer the devices, publish what is known, arm the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    await refreshStatus();
    schedule();
  }

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The message a widget shows when there is no tank to show.
   * @param {string} lang - The language.
   * @returns {object|null} The content, null when there are tanks.
   */
  function widgetMessage(lang) {
    if (!hasCredentials()) {
      return messageContent(t('statusNoCredentials', lang));
    }
    if (store.data.accessRefused) {
      return messageContent(errorText(store.data.accessRefused, lang));
    }
    if (store.data.devices.length === 0) {
      return messageContent(t(store.data.readAt ? 'statusNoTank' : 'statusWaiting', lang));
    }
    return null;
  }

  gladys.onWidgetGet(WIDGETS.OVERVIEW, async ({ language: lang } = {}) => {
    rememberLanguage(lang);
    return (
      widgetMessage(lang) ??
      buildOverviewWidget({ views: store.data.devices.map(viewOf), language: lang, now: now() })
    );
  });

  gladys.onWidgetGet(WIDGETS.TANK, async ({ settings = {}, language: lang } = {}) => {
    rememberLanguage(lang);
    const message = widgetMessage(lang);
    if (message) {
      return message;
    }
    const device = target(settings.tank);
    return buildTankWidget({
      view: viewOf(device),
      history: store.data.history[device.hwid] ?? [],
      language: lang,
      now: now(),
      timeZone,
    });
  });

  // --- Scene action ------------------------------------------------------------------

  // Answers from what the timer read: no request.
  gladys.onSceneAction(SCENE_ACTIONS.GET_TANK, async (fields = {}) => {
    const lang = textLanguage();
    if (!hasCredentials()) {
      throw new Error(t('statusNoCredentials', lang));
    }
    const device = target(fields.tank);
    if (!device) {
      throw new Error(t('errNoTank', lang));
    }
    const view = viewOf(device);
    const empty = emptyAt(device);
    const iso = (instant) => (Number.isFinite(instant) ? new Date(instant).toISOString() : null);
    const perDay = dailyConsumption(store.data.history[device.hwid] ?? [], now());
    const summary = [
      t('summaryTank', lang, {
        name: view.name,
        percent: Number.isFinite(device.percent) ? device.percent : '–',
        quantity: quantityText(device.quantity, device.unit, lang),
        days: Number.isFinite(device.daysReach) ? device.daysReach : '–',
      }),
      ...(device.error ? [t('summaryError', lang, { error: statusText(device, lang) })] : []),
      ...(view.silent ? [t('summarySilent', lang)] : []),
    ].join(' ');
    return pick(
      {
        tank_name: view.name,
        fill_percent: device.percent,
        quantity: device.quantity,
        unit: device.unit,
        days_reach: device.daysReach,
        empty_date: empty ? localParts(empty, timeZone).date : null,
        daily_consumption: rounded(perDay, 1),
        battery_level: device.battery,
        battery_percent: batteryPercent(device.battery),
        measurement_error: device.error ?? '',
        measurement_error_label: device.error ? statusText(device, lang) : '',
        last_metering: iso(device.meteringAt),
        next_metering: iso(device.nextMeteringAt),
        is_silent: view.silent,
        summary: summary.slice(0, 1000),
      },
      TANK_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!hasCredentials()) {
      return all('statusNoCredentials');
    }
    try {
      await api.signIn();
      store.data.accessRefused = null;
      const { error } = await runReading({ force: true });
      lastStatus = null;
      await refreshStatus();
      schedule();
      if (error) {
        return all((lang) => errorText(error, lang));
      }
      const names = store.data.devices
        .map((device) => device.hwid)
        .slice(0, 10)
        .join(', ');
      return all((lang) =>
        t('testOk', lang, {
          count: store.data.devices.length,
          names: names ? ` (${names})` : '',
        }).slice(0, 1000),
      );
    } catch (err) {
      noteError(err);
      if (['auth', 'token'].includes(err.kind)) {
        refused(err);
        await store.save();
        lastStatus = null;
        await refreshStatus();
      }
      return all((lang) => errorText(err, lang));
    }
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (Number.isFinite(value) && value ? new Date(value).toISOString() : null);
    const data = store.data;
    const report = {
      version: VERSION,
      timeZone,
      email: config.email ? 'set' : 'missing',
      password: config.password ? 'set' : 'missing',
      token: api.tokenExpiresAt() ? { expiresAt: iso(api.tokenExpiresAt()) } : null,
      language: config.language,
      accessRefused: data.accessRefused,
      lastError: data.lastError,
      readAt: iso(data.readAt),
      triedAt: iso(data.triedAt),
      api: { ...api.counts(), pausedUntil: iso(api.pausedUntil()) },
      devices: data.devices.map((device) => ({
        ...device,
        meteringAt: iso(device.meteringAt),
        nextMeteringAt: iso(device.nextMeteringAt),
        created: createdNames.has(tankIds(gladys, device.hwid).device),
        historyPoints: (data.history[device.hwid] ?? []).length,
        seen: data.seen[device.hwid] ?? null,
      })),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `OilFox diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
    if (!count && !store.data.readAt) {
      tick();
    }
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    await publishAllStates();
    refreshWidgets();
  });

  gladys.onDeviceUpdated(refreshCreatedDevices);
  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  /**
   * @description Forget what belongs to another account.
   */
  function checkAccount() {
    const account = accountOf(config.email);
    if (store.data.account && store.data.account !== account) {
      store.reset();
      api.forgetToken();
    }
    store.data.account = account;
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    checkAccount();
    if (previous.email !== config.email || previous.password !== config.password) {
      // New credentials: a new sign-in at the next round.
      api.forgetToken();
      store.data.accessRefused = null;
      store.data.triedAt = 0;
      store.data.readAt = 0;
      lastAccessTry = 0;
    }
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      checkAccount();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    await store.save();
  });

  return {
    store,
    api,
    tick,
    runReading,
    detectEvents,
    isDue,
    viewOf,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export {
  createApp,
  ACTIONS,
  USER_AGENT,
  READ_EVERY_MS,
  AFTER_METERING_MS,
  RETRY_MS,
  ACCESS_RETRY_MS,
  HEARTBEAT_MS,
};
