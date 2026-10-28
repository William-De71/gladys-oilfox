# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **OilFox** tank sensors
(FoxInsights GmbH: an ultrasonic Wi-Fi sensor on a heating-oil tank, a pellet
silo…): a Node.js service (Node 22+, ESM, no build step) in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the official FoxInsights Customer API
(<https://github.com/foxinsights/customer-api>, `docs/v1/README.md` and
`docs/v1/swagger.yml`, base `https://api.oilfox.io`) with the e-mail address and
the password of the user's FoxMobile account. **Read only.** `type: "device"`,
Gladys 5.3.0+, `transports: ["cloud"]`. Not affiliated with FoxInsights. The
example code of that repository is under the SSPL: none of it is used, only the
documented facts.

**Never tested with a real account**: the shapes come from the documentation.
Checked live on 2026-10-28: `login` answers 404 `GENERIC__NOT_FOUND` for an
unknown account and 400 `GENERIC__BAD_REQUEST` for a missing field; `token` 401
`GENERIC__UNAUTHORIZED` for an invalid refresh token; `device` 401 (an HTML page)
for a wrong Bearer, and **200 `{"items":[]}` without any Authorization header**.

## Commands

```bash
npm install
npm test                                  # node --test; a fake OilFox (in-memory fetch, fake clock)
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                 SDK wiring only (new GladysIntegration + createApp)
src/app.js               every handler; the timer (when a reading is due), devices and states,
                         scene events, the scene action, widgets, configuration buttons, status
src/oilfox-api.js        HTTP client: login (JSON), the 15-minute access token renewed with the
                         single-use refresh token (form), one new sign-in for a refused token,
                         requests 2 s apart, pauses after 429 / 5xx / no answer
src/parse.js             the answers made safe (absent is null, never 0), battery levels
src/device.js            one device per OilFox sensor, features and states
src/events.js            triggers (measurement, refill, problem, late), outputs, daily use
src/widgets.js           overview, one tank
src/time.js              local times (Intl only)
src/store.js             /data/oilfox.json (mode 0600; never the password, the e-mail nor a token)
src/config.js            e-mail, password, language
src/i18n.js              helpers; src/i18n-texts.js the runtime texts, en / fr / de / es
test/helpers/fake-oilfox.js   the fake OilFox (login, tokens, refusals, devices)
test/fixtures/account.json    a made-up account on the documented shapes
.github/scripts/release.mjs   version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store:
  `ext:<selector>:tank:<hwid>` (the hardware id, every character outside
  `[A-Za-z0-9_-]` replaced by `-`), features `…:<key>` (`fill_level`,
  `quantity`, `days_reach`, `battery`, `status`); feature `category` / `type` /
  `unit` / `min` / `max`, the keys of `config_schema` and `actions`,
  `last_language`, widgets and settings, triggers (fields, options, variables),
  the scene action (fields, outputs). `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update it to make a test pass
  without a documented migration.
- **Category pairs**: level-sensor / liquid-level-percent (%), volume-sensor /
  integer (liter) for a tank in L, counter-sensor / integer without a unit for a
  tank in kg (the core has no kilogram: the feature name says "kg"), duration /
  integer (days), battery / integer (%, the levels of the API mapped:
  FULL 100, GOOD 75, MEDIUM 50, WARNING 15, CRITICAL 5), text / text for the
  measurement state.
- **The pace (fair use of FoxInsights: one reading an hour).** A 1-minute timer
  asks `isDue()`: a reading an hour, one more 15 minutes after a measurement
  OilFox planned (`nextMeteringAt`, once, 15 minutes at least after the
  previous reading), a retry 15 minutes after a failure, an hour after a refused
  account. A 429 pauses every request an hour. The scene action never sends a
  request.
- **Never a data request without the Bearer**: without it the API answers an
  empty list that would read as an account without sensors.
- **Freshness**: a sensor whose planned measurement is 24 hours late is late
  (trigger, widgets); its values are not re-sent, so Gladys shows them
  outdated. A fresh sensor's unchanged values are re-sent every 6 hours
  (`publishChangedStates` heartbeat). A value the API leaves out is not
  published: the last one stays.
- **`should_poll` stays false**: the integration has its own timer.
- **Credentials**: the password is a `secret`, never logged, never in /data,
  sent to api.oilfox.io only. The tokens stay in memory, never logged. Test
  credentials never look real (`not-a-real-password`): the push protection of
  GitHub would block them.
- **Scene events** once per transition, never at the first reading, never
  from a scene action: the detection runs on the timer only (`detectEvents`).
  A refill is a rise of 5 points of the fill level between two measurements.
- **Names**: the API gives none; a device is offered as "OilFox <hwid>", and
  the widgets and scenes use the name the user gave it in Gladys
  (`getDevices`, refreshed on create / update / delete).
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n-texts.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted".
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- The refresh token is single use: the client forgets it as soon as it sends
  it, whatever the answer, and signs in again when it is refused.
- A measurement with a `validationError` usually comes without
  `fillLevelPercent` / `fillLevelQuantity` / `daysReach` (documentation
  example); `MISSING_STORAGE_CONFIG` means the tank is not set up in FoxMobile.
- An OilFox measures about once a day: the hourly readings mostly bring
  nothing new, which is expected.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
