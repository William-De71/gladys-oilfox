// -----------------------------------------------------------------------------
// The answers of the OilFox API made safe. A field the API leaves out stays
// null, never 0: an unknown fill level must not read as an empty tank.
//
// A device of GET /customer-api/v1/device (docs/v1/README.md):
//   hwid               string, required   the hardware id ("ON0123456789")
//   currentMeteringAt  RFC 3339, required the last measurement
//   nextMeteringAt     RFC 3339, required the next one planned
//   daysReach          int, optional      estimated days until the tank is empty
//   validationError    enum, optional     a problem of the measurement
//   batteryLevel       enum, optional     FULL, GOOD, MEDIUM, WARNING, CRITICAL
//   fillLevelPercent   int, optional      0-100
//   fillLevelQuantity  int, optional      in kg or L
//   quantityUnit       "L" or "kg", required
// The API gives no name: the device is "OilFox <hwid>" until the user renames
// it in Gladys.
// -----------------------------------------------------------------------------

const BATTERY_LEVELS = ['FULL', 'GOOD', 'MEDIUM', 'WARNING', 'CRITICAL'];
// Gladys keeps a battery as a percentage: the levels of the API mapped to a
// percentage (an approximation, said in the docs); WARNING and CRITICAL stay
// under the usual 20 % threshold of the battery alerts of Gladys.
const BATTERY_PERCENT = { FULL: 100, GOOD: 75, MEDIUM: 50, WARNING: 15, CRITICAL: 5 };
const LOW_BATTERY_LEVELS = ['WARNING', 'CRITICAL'];
const VALIDATION_ERRORS = [
  'NO_METERING',
  'EMPTY_METERING',
  'NO_EXTRACTED_VALUE',
  'SENSOR_CONFIG',
  'MISSING_STORAGE_CONFIG',
  'INVALID_STORAGE_CONFIG',
  'DISTANCE_TOO_SHORT',
  'ABOVE_STORAGE_MAX',
  'BELOW_STORAGE_MIN',
];
const UNITS = ['L', 'kg'];

/**
 * @description An instant from an RFC 3339 text.
 * @param {unknown} value - The text.
 * @returns {number|null} The instant (ms), null when unreadable.
 */
function instantOf(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * @description An integer within bounds, or null.
 * @param {unknown} value - The value.
 * @param {number} min - The lowest value.
 * @param {number} max - The highest value.
 * @returns {number|null} The integer.
 */
function integerOf(value, min, max) {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * @description The unit of the quantity: "L" or "kg" (the API is case
 * sensitive in its documentation, a "l" is read as "L").
 * @param {unknown} value - The value.
 * @returns {string} "L" or "kg", "L" when unknown.
 */
function unitOf(value) {
  const text = String(value ?? '').trim();
  if (text.toLowerCase() === 'kg') {
    return 'kg';
  }
  return 'L';
}

/**
 * @description One device of the answer.
 * @param {object} raw - The device.
 * @returns {object|null} The device, null without a hardware id.
 */
function parseDevice(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const hwid = typeof raw.hwid === 'string' ? raw.hwid.trim().slice(0, 64) : '';
  if (!hwid) {
    return null;
  }
  const battery = String(raw.batteryLevel ?? '').toUpperCase();
  const error = String(raw.validationError ?? '').toUpperCase();
  return {
    hwid,
    meteringAt: instantOf(raw.currentMeteringAt),
    nextMeteringAt: instantOf(raw.nextMeteringAt),
    daysReach: integerOf(raw.daysReach, 0, 3650),
    // An unknown code of a newer API is kept, the texts fall back to it.
    error: error ? error.slice(0, 40) : null,
    battery: BATTERY_LEVELS.includes(battery) ? battery : null,
    percent: integerOf(raw.fillLevelPercent, 0, 100),
    quantity: integerOf(raw.fillLevelQuantity, 0, 1000000),
    unit: unitOf(raw.quantityUnit),
  };
}

/**
 * @description The devices of GET /customer-api/v1/device.
 * @param {object} body - `{ items }`.
 * @returns {object[]} The devices, by hardware id, without duplicates.
 */
function parseDevices(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const byId = new Map();
  for (const raw of items) {
    const device = parseDevice(raw);
    if (device && !byId.has(device.hwid)) {
      byId.set(device.hwid, device);
    }
  }
  return [...byId.values()].sort((a, b) => a.hwid.localeCompare(b.hwid));
}

/**
 * @description The battery of a device as a percentage.
 * @param {string|null} level - FULL … CRITICAL.
 * @returns {number|null} The percentage.
 */
const batteryPercent = (level) => BATTERY_PERCENT[level] ?? null;

export {
  BATTERY_LEVELS,
  BATTERY_PERCENT,
  LOW_BATTERY_LEVELS,
  VALIDATION_ERRORS,
  UNITS,
  instantOf,
  integerOf,
  unitOf,
  parseDevice,
  parseDevices,
  batteryPercent,
};
