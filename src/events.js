// -----------------------------------------------------------------------------
// Scene triggers, the keys of the scene action, and the figures worked out
// from the history.
//
// Triggers, once per transition, never at the first reading of a tank, never
// because of a scene action (the detection runs on the timer only):
//   - `new_metering`        OilFox measured the tank (about once a day);
//   - `refill_detected`     the fill level rose by 5 points or more between
//                           two measurements: a delivery;
//   - `measurement_error`   OilFox reports a problem of the measurement;
//   - `measurement_ok`      the problem is gone;
//   - `sensor_silent`       the measurement planned by OilFox is 24 hours late;
//   - `sensor_back`         a new measurement arrives after that;
//   - `access_refused`      OilFox refuses the e-mail, the password or the tokens.
// A value to compare (>, <) is a feature of the device, not a trigger: "fill
// level under 20 %" is a device condition of the scene.
// -----------------------------------------------------------------------------

import { t } from './i18n.js';
import { errorLabel } from './device.js';
import { batteryPercent } from './parse.js';

const TRIGGERS = {
  NEW_METERING: 'new_metering',
  REFILL_DETECTED: 'refill_detected',
  MEASUREMENT_ERROR: 'measurement_error',
  MEASUREMENT_OK: 'measurement_ok',
  SENSOR_SILENT: 'sensor_silent',
  SENSOR_BACK: 'sensor_back',
  ACCESS_REFUSED: 'access_refused',
};

const SCENE_ACTIONS = { GET_TANK: 'get_tank' };

const TANK_OUTPUTS = [
  'tank_name',
  'fill_percent',
  'quantity',
  'unit',
  'days_reach',
  'empty_date',
  'daily_consumption',
  'battery_level',
  'battery_percent',
  'measurement_error',
  'measurement_error_label',
  'last_metering',
  'next_metering',
  'is_silent',
  'summary',
];
const ACCESS_REASONS = ['missing', 'refused', 'unknown_account', 'token'];
// A rise of the fill level of this many points between two measurements is a refill.
const REFILL_MIN_POINTS = 5;
// A tank whose planned measurement is this late is silent.
const SILENT_AFTER_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// The daily consumption is the average of the last 30 days of measurements.
const CONSUMPTION_SPAN_MS = 30 * DAY_MS;

/**
 * @description Keep only the declared keys of an output object.
 * @param {object} values - The values.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The outputs (null / undefined left out).
 */
function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== null && values[key] !== undefined)
      .map((key) => [key, values[key]]),
  );
}

/**
 * @description A number rounded for a scene, or null.
 * @param {number|null} value - The value.
 * @param {number} [decimals] - Decimals.
 * @returns {number|null} The value.
 */
function rounded(value, decimals = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description Whether the measurement planned by OilFox is 24 hours late.
 * @param {object} device - parseDevice() entry.
 * @param {number} now - Now (ms).
 * @returns {boolean} True when silent.
 */
const isSilent = (device, now) =>
  Number.isFinite(device?.nextMeteringAt) && now - device.nextMeteringAt > SILENT_AFTER_MS;

/**
 * @description The average consumption per day over the last 30 days: the
 * sum of the drops of the quantity between two measurements (a refill is not
 * a consumption) divided by the days covered.
 * @param {Array<number[]>} history - `[instant, %, quantity]` points, oldest first.
 * @param {number} now - Now (ms).
 * @returns {number|null} Quantity per day, null with less than 2 days of history.
 */
function dailyConsumption(history = [], now) {
  const points = history.filter(
    (point) =>
      Array.isArray(point) && Number.isFinite(point[2]) && now - point[0] <= CONSUMPTION_SPAN_MS,
  );
  if (points.length < 2) {
    return null;
  }
  const days = (points[points.length - 1][0] - points[0][0]) / DAY_MS;
  if (days < 2) {
    return null;
  }
  let used = 0;
  for (let index = 1; index < points.length; index += 1) {
    const drop = points[index - 1][2] - points[index][2];
    if (drop > 0) used += drop;
  }
  return used / days;
}

/**
 * @description The day the tank should run empty, from the estimate of OilFox.
 * @param {object} device - parseDevice() entry.
 * @returns {number|null} The instant (ms).
 */
const emptyAt = (device) =>
  Number.isFinite(device?.daysReach) && Number.isFinite(device?.meteringAt)
    ? device.meteringAt + device.daysReach * DAY_MS
    : null;

/**
 * @description The transitions of a tank since what the triggers knew.
 * @param {object} seen - What the triggers knew (never changed).
 * @param {object} device - parseDevice() entry.
 * @param {object} context - `{ now }`.
 * @returns {{ events: Array<{ key: string, extra: object }>, next: object }} The events, the new knowledge.
 */
function detectTank(seen = {}, device, { now }) {
  const first = !seen.known;
  const silent = isSilent(device, now);
  const next = {
    known: true,
    meteringAt: device.meteringAt ?? seen.meteringAt ?? null,
    percent: Number.isFinite(device.percent) ? device.percent : (seen.percent ?? null),
    quantity: Number.isFinite(device.quantity) ? device.quantity : (seen.quantity ?? null),
    error: device.error ?? null,
    silent,
  };
  const events = [];
  if (first) {
    return { events, next };
  }
  const measured =
    Number.isFinite(device.meteringAt) &&
    (!Number.isFinite(seen.meteringAt) || device.meteringAt > seen.meteringAt);
  if (measured) {
    const consumed =
      Number.isFinite(seen.quantity) && Number.isFinite(device.quantity)
        ? Math.max(0, seen.quantity - device.quantity)
        : null;
    events.push({ key: TRIGGERS.NEW_METERING, extra: { consumed } });
    if (
      Number.isFinite(seen.percent) &&
      Number.isFinite(device.percent) &&
      device.percent - seen.percent >= REFILL_MIN_POINTS
    ) {
      events.push({
        key: TRIGGERS.REFILL_DETECTED,
        extra: {
          before: seen.percent,
          added:
            Number.isFinite(seen.quantity) && Number.isFinite(device.quantity)
              ? device.quantity - seen.quantity
              : null,
        },
      });
    }
  }
  if (device.error && device.error !== seen.error) {
    events.push({ key: TRIGGERS.MEASUREMENT_ERROR, extra: {} });
  } else if (!device.error && seen.error) {
    events.push({ key: TRIGGERS.MEASUREMENT_OK, extra: { previous: seen.error } });
  }
  if (silent && !seen.silent) {
    events.push({ key: TRIGGERS.SENSOR_SILENT, extra: {} });
  } else if (!silent && seen.silent) {
    events.push({ key: TRIGGERS.SENSOR_BACK, extra: {} });
  }
  return { events, next };
}

const iso = (instant) => (Number.isFinite(instant) ? new Date(instant).toISOString() : null);

/**
 * @description The flat data of a tank event (30 keys at most, scalars only).
 * @param {object} view - `{ device, deviceId, name }` (app.js).
 * @param {object} event - `{ key, extra }`.
 * @param {object} options - `{ language, now }`.
 * @returns {object} The data.
 */
function tankEventData(view, event, { language, now }) {
  const { device } = view;
  const data = {
    tank: view.deviceId,
    tank_name: String(view.name).slice(0, 200),
    hwid: device.hwid,
  };
  switch (event.key) {
    case TRIGGERS.NEW_METERING:
      Object.assign(data, {
        fill_percent: device.percent,
        quantity: device.quantity,
        unit: device.unit,
        days_reach: device.daysReach,
        battery_level: device.battery,
        consumed: event.extra.consumed,
        metering_at: iso(device.meteringAt),
      });
      break;
    case TRIGGERS.REFILL_DETECTED:
      Object.assign(data, {
        before_percent: event.extra.before,
        after_percent: device.percent,
        added_quantity: event.extra.added,
        quantity: device.quantity,
        unit: device.unit,
      });
      break;
    case TRIGGERS.MEASUREMENT_ERROR:
      Object.assign(data, {
        error: device.error,
        error_label: errorLabel(device.error, language).slice(0, 200),
      });
      break;
    case TRIGGERS.SENSOR_SILENT:
      Object.assign(data, {
        expected_at: iso(device.nextMeteringAt),
        hours_late: Math.max(0, Math.floor((now - device.nextMeteringAt) / 3600000)),
      });
      break;
    default:
      break;
  }
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value === undefined ? null : value]),
  );
}

/**
 * @description The text of the battery level.
 * @param {string|null} level - FULL … CRITICAL.
 * @param {string} language - The language.
 * @returns {string} The text, "–" when unknown.
 */
const batteryText = (level, language) => (level ? t(`battery_${level}`, language) : '–');

export {
  TRIGGERS,
  SCENE_ACTIONS,
  TANK_OUTPUTS,
  ACCESS_REASONS,
  REFILL_MIN_POINTS,
  SILENT_AFTER_MS,
  DAY_MS,
  pick,
  rounded,
  isSilent,
  dailyConsumption,
  emptyAt,
  detectTank,
  tankEventData,
  batteryText,
  batteryPercent,
};
