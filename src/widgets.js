// -----------------------------------------------------------------------------
// Dashboard widgets of the OilFox integration.
//
//   - `overview`  every tank at a glance: a gauge of the fill level per tank
//                 (6 at most), then one card per tank (the problems first)
//                 with its quantity, its days of reach and the age of its
//                 last measurement;
//   - `tank`      one tank (an OilFox device, the first one by default): fill
//                 level, quantity, days of reach, battery, the fill level of
//                 the last 90 days from the points the integration keeps (no
//                 extra request), the measurements, the estimated empty day
//                 and the consumption per day.
// Every text exists in the four languages (the content is cached per
// language). Content budget of a card: 8 components, 1 main one, 6 tiles,
// 2 texts (1 body), 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { t, ago, formatNumber } from './i18n.js';
import { formatTime } from './time.js';
import { LOW_BATTERY_LEVELS } from './parse.js';
import { statusText } from './device.js';
import { batteryText, dailyConsumption, emptyAt, DAY_MS } from './events.js';

const WIDGETS = { OVERVIEW: 'overview', TANK: 'tank' };
const TTL_SECONDS = { overview: 300, tank: 300, message: 120 };
const MAX_GAUGES = 6;
const MAX_CARDS = 8;
const CHART_SPAN_MS = 90 * DAY_MS;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description A quantity as text: "1 643 L".
 * @param {number|null} value - The quantity.
 * @param {string} unit - "L" or "kg".
 * @param {string} language - The language.
 * @returns {string} The text, "–" when unknown.
 */
function quantityText(value, unit, language) {
  return Number.isFinite(value) ? `${formatNumber(value, language, 0)} ${unit}` : '–';
}

/**
 * @description The color of a fill level.
 * @param {number|null} percent - The fill level.
 * @returns {string} A semantic color.
 */
function levelColor(percent) {
  if (!Number.isFinite(percent)) return WIDGET_COLORS.NEUTRAL;
  if (percent <= 15) return WIDGET_COLORS.DANGER;
  if (percent <= 30) return WIDGET_COLORS.WARNING;
  return WIDGET_COLORS.SUCCESS;
}

/**
 * @description How urgent a tank is, for the order of the cards.
 * @param {object} view - The view of the tank (app.js).
 * @returns {number} 3 problem, 2 silent, 1 low battery, 0 fine.
 */
function urgency(view) {
  if (view.device.error) return 3;
  if (view.silent) return 2;
  if (LOW_BATTERY_LEVELS.includes(view.device.battery)) return 1;
  return 0;
}

/**
 * @description The badge of a tank.
 * @param {object} view - The view of the tank.
 * @param {string} language - The language.
 * @returns {{ text: string, color: string }} The badge.
 */
function badgeOf(view, language) {
  if (view.device.error) return { text: t('badgeError', language), color: WIDGET_COLORS.DANGER };
  if (view.silent) return { text: t('badgeSilent', language), color: WIDGET_COLORS.WARNING };
  if (LOW_BATTERY_LEVELS.includes(view.device.battery)) {
    return { text: t('badgeBattery', language), color: WIDGET_COLORS.WARNING };
  }
  return { text: t('badgeOk', language), color: WIDGET_COLORS.SUCCESS };
}

/**
 * @description The card of a tank.
 * @param {object} view - The view of the tank.
 * @param {object} options - `{ language, now }`.
 * @returns {object} A card-list item.
 */
function tankCard(view, { language, now }) {
  const { device } = view;
  const parts = [
    quantityText(device.quantity, device.unit, language),
    Number.isFinite(device.daysReach) ? t('daysShort', language, { n: device.daysReach }) : null,
    device.meteringAt ? ago(device.meteringAt, now, language) : t('never', language),
  ].filter(Boolean);
  const badge = badgeOf(view, language);
  const card = {
    title: clip(view.name, 60),
    subtitle: clip(parts.join(' · '), 60),
    badge: { text: clip(badge.text, 16), color: badge.color },
  };
  if (device.error) {
    card.description = clip(statusText(device, language), 2000);
  }
  return card;
}

/**
 * @description The "overview" widget.
 * @param {object} options - Options.
 * @param {object[]} options.views - The views of the tanks (app.js).
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildOverviewWidget({ views, language, now }) {
  // A tank without a known level gets no gauge: a 0 % would read as empty.
  const components = views
    .filter((view) => Number.isFinite(view.device.percent))
    .slice(0, MAX_GAUGES)
    .map((view) => ({
      type: 'gauge',
      label: clip(view.name, 24),
      value: view.device.percent,
      min: 0,
      max: 100,
      unit: '%',
      color: levelColor(view.device.percent),
    }));
  const sorted = [...views].sort(
    (a, b) => urgency(b) - urgency(a) || a.name.localeCompare(b.name, language),
  );
  if (sorted.length) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: sorted.slice(0, MAX_CARDS).map((view) => tankCard(view, { language, now })),
    });
  }
  if (sorted.length > MAX_CARDS) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(t('widgetMore', language, { count: sorted.length - MAX_CARDS }), 80),
    });
  }
  return { ttl_seconds: TTL_SECONDS.overview, components };
}

/**
 * @description A day as text in the language and timezone of the user.
 * @param {number} instant - The instant (ms).
 * @param {object} options - `{ language, timeZone }`.
 * @returns {string} "12 janv. 2027".
 */
function dayText(instant, { language, timeZone }) {
  const locale = language === 'en' ? 'en-GB' : language;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(instant));
}

/**
 * @description The "tank" widget.
 * @param {object} options - Options.
 * @param {object} options.view - The view of the tank (app.js).
 * @param {Array<number[]>} options.history - `[instant, %, quantity]` points.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} options.timeZone - The timezone of Gladys.
 * @returns {object} The content.
 */
function buildTankWidget({ view, history, language, now, timeZone }) {
  const { device } = view;
  const lowBattery = LOW_BATTERY_LEVELS.includes(device.battery);
  const components = [
    { type: 'text', variant: 'heading', text: clip(view.name, 40) },
    Number.isFinite(device.percent)
      ? {
          type: 'gauge',
          label: clip(t('tileFill', language), 24),
          value: device.percent,
          min: 0,
          max: 100,
          unit: '%',
          color: levelColor(device.percent),
        }
      : {
          type: 'value',
          label: clip(t('tileFill', language), 24),
          value: '–',
          icon: 'droplet',
          color: WIDGET_COLORS.NEUTRAL,
        },
    {
      type: 'value',
      label: clip(t('tileQuantity', language), 24),
      value: Number.isFinite(device.quantity) ? formatNumber(device.quantity, language, 0) : '–',
      ...(Number.isFinite(device.quantity) ? { unit: device.unit } : {}),
      icon: 'database',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      label: clip(t('tileReach', language), 24),
      value: Number.isFinite(device.daysReach) ? device.daysReach : '–',
      ...(Number.isFinite(device.daysReach) ? { unit: t('unitDays', language) } : {}),
      icon: 'calendar',
      color:
        Number.isFinite(device.daysReach) && device.daysReach <= 30
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.INFO,
    },
    {
      type: 'value',
      label: clip(t('tileBattery', language), 24),
      value: clip(batteryText(device.battery, language), 12),
      icon: lowBattery ? 'battery' : 'battery-charging',
      color: lowBattery ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
  ];
  const points = history
    .filter((point) => Array.isArray(point) && now - point[0] <= CHART_SPAN_MS)
    .filter((point) => Number.isFinite(point[1]));
  if (points.length >= 2) {
    components.push({
      type: 'chart',
      chart_type: 'area',
      title: clip(t('chartTitle', language), 60),
      unit: '%',
      series: [
        {
          name: t('tileFill', language),
          points: points.slice(-300).map((point) => ({
            t: new Date(point[0]).toISOString(),
            v: point[1],
          })),
        },
      ],
    });
  }
  const rows = [
    {
      label: clip(t('rowState', language), 40),
      value: clip(statusText(device, language), 40),
      color: device.error ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      label: clip(t('rowLastMetering', language), 40),
      value: device.meteringAt
        ? clip(
            t('rowAgo', language, {
              time: formatTime(device.meteringAt, { language, timeZone, now }),
              ago: ago(device.meteringAt, now, language),
            }),
            40,
          )
        : clip(t('never', language), 40),
      color: view.silent ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
  ];
  if (Number.isFinite(device.nextMeteringAt)) {
    rows.push({
      label: clip(t('rowNextMetering', language), 40),
      value: clip(formatTime(device.nextMeteringAt, { language, timeZone, now }), 40),
      color: view.silent ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  const empty = emptyAt(device);
  if (empty) {
    rows.push({
      label: clip(t('rowEmpty', language), 40),
      value: clip(dayText(empty, { language, timeZone }), 40),
      color: device.daysReach <= 30 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.INFO,
    });
  }
  const perDay = dailyConsumption(history, now);
  if (Number.isFinite(perDay)) {
    rows.push({
      label: clip(t('rowPerDay', language), 40),
      value: clip(
        t('perDay', language, { value: formatNumber(perDay, language, 1), unit: device.unit }),
        40,
      ),
      color: WIDGET_COLORS.INFO,
    });
  }
  components.push({ type: 'status', items: rows.slice(0, 10) });
  return { ttl_seconds: TTL_SECONDS.tank, components };
}

export {
  WIDGETS,
  TTL_SECONDS,
  MAX_GAUGES,
  MAX_CARDS,
  clip,
  messageContent,
  quantityText,
  levelColor,
  dayText,
  buildOverviewWidget,
  buildTankWidget,
};
