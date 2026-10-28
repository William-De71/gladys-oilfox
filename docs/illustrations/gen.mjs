// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake OilFox of the tests (test/helpers/fake-oilfox.js, the
// account of test/fixtures/account.json), run over 90 made-up days ending on
// Wednesday, 28 October 2026 at 10:00 in Paris: a heating oil tank used more
// as autumn comes, refilled in mid-September, a pellet silo, and a sensor
// whose tank is not set up yet. One measurement a day, smooth made-up
// consumption (no randomness): never real data.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { createFakeOilFox, dataDir, recordingLogger, EMAIL, PASSWORD } = await load(
  'test/helpers/fake-oilfox.js',
);

const NOW = Date.parse('2026-10-28T09:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const DAYS = 90;
const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const WIDGET_KEYS = ['overview', 'tank'];
const OIL = 'ON0987654321';
const PELLETS = 'ON0555000111';
const GARAGE = 'ON0123456789';
// The names a user would give the devices in Gladys.
const NAMES = {
  en: { [OIL]: 'Heating oil', [PELLETS]: 'Pellet silo', [GARAGE]: 'Garage tank' },
  fr: { [OIL]: 'Cuve de fioul', [PELLETS]: 'Silo à granulés', [GARAGE]: 'Cuve du garage' },
  de: { [OIL]: 'Heizöltank', [PELLETS]: 'Pelletlager', [GARAGE]: 'Garagentank' },
  es: { [OIL]: 'Gasóleo', [PELLETS]: 'Silo de pellets', [GARAGE]: 'Depósito garaje' },
};

/**
 * @description The use of a day, growing as the heating season comes.
 * @param {number} day - Days since the start (0 … DAYS).
 * @param {number} summer - The use of a summer day.
 * @param {number} autumn - The use of a late October day.
 * @returns {number} The use of that day.
 */
const use = (day, summer, autumn) => summer + (autumn - summer) * (day / DAYS) ** 2;

/**
 * @description The made-up levels of every day: [quantity, %, reach].
 * @returns {object} Per hardware id, the list of the days.
 */
function levels() {
  const series = { [OIL]: [], [PELLETS]: [] };
  let oil = 900;
  let pellets = 2100;
  for (let day = 0; day <= DAYS; day += 1) {
    if (day === 45) oil += 2400; // the delivery of mid-September
    oil -= use(day, 4, 24);
    pellets -= use(day, 2, 30);
    const today = { oil: use(day, 4, 24), pellets: use(day, 2, 30) };
    series[OIL].push([
      Math.round(oil),
      Math.round((oil / 3800) * 100),
      Math.round(oil / today.oil),
    ]);
    series[PELLETS].push([
      Math.round(pellets),
      Math.round((pellets / 3000) * 100),
      Math.round(pellets / today.pellets),
    ]);
  }
  return series;
}

/**
 * @description One language: the app run over 90 days, then the two widgets.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const start = NOW - DAYS * DAY;
  // Each day starts at 05:00 UTC, when the tanks measure.
  const clock = { now: start - 4 * HOUR };
  const fake = createFakeOilFox({ clock });
  const gladys = createFakeGladys({ config: { email: EMAIL, password: PASSWORD, language } });
  const app = createApp(gladys, {
    fetch: (url, init) => fake.fetch(url, init),
    baseUrl: fake.baseUrl,
    dataDir: dataDir(),
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    timeZone: 'Europe/Paris',
    timers: false,
    logger: recordingLogger(),
  });
  await gladys.connect();
  await app.whenReady();
  const series = levels();
  let created = false;
  for (let day = 0; day <= DAYS; day += 1) {
    const measured = clock.now;
    for (const hwid of [OIL, PELLETS]) {
      const [quantity, percent, reach] = series[hwid][day];
      fake.setDevice(hwid, {
        currentMeteringAt: new Date(measured).toISOString(),
        nextMeteringAt: new Date(measured + DAY).toISOString(),
        fillLevelQuantity: quantity,
        fillLevelPercent: percent,
        daysReach: reach,
      });
    }
    fake.setDevice(GARAGE, {
      currentMeteringAt: new Date(measured + 20 * 60000).toISOString(),
      nextMeteringAt: new Date(measured + 20 * 60000 + DAY).toISOString(),
    });
    for (let hour = 0; hour < 24 && clock.now < NOW; hour += 1) {
      await app.tick();
      clock.now += HOUR;
    }
    if (!created) {
      for (const device of gladys.fake.discoveredDevices) {
        const hwid = device.external_id.split(':').pop();
        await gladys.fake.deviceCreated({
          ...structuredClone(device),
          name: NAMES[language][hwid],
        });
      }
      created = true;
    }
  }
  clock.now = NOW;
  const settings = { tank: `ext:test-integration:tank:${OIL}` };
  const result = {};
  for (const key of WIDGET_KEYS) {
    result[key] = (await gladys.fake.widgetGet(key, { settings, language })).data.content;
  }
  await gladys.fake.shutdown();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(WIDGET_KEYS.map((key) => [key, card(key)])),
    now: NOW,
  }),
);
