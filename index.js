// -----------------------------------------------------------------------------
// Entry point of the OilFox external integration.
//
// The OilFox tank sensors of an account (FoxMobile app), through the official
// FoxInsights Customer API (https://api.oilfox.io), with the e-mail address and
// the password of the account, read only:
//   - devices: one per OilFox sensor (fill level, quantity, days of reach,
//     battery, measurement state), offered on the Discovery screen
//     (src/device.js);
//   - scene triggers: new measurement, refill detected, measurement problem
//     and its end, sensor late and back, access refused;
//   - scene action: values of a tank;
//   - dashboard widgets: overview, one tank.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the times shown by the widgets)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the OilFox integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
