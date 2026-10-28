// The transitions behind the scene triggers, the flat data of the events,
// and the figures worked out from the history.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRIGGERS,
  detectTank,
  tankEventData,
  dailyConsumption,
  emptyAt,
  isSilent,
  pick,
  rounded,
  DAY_MS,
  SILENT_AFTER_MS,
} from '../src/events.js';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const NOW = Date.parse('2026-10-28T09:00:00Z');
const tank = (fields = {}) => ({
  hwid: 'ON1',
  meteringAt: NOW - 3600000,
  nextMeteringAt: NOW + DAY_MS,
  daysReach: 50,
  error: null,
  battery: 'GOOD',
  percent: 40,
  quantity: 1500,
  unit: 'L',
  ...fields,
});
const keys = (found) => found.events.map((event) => event.key);

test('the first reading is learned, never announced', () => {
  const found = detectTank(undefined, tank({ error: 'SENSOR_CONFIG' }), { now: NOW });
  assert.deepEqual(found.events, []);
  assert.equal(found.next.known, true);
  assert.equal(found.next.error, 'SENSOR_CONFIG');
});

test('a new measurement, a refill of 5 points or more, never the same measurement twice', () => {
  const seen = detectTank(undefined, tank(), { now: NOW }).next;
  assert.deepEqual(keys(detectTank(seen, tank(), { now: NOW })), [], 'nothing new');
  const used = detectTank(seen, tank({ meteringAt: NOW, percent: 39, quantity: 1460 }), {
    now: NOW,
  });
  assert.deepEqual(keys(used), [TRIGGERS.NEW_METERING]);
  assert.equal(used.events[0].extra.consumed, 40);
  const small = detectTank(seen, tank({ meteringAt: NOW, percent: 44 }), { now: NOW });
  assert.deepEqual(keys(small), [TRIGGERS.NEW_METERING], '4 points: noise, not a refill');
  const refill = detectTank(seen, tank({ meteringAt: NOW, percent: 85, quantity: 3200 }), {
    now: NOW,
  });
  assert.deepEqual(keys(refill), [TRIGGERS.NEW_METERING, TRIGGERS.REFILL_DETECTED]);
  assert.deepEqual(refill.events[1].extra, { before: 40, added: 1700 });
  assert.equal(refill.events[0].extra.consumed, 0, 'a refill is not a consumption');
});

test('a measurement without a level keeps the last level known for the next refill', () => {
  let seen = detectTank(undefined, tank(), { now: NOW }).next;
  seen = detectTank(
    seen,
    tank({ meteringAt: NOW, percent: null, quantity: null, error: 'NO_EXTRACTED_VALUE' }),
    {
      now: NOW,
    },
  ).next;
  assert.equal(seen.percent, 40);
  const back = detectTank(seen, tank({ meteringAt: NOW + DAY_MS, percent: 90, quantity: 3400 }), {
    now: NOW + DAY_MS,
  });
  assert.deepEqual(keys(back), [
    TRIGGERS.NEW_METERING,
    TRIGGERS.REFILL_DETECTED,
    TRIGGERS.MEASUREMENT_OK,
  ]);
});

test('problem of the measurement: on a change of code, then back to OK', () => {
  let seen = detectTank(undefined, tank(), { now: NOW }).next;
  const failed = detectTank(seen, tank({ error: 'SENSOR_CONFIG' }), { now: NOW });
  assert.deepEqual(keys(failed), [TRIGGERS.MEASUREMENT_ERROR]);
  seen = failed.next;
  assert.deepEqual(keys(detectTank(seen, tank({ error: 'SENSOR_CONFIG' }), { now: NOW })), []);
  assert.deepEqual(keys(detectTank(seen, tank({ error: 'DISTANCE_TOO_SHORT' }), { now: NOW })), [
    TRIGGERS.MEASUREMENT_ERROR,
  ]);
  assert.deepEqual(keys(detectTank(seen, tank(), { now: NOW })), [TRIGGERS.MEASUREMENT_OK]);
});

test('late 24 hours after the planned measurement, back with a new one', () => {
  const late = NOW + DAY_MS + SILENT_AFTER_MS + 1;
  assert.equal(isSilent(tank(), NOW), false);
  assert.equal(isSilent(tank(), late), true);
  assert.equal(isSilent(tank({ nextMeteringAt: null }), late), false);
  let seen = detectTank(undefined, tank(), { now: NOW }).next;
  const silent = detectTank(seen, tank(), { now: late });
  assert.deepEqual(keys(silent), [TRIGGERS.SENSOR_SILENT]);
  seen = silent.next;
  assert.deepEqual(keys(detectTank(seen, tank(), { now: late + 3600000 })), [], 'once');
  const back = detectTank(seen, tank({ meteringAt: late, nextMeteringAt: late + DAY_MS }), {
    now: late,
  });
  assert.deepEqual(keys(back), [TRIGGERS.NEW_METERING, TRIGGERS.SENSOR_BACK]);
});

test('the data of every event: flat, scalars, only declared variables', () => {
  const variables = new Map(
    manifest.scene_triggers.map((trigger) => [trigger.key, trigger.variables.map((v) => v.key)]),
  );
  const view = {
    device: tank({ error: 'SENSOR_CONFIG' }),
    deviceId: 'ext:x:tank:ON1',
    name: 'Cuve',
  };
  for (const key of Object.values(TRIGGERS).filter((key) => key !== TRIGGERS.ACCESS_REFUSED)) {
    const data = tankEventData(
      view,
      { key, extra: { consumed: 10, before: 30, added: 900 } },
      {
        language: 'fr',
        now: NOW + 2 * DAY_MS,
      },
    );
    assert.ok(Object.keys(data).length <= 30);
    for (const [name, value] of Object.entries(data)) {
      assert.ok(variables.get(key).includes(name), `${key}.${name}`);
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value), name);
    }
  }
  const error = tankEventData(
    view,
    { key: TRIGGERS.MEASUREMENT_ERROR, extra: {} },
    { language: 'fr', now: NOW },
  );
  assert.equal(error.error_label, 'Mesure défectueuse');
  const late = tankEventData(
    view,
    { key: TRIGGERS.SENSOR_SILENT, extra: {} },
    {
      language: 'en',
      now: NOW + DAY_MS + 30 * 3600000,
    },
  );
  assert.equal(late.hours_late, 30);
});

test('daily consumption over 30 days, refills left out; empty day from the reach', () => {
  const points = [0, 1, 2, 3, 4].map((day) => [NOW - (4 - day) * DAY_MS, 40, 1500 - day * 25]);
  assert.equal(dailyConsumption(points, NOW), 25);
  points.splice(2, 0, [NOW - 2.5 * DAY_MS, 90, 3000]);
  assert.ok(dailyConsumption(points, NOW) > 25, 'the drop after the refill counts');
  assert.equal(dailyConsumption(points.slice(0, 1), NOW), null);
  assert.equal(
    dailyConsumption(
      [
        [NOW - DAY_MS, 40, 1500],
        [NOW, 40, 1490],
      ],
      NOW,
    ),
    null,
    'under 2 days',
  );
  assert.equal(
    dailyConsumption(
      [
        [NOW - 60 * DAY_MS, 40, 1500],
        [NOW - 40 * DAY_MS, 40, 1400],
      ],
      NOW,
    ),
    null,
  );
  assert.equal(emptyAt(tank({ meteringAt: NOW, daysReach: 10 })), NOW + 10 * DAY_MS);
  assert.equal(emptyAt(tank({ daysReach: null })), null);
  assert.deepEqual(pick({ a: 1, b: null, c: '' }, ['a', 'b', 'c']), { a: 1, c: '' });
  assert.equal(rounded(1.26, 1), 1.3);
  assert.equal(rounded(null), null);
});
