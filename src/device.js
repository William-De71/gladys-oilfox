// -----------------------------------------------------------------------------
// The devices of the integration, offered on the Discovery screen.
//
// One device per OilFox sensor of the account (its hardware id, which never
// changes), named "OilFox <hwid>" (the API gives no name: the user renames it
// in Gladys), read only. Category / type / unit pairs from the Gladys core
// (DEVICE_FEATURE_UNITS_BY_CATEGORY, master 2026-10-26):
//   - `fill_level`  level-sensor / liquid-level-percent, %;
//   - `quantity`    volume-sensor / integer in liters for a tank in L; for a
//                   tank in kg (pellets) counter-sensor / integer without a
//                   unit, its name says "kg": the core has no kilogram;
//   - `days_reach`  duration / integer, days: the estimate of OilFox until
//                   the tank is empty;
//   - `battery`     battery / integer, %: the level of the API mapped to a
//                   percentage (parse.js), so the battery alerts of Gladys work;
//   - `status`      text / text: "OK" or the problem of the measurement, in
//                   the language of the configuration.
// External ids: `ext:<selector>:tank:<hwid>`, the id with every character
// outside [A-Za-z0-9_-] replaced by "-". `should_poll` stays false: the
// integration reads the cloud on its own timer.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';
import { batteryPercent } from './parse.js';

const TANK_TYPE = 'tank';
const MAX_QUANTITY = 100000;
const MAX_DAYS = 3650;
const FEATURE_KEYS = ['fill_level', 'quantity', 'days_reach', 'battery', 'status'];

/**
 * @description The platform id of a hardware id, safe for an external id.
 * @param {string} value - "ON0123456789".
 * @returns {string} The id.
 */
const platformId = (value) =>
  String(value ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .slice(0, 64);

/**
 * @description The external ids of a tank.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} hwid - The hardware id.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const tankIds = (gladys, hwid) => gladys.externalIds(TANK_TYPE, platformId(hwid));

/**
 * @description The platform id of a tank device external id (or of one of its features).
 * @param {unknown} externalId - `ext:…:tank:ON0123456789` (or `…:fill_level`).
 * @returns {string|null} The platform id.
 */
function tankOfExternalId(externalId) {
  const match = String(externalId ?? '').match(/:tank:([A-Za-z0-9_-]+)(?::[a-z_]+)?$/);
  return match ? match[1] : null;
}

/**
 * @description The default name of a tank.
 * @param {object} device - parseDevice() entry.
 * @returns {string} "OilFox ON0123456789".
 */
const defaultName = (device) => `OilFox ${device?.hwid ?? ''}`.trim();

/**
 * @description The features of a tank.
 * @param {object} device - parseDevice() entry.
 * @returns {object[]} `{ key, category, type, unit, min, max }`.
 */
function featuresOf(device) {
  const quantity =
    device.unit === 'kg'
      ? { category: C.COUNTER_SENSOR, type: T.SENSOR.INTEGER, unit: null }
      : { category: C.VOLUME_SENSOR, type: T.VOLUME_SENSOR.INTEGER, unit: U.LITER };
  return [
    {
      key: 'fill_level',
      category: C.LEVEL_SENSOR,
      type: T.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: U.PERCENT,
      min: 0,
      max: 100,
    },
    { key: 'quantity', ...quantity, min: 0, max: MAX_QUANTITY },
    {
      key: 'days_reach',
      category: C.DURATION,
      type: T.DURATION.INTEGER,
      unit: U.DAYS,
      min: 0,
      max: MAX_DAYS,
    },
    {
      key: 'battery',
      category: C.BATTERY,
      type: T.BATTERY.INTEGER,
      unit: U.PERCENT,
      min: 0,
      max: 100,
    },
    { key: 'status', category: C.TEXT, type: T.TEXT.TEXT, unit: null, min: 0, max: 0 },
  ];
}

/**
 * @description Build the device of a tank.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} device - parseDevice() entry.
 * @param {object} [options] - `{ language }`.
 * @returns {object} The discovered device.
 */
function buildTankDevice(gladys, device, { language = 'en' } = {}) {
  const ids = tankIds(gladys, device.hwid);
  return {
    name: defaultName(device),
    external_id: ids.device,
    model: 'OilFox',
    should_poll: false,
    params: [{ name: 'OILFOX_HWID', value: device.hwid }],
    features: featuresOf(device).map((feature) => ({
      name: t(
        feature.key === 'quantity' && device.unit === 'kg'
          ? 'feature_quantity_kg'
          : `feature_${feature.key}`,
        language,
      ),
      external_id: ids.feature(feature.key),
      category: feature.category,
      type: feature.type,
      unit: feature.unit,
      min: feature.min,
      max: feature.max,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    })),
  };
}

/**
 * @description The text of the measurement state.
 * @param {object} device - parseDevice() entry.
 * @param {string} language - The language.
 * @returns {string} "OK", or the problem.
 */
function statusText(device, language) {
  if (device.error) {
    return errorLabel(device.error, language);
  }
  return t(device.meteringAt ? 'statusMeasureOk' : 'error_NO_METERING', language);
}

/**
 * @description The label of a measurement problem (its code when unknown).
 * @param {string} code - The validationError of the API.
 * @param {string} language - The language.
 * @returns {string} The label.
 */
function errorLabel(code, language) {
  const key = `error_${code}`;
  const text = t(key, language);
  return text === key ? code : text;
}

/**
 * @description The states of a tank: a value the API leaves out is left untouched.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} device - parseDevice() entry.
 * @param {object} [options] - `{ language }`.
 * @returns {object[]} `{ device_feature_external_id, state | text }`.
 */
function buildTankStates(gladys, device, { language = 'en' } = {}) {
  const ids = tankIds(gladys, device.hwid);
  const states = [];
  const number = (key, value, max) => {
    if (Number.isFinite(value)) {
      states.push({ device_feature_external_id: ids.feature(key), state: Math.min(max, value) });
    }
  };
  // A measurement in error usually comes without a level (documentation
  // example): what is absent is not published, the last value stays.
  number('fill_level', device.percent, 100);
  number('quantity', device.quantity, MAX_QUANTITY);
  number('days_reach', device.daysReach, MAX_DAYS);
  number('battery', batteryPercent(device.battery), 100);
  states.push({
    device_feature_external_id: ids.feature('status'),
    text: statusText(device, language).slice(0, 200),
  });
  return states;
}

export {
  TANK_TYPE,
  FEATURE_KEYS,
  MAX_QUANTITY,
  MAX_DAYS,
  platformId,
  tankIds,
  tankOfExternalId,
  defaultName,
  featuresOf,
  buildTankDevice,
  statusText,
  errorLabel,
  buildTankStates,
};
