// The devices offered on the Discovery screen, checked like the core checks
// them (a single invalid field rejects the whole batch, and a missing min /
// max / read_only / has_feedback makes "Add" fail in 422).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { parseDevices, parseDevice, batteryPercent } from '../src/parse.js';
import {
  buildTankDevice,
  buildTankStates,
  tankOfExternalId,
  platformId,
  statusText,
} from '../src/device.js';
import { LANGUAGES } from '../src/i18n.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};
const account = JSON.parse(
  readFileSync(new URL('./fixtures/account.json', import.meta.url), 'utf8'),
);
const devices = parseDevices(account);
const byId = Object.fromEntries(devices.map((device) => [device.hwid, device]));

// The pairs of the core (DEVICE_FEATURE_UNITS_BY_CATEGORY, master 2026-10-26).
const UNITS_OF = {
  [C.LEVEL_SENSOR]: [U.PERCENT],
  [C.VOLUME_SENSOR]: [U.LITER],
  [C.COUNTER_SENSOR]: [null],
  [C.DURATION]: [U.DAYS],
  [C.BATTERY]: [U.PERCENT],
  [C.TEXT]: [null],
};

test('the answer is made safe: absent is null, never 0; sorted, without duplicates', () => {
  assert.deepEqual(
    devices.map((device) => device.hwid),
    ['ON0123456789', 'ON0555000111', 'ON0987654321'],
  );
  const broken = byId.ON0123456789;
  assert.equal(broken.percent, null);
  assert.equal(broken.quantity, null);
  assert.equal(broken.daysReach, null);
  assert.equal(broken.error, 'MISSING_STORAGE_CONFIG');
  assert.equal(byId.ON0555000111.unit, 'kg');
  assert.equal(byId.ON0987654321.meteringAt, Date.parse('2026-10-28T05:35:50.202Z'));
  assert.equal(parseDevice({ quantityUnit: 'L' }), null, 'no hardware id');
  assert.equal(parseDevice({ hwid: 'X', fillLevelPercent: 140 }).percent, 100);
  assert.equal(parseDevice({ hwid: 'X', batteryLevel: 'odd' }).battery, null);
  assert.equal(parseDevices({ items: [{ hwid: 'A' }, { hwid: 'A' }] }).length, 1);
  assert.deepEqual(parseDevices(null), []);
  assert.deepEqual(['FULL', 'GOOD', 'MEDIUM', 'WARNING', 'CRITICAL', null].map(batteryPercent), [
    100,
    75,
    50,
    15,
    5,
    null,
  ]);
});

test('every feature is complete and uses a category / type / unit pair of the core', () => {
  for (const language of LANGUAGES) {
    for (const device of devices) {
      const built = buildTankDevice(fakeGladys, device, { language });
      assert.equal(built.should_poll, false);
      assert.equal(built.poll_frequency, undefined, 'its own timer');
      assert.ok(built.name.length <= 100);
      for (const feature of built.features) {
        for (const key of ['name', 'external_id', 'category', 'type', 'min', 'max']) {
          assert.ok(feature[key] !== undefined, `${feature.external_id}: ${key}`);
        }
        assert.equal(feature.read_only, true);
        assert.equal(feature.has_feedback, false);
        assert.ok(feature.min <= feature.max);
        assert.ok(UNITS_OF[feature.category]?.includes(feature.unit), feature.external_id);
        assert.ok(Object.values(T).some((types) => Object.values(types).includes(feature.type)));
      }
    }
  }
  const main = buildTankDevice(fakeGladys, byId.ON0987654321);
  assert.deepEqual(
    main.features.map((feature) => [feature.category, feature.type, feature.unit]),
    [
      ['level-sensor', 'liquid-level-percent', 'percent'],
      ['volume-sensor', 'integer', 'liter'],
      ['duration', 'integer', 'days'],
      ['battery', 'integer', 'percent'],
      ['text', 'text', null],
    ],
  );
});

test('states: only what OilFox gives, within bounds, the measurement state in words', () => {
  const states = buildTankStates(fakeGladys, byId.ON0987654321, { language: 'fr' });
  assert.deepEqual(
    states.map((state) => [
      state.device_feature_external_id.split(':').pop(),
      state.state ?? state.text,
    ]),
    [
      ['fill_level', 43],
      ['quantity', 1643],
      ['days_reach', 93],
      ['battery', 100],
      ['status', 'OK'],
    ],
  );
  const broken = buildTankStates(fakeGladys, byId.ON0123456789, { language: 'de' });
  assert.deepEqual(
    broken.map((state) => state.device_feature_external_id.split(':').pop()),
    ['battery', 'status'],
  );
  assert.equal(broken.at(-1).text, 'Tankeinstellungen fehlen');
  assert.equal(statusText({ error: 'NEW_CODE' }, 'en'), 'NEW_CODE', 'an unknown code shown as is');
  assert.equal(statusText({ error: null, meteringAt: null }, 'es'), 'Todavía sin medición');
});

test('external ids: the hardware id, made safe, and read back', () => {
  assert.equal(platformId('ON 01/23'), 'ON-01-23');
  assert.equal(tankOfExternalId('ext:x:tank:ON0987654321'), 'ON0987654321');
  assert.equal(tankOfExternalId('ext:x:tank:ON0987654321:fill_level'), 'ON0987654321');
  assert.equal(tankOfExternalId('ext:x:other:1'), null);
  assert.equal(tankOfExternalId(undefined), null);
});
