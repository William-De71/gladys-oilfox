// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and a fake
// OilFox (test/helpers/fake-oilfox.js), an in-memory fetch on a fake clock.
// No test touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, ACCESS_RETRY_MS, USER_AGENT } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS, SCENE_ACTIONS, TANK_OUTPUTS } from '../src/events.js';
import { FILE } from '../src/store.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  createFakeOilFox,
  dataDir,
  recordingLogger,
  EMAIL,
  PASSWORD,
} from './helpers/fake-oilfox.js';

const NOW = Date.parse('2026-10-28T09:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CONFIG = { email: EMAIL, password: PASSWORD, language: 'en' };
const PREFIX = 'ext:test-integration';
const MAIN = 'ON0987654321';
const BROKEN = 'ON0123456789';
const PELLETS = 'ON0555000111';
const DEVICE_PATH = '/customer-api/v1/device';
const LOGIN_PATH = '/customer-api/v1/login';
const TOKEN_PATH = '/customer-api/v1/token';
const tankId = (hwid, feature) => `${PREFIX}:tank:${hwid}${feature ? `:${feature}` : ''}`;

/**
 * @description The integration, connected to a fake Gladys and a fake OilFox.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ config, dir, clock, fake }`.
 * @returns {Promise<object>} `{ gladys, app, fake, clock, dir, logger }`.
 */
async function startApp(t, { config = CONFIG, dir = dataDir(), clock = { now: NOW }, fake } = {}) {
  fake ??= createFakeOilFox({ clock });
  fake.clock = clock;
  const logger = recordingLogger();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    fetch: (url, init) => fake.fetch(url, init),
    baseUrl: fake.baseUrl,
    dataDir: dir,
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    timeZone: 'Europe/Paris',
    timers: false,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
  });
  return { gladys, app, fake, clock, dir, logger };
}

/**
 * @description Run the timer like the real one (every minute) for a while.
 * @param {object} env - `{ app, clock }`.
 * @param {number} ms - How long.
 */
async function run({ app, clock }, ms) {
  const end = clock.now + ms;
  while (clock.now < end) {
    await app.tick();
    clock.now += MINUTE;
  }
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 * @param {object} [names] - New names by hardware id (the user renames).
 */
async function createAll(gladys, names = {}) {
  for (const device of gladys.fake.discoveredDevices) {
    const hwid = device.external_id.split(':').pop();
    await gladys.fake.deviceCreated({
      ...structuredClone(device),
      name: names[hwid] ?? device.name,
    });
  }
}
const widget = async (gladys, key, options) =>
  (await gladys.fake.widgetGet(key, options)).data.content;
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const lastState = (gladys, id) =>
  gladys.fake.states.filter((state) => state.device_feature_external_id === id).at(-1);
const iso = (instant) => new Date(instant).toISOString();

test('startup: a sign-in, then the devices with the Bearer; one device per OilFox', async (t) => {
  const env = await startApp(t);
  const { gladys, fake } = env;
  assert.deepEqual(fake.calls, [], 'no request before the timer');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await run(env, 2 * MINUTE);
  assert.deepEqual(
    fake.calls.map((call) => call.path),
    [LOGIN_PATH, DEVICE_PATH],
  );
  assert.match(fake.calls[1].authorization, /^Bearer ey/);
  assert.equal(fake.calls[0].userAgent, USER_AGENT);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [
      device.name,
      device.external_id,
      device.features.map((feature) => feature.external_id.split(':').pop()),
    ]),
    [
      [
        `OilFox ${BROKEN}`,
        tankId(BROKEN),
        ['fill_level', 'quantity', 'days_reach', 'battery', 'status'],
      ],
      [
        `OilFox ${PELLETS}`,
        tankId(PELLETS),
        ['fill_level', 'quantity', 'days_reach', 'battery', 'status'],
      ],
      [
        `OilFox ${MAIN}`,
        tankId(MAIN),
        ['fill_level', 'quantity', 'days_reach', 'battery', 'status'],
      ],
    ],
  );
  assert.deepEqual(gladys.fake.connectionStatus.message, {
    en: 'Connected: 3 OilFox sensor(s), read every hour.',
    fr: 'Connecté : 3 capteur(s) OilFox, lus toutes les heures.',
    de: 'Verbunden: 3 OilFox-Sensor(en), stündlich gelesen.',
    es: 'Conectado: 3 sensor(es) OilFox, leídos cada hora.',
  });
  assert.deepEqual(gladys.fake.states, [], 'no state before the devices exist');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'never at the first reading');
});

test('pace: about one reading an hour, one more after each planned measurement; one sign-in a day', async (t) => {
  const env = await startApp(t);
  await run(env, DAY);
  const reads = env.fake.callsTo(DEVICE_PATH).map((call) => call.at);
  // 24 hourly readings, plus the readings 15 minutes after the planned
  // measurements (the three of the fixture fall within the hour of another).
  assert.ok(reads.length >= 24 && reads.length <= 28, `${reads.length} readings`);
  for (let i = 1; i < reads.length; i += 1) {
    assert.ok(reads[i] - reads[i - 1] >= 14 * MINUTE, `gap ${i}`);
  }
  // A planned measurement at 04:46 UTC on the 29th: read within the next 30 minutes.
  const planned = Date.parse('2026-10-29T04:46:48Z') + 15 * MINUTE;
  assert.ok(reads.some((at) => at >= planned - 15 * MINUTE && at <= planned + 15 * MINUTE));
  assert.equal(env.fake.callsTo(LOGIN_PATH).length, 1, 'the refresh token renews the session');
  assert.ok(env.fake.callsTo(TOKEN_PATH).length >= 20);
  for (const call of env.fake.callsTo(DEVICE_PATH)) {
    assert.match(call.authorization, /^Bearer /, 'never a reading without the token');
  }
});

test('states once the devices exist: level, liters or kg, days, battery as %, measurement state', async (t) => {
  const env = await startApp(t);
  const { gladys } = env;
  await run(env, 2 * MINUTE);
  await createAll(gladys);
  assert.equal(lastState(gladys, tankId(MAIN, 'fill_level')).state, 43);
  assert.equal(lastState(gladys, tankId(MAIN, 'quantity')).state, 1643);
  assert.equal(lastState(gladys, tankId(MAIN, 'days_reach')).state, 93);
  assert.equal(lastState(gladys, tankId(MAIN, 'battery')).state, 100);
  assert.equal(lastState(gladys, tankId(MAIN, 'status')).text, 'OK');
  assert.equal(lastState(gladys, tankId(PELLETS, 'quantity')).state, 840);
  assert.equal(
    lastState(gladys, tankId(BROKEN, 'fill_level')),
    undefined,
    'no level: nothing sent',
  );
  assert.equal(lastState(gladys, tankId(BROKEN, 'battery')).state, 15);
  assert.equal(lastState(gladys, tankId(BROKEN, 'status')).text, 'Tank settings missing');
  const pellets = gladys.fake.discoveredDevices.find(
    (device) => device.external_id === tankId(PELLETS),
  );
  const quantity = pellets.features.find((feature) => feature.external_id.endsWith(':quantity'));
  assert.equal(quantity.category, 'counter-sensor');
  assert.equal(quantity.name, 'Quantity (kg)');
  // A new measurement: only what changed is sent.
  const before = gladys.fake.states.length;
  env.fake.setDevice(MAIN, {
    currentMeteringAt: iso(env.clock.now),
    fillLevelPercent: 42,
    fillLevelQuantity: 1610,
  });
  await run(env, HOUR + MINUTE);
  const sent = gladys.fake.states.slice(before).map((state) => state.device_feature_external_id);
  assert.deepEqual(sent, [tankId(MAIN, 'fill_level'), tankId(MAIN, 'quantity')]);
});

test('scene triggers: new measurement, refill, measurement problem and back, late and back', async (t) => {
  const env = await startApp(t);
  const { gladys, fake, clock } = env;
  await run(env, 2 * MINUTE);
  assert.deepEqual(gladys.fake.sceneEvents, []);
  // A day of heating: 33 L used.
  fake.setDevice(MAIN, {
    currentMeteringAt: iso(clock.now),
    nextMeteringAt: iso(clock.now + DAY),
    fillLevelPercent: 42,
    fillLevelQuantity: 1610,
  });
  await run(env, HOUR);
  const [metering] = events(gladys, TRIGGERS.NEW_METERING);
  assert.equal(metering.data.tank, tankId(MAIN));
  assert.equal(metering.data.tank_name, `OilFox ${MAIN}`);
  assert.equal(metering.data.fill_percent, 42);
  assert.equal(metering.data.consumed, 33);
  assert.equal(metering.data.unit, 'L');
  // The delivery.
  fake.setDevice(MAIN, {
    currentMeteringAt: iso(clock.now),
    nextMeteringAt: iso(clock.now + DAY),
    fillLevelPercent: 91,
    fillLevelQuantity: 3480,
  });
  await run(env, HOUR);
  const [refill] = events(gladys, TRIGGERS.REFILL_DETECTED);
  assert.deepEqual(
    {
      before: refill.data.before_percent,
      after: refill.data.after_percent,
      added: refill.data.added_quantity,
    },
    { before: 42, after: 91, added: 1870 },
  );
  assert.equal(events(gladys, TRIGGERS.NEW_METERING).length, 2);
  // The problem of the broken tank goes, then another one comes.
  fake.setDevice(BROKEN, {
    validationError: undefined,
    fillLevelPercent: 60,
    fillLevelQuantity: 2000,
  });
  await run(env, HOUR);
  assert.equal(events(gladys, TRIGGERS.MEASUREMENT_OK).length, 1);
  fake.setDevice(BROKEN, { validationError: 'NO_EXTRACTED_VALUE' });
  await run(env, HOUR);
  const [problem] = events(gladys, TRIGGERS.MEASUREMENT_ERROR);
  assert.equal(problem.data.error, 'NO_EXTRACTED_VALUE');
  assert.equal(problem.data.error_label, 'No fill level detected');
  // The pellet sensor stops measuring: late 24 hours after its planned measurement.
  await run(env, 2 * DAY);
  const late = events(gladys, TRIGGERS.SENSOR_SILENT).map((event) => event.data.hwid);
  assert.ok(late.includes(PELLETS));
  assert.ok(!late.includes(MAIN) || events(gladys, TRIGGERS.SENSOR_SILENT).length >= 1);
  fake.setDevice(PELLETS, {
    currentMeteringAt: iso(clock.now),
    nextMeteringAt: iso(clock.now + DAY),
  });
  await run(env, HOUR + MINUTE);
  assert.ok(events(gladys, TRIGGERS.SENSOR_BACK).some((event) => event.data.hwid === PELLETS));
  for (const event of gladys.fake.sceneEvents) {
    for (const value of Object.values(event.data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
    }
  }
});

test('a refused account: one trigger, a clear status, tried again after an hour only', async (t) => {
  const fake = createFakeOilFox({ clock: { now: NOW } });
  fake.password = 'another-password';
  const env = await startApp(t, { fake });
  await run(env, 2 * MINUTE);
  const [refused] = events(env.gladys, TRIGGERS.ACCESS_REFUSED);
  assert.equal(refused.data.reason, 'refused');
  assert.match(refused.data.message, /OilFox refused the sign-in/);
  assert.equal(env.gladys.fake.connectionStatus.connected, false);
  await run(env, 30 * MINUTE);
  assert.equal(fake.callsTo(LOGIN_PATH).length, 1, 'no new try within the hour');
  assert.equal(events(env.gladys, TRIGGERS.ACCESS_REFUSED).length, 1, 'once per refusal');
  await run(env, ACCESS_RETRY_MS);
  assert.equal(fake.callsTo(LOGIN_PATH).length, 2);
  fake.password = PASSWORD;
  await run(env, ACCESS_RETRY_MS + MINUTE);
  assert.equal(env.gladys.fake.connectionStatus.connected, true);
  assert.equal(env.app.store.data.accessRefused, null);
});

test('an unknown e-mail is told apart (404 of the login)', async (t) => {
  const env = await startApp(t, { config: { ...CONFIG, email: 'nobody@example.org' } });
  await run(env, 2 * MINUTE);
  assert.equal(events(env.gladys, TRIGGERS.ACCESS_REFUSED)[0].data.reason, 'unknown_account');
  assert.match(env.gladys.fake.connectionStatus.message.fr, /aucun compte avec cette adresse/);
});

test('a 429 pauses every request for an hour', async (t) => {
  const env = await startApp(t);
  await run(env, 2 * MINUTE);
  env.fake.rateLimited = true;
  await run(env, HOUR);
  const count = env.fake.calls.length;
  await run(env, 50 * MINUTE);
  assert.equal(env.fake.calls.length, count, 'paused');
  env.fake.rateLimited = false;
  await run(env, 3 * HOUR);
  assert.ok(env.fake.calls.length > count, 'resumes');
  assert.equal(env.gladys.fake.connectionStatus.connected, true);
});

test('the store: /data file readable by its owner only, never the password, the e-mail or a token', async (t) => {
  const env = await startApp(t);
  await run(env, 2 * MINUTE);
  const path = join(env.dir, FILE);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const text = readFileSync(path, 'utf8');
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!text.includes(EMAIL));
  assert.ok(!text.includes('refresh-'));
  assert.ok(!/eyJ/.test(text));
  for (const line of env.logger.lines) {
    assert.ok(!line.includes(PASSWORD), line);
    assert.ok(!line.includes('refresh-'), line);
  }
  // A restart keeps the readings and does not announce them again.
  const again = await startApp(t, { dir: env.dir, clock: env.clock, fake: env.fake });
  assert.equal(again.app.store.data.devices.length, 3);
  await run(again, 2 * MINUTE);
  assert.deepEqual(again.gladys.fake.sceneEvents, []);
});

test('another account forgets what was read', async (t) => {
  const env = await startApp(t);
  await run(env, 2 * MINUTE);
  await env.gladys.fake.configUpdated({ ...CONFIG, email: 'someone@example.org' });
  assert.deepEqual(env.app.store.data.devices, []);
  assert.deepEqual(env.app.store.data.history, {});
});

test('scene action get_tank: the last values, no request, the name given in Gladys', async (t) => {
  const env = await startApp(t);
  await run(env, 2 * MINUTE);
  await createAll(env.gladys, { [MAIN]: 'Cuve de fioul' });
  const before = env.fake.calls.length;
  const result = (await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_TANK, { tank: tankId(MAIN) }))
    .data.outputs;
  assert.equal(env.fake.calls.length, before, 'no request');
  assert.deepEqual(
    Object.keys(result).filter((key) => !TANK_OUTPUTS.includes(key)),
    [],
  );
  assert.equal(result.tank_name, 'Cuve de fioul');
  assert.equal(result.fill_percent, 43);
  assert.equal(result.quantity, 1643);
  assert.equal(result.unit, 'L');
  assert.equal(result.days_reach, 93);
  assert.equal(result.empty_date, '2027-01-29');
  assert.equal(result.battery_level, 'FULL');
  assert.equal(result.battery_percent, 100);
  assert.equal(result.measurement_error, '');
  assert.equal(result.is_silent, false);
  assert.equal(result.last_metering, '2026-10-28T05:35:50.202Z');
  assert.match(result.summary, /^Cuve de fioul: 43 % \(1,643 L\), about 93 days of reach\.$/);
  const broken = (
    await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_TANK, { tank: tankId(BROKEN) })
  ).data.outputs;
  assert.equal(broken.fill_percent, undefined);
  assert.equal(broken.measurement_error, 'MISSING_STORAGE_CONFIG');
  assert.match(broken.summary, /Measurement: Tank settings missing\./);
  const first = (await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_TANK, {})).data.outputs;
  assert.equal(first.tank_name, `OilFox ${BROKEN}`, 'the first tank by default');
});

test('the daily consumption comes from the measurements kept, refills left out', async (t) => {
  const env = await startApp(t);
  const { fake, clock } = env;
  await run(env, 2 * MINUTE);
  let quantity = 1643;
  for (let day = 1; day <= 10; day += 1) {
    quantity -= day === 5 ? -1000 : 20;
    fake.setDevice(MAIN, {
      currentMeteringAt: iso(clock.now),
      nextMeteringAt: iso(clock.now + DAY),
      fillLevelQuantity: quantity,
      fillLevelPercent: Math.round((quantity / 3800) * 100),
    });
    await run(env, DAY);
  }
  const result = (await env.gladys.fake.sceneAction(SCENE_ACTIONS.GET_TANK, { tank: tankId(MAIN) }))
    .data.outputs;
  // About 20 L a day (the first measurement kept is not aligned on the day), the refill aside.
  assert.ok(
    result.daily_consumption >= 19 && result.daily_consumption <= 21,
    `${result.daily_consumption}`,
  );
});

test('widgets: valid contents in every language, a gauge per tank, the problems first', async (t) => {
  const env = await startApp(t);
  const { gladys } = env;
  const empty = await widget(gladys, WIDGETS.OVERVIEW, { language: 'fr' });
  assert.match(empty.components[0].text, /Lecture du compte OilFox/);
  await run(env, 2 * MINUTE);
  await createAll(gladys, { [MAIN]: 'Cuve de fioul' });
  for (let day = 1; day <= 5; day += 1) {
    env.fake.setDevice(MAIN, {
      currentMeteringAt: iso(env.clock.now),
      nextMeteringAt: iso(env.clock.now + DAY),
      fillLevelPercent: 43 - day,
      fillLevelQuantity: 1643 - 30 * day,
    });
    await run(env, DAY);
  }
  for (const language of LANGUAGES) {
    const overview = await widget(gladys, WIDGETS.OVERVIEW, { language });
    assert.deepEqual(validateWidgetContent(overview), [], language);
    const tank = await widget(gladys, WIDGETS.TANK, { language, settings: { tank: tankId(MAIN) } });
    assert.deepEqual(validateWidgetContent(tank), [], language);
    assert.ok(tank.components.length <= 8);
  }
  const overview = await widget(gladys, WIDGETS.OVERVIEW, { language: 'en' });
  assert.equal(
    overview.components.filter((c) => c.type === 'gauge').length,
    2,
    'no gauge without a level',
  );
  const list = overview.components.find((component) => component.type === 'card-list');
  assert.equal(list.items[0].title, `OilFox ${BROKEN}`, 'the tank with a problem first');
  assert.equal(list.items[0].badge.text, 'Error');
  const tank = await widget(gladys, WIDGETS.TANK, {
    language: 'en',
    settings: { tank: tankId(MAIN) },
  });
  assert.equal(tank.components[0].text, 'Cuve de fioul');
  const chart = tank.components.find((component) => component.type === 'chart');
  assert.equal(chart.series[0].points.length, 6);
  const rows = tank.components.find((component) => component.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => row.label),
    ['Measurement', 'Last measurement', 'Next measurement', 'Empty around', 'Use, 30-day average'],
  );
});

test('configuration buttons: test the connection, diagnostic without secrets', async (t) => {
  const env = await startApp(t);
  const message = (await env.gladys.fake.action(ACTIONS.TEST_CONNECTION)).data.message;
  assert.equal(message.en, `Connected to OilFox: 3 sensor(s) (${BROKEN}, ${PELLETS}, ${MAIN}).`);
  const done = (await env.gladys.fake.action(ACTIONS.DIAGNOSTIC)).data.message;
  assert.match(done.en, /Diagnostic written/);
  const lines = env.logger.lines.filter((line) => line.includes('OilFox diagnostic'));
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.ok(!line.includes(PASSWORD));
    assert.ok(!line.includes(EMAIL));
    assert.ok(!line.includes('eyJ'));
  }
  const fake = createFakeOilFox({ clock: { now: NOW } });
  fake.password = 'another-password';
  const refused = await startApp(t, { fake });
  const answer = (await refused.gladys.fake.action(ACTIONS.TEST_CONNECTION)).data.message;
  assert.match(answer.en, /refused the sign-in/);
  const none = await startApp(t, { config: { language: 'en' } });
  const missing = (await none.gladys.fake.action(ACTIONS.TEST_CONNECTION)).data.message;
  assert.match(missing.en, /^Enter the e-mail address/);
});

test('a scan before any reading reads the account; device creation re-sends the states', async (t) => {
  const env = await startApp(t);
  await env.gladys.fake.scanRequest();
  await new Promise((resolve) => setImmediate(resolve));
  await env.app.tick();
  assert.equal(env.fake.callsTo(DEVICE_PATH).length, 1);
  const before = env.gladys.fake.states.length;
  await createAll(env.gladys);
  assert.ok(env.gladys.fake.states.length > before);
});
