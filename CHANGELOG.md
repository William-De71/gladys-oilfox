# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- **tanks:** every OilFox sensor of an account (FoxMobile app), through the official FoxInsights Customer API with the e-mail address and the password of the account, read only; one reading an hour (the fair use of FoxInsights), plus one 15 minutes after each measurement OilFox planned
- **devices:** one device per OilFox sensor: fill level, quantity (liters, or kg for pellets), days of reach, battery and measurement state
- **scenes:** triggers on a new measurement, a refill, a measurement problem and its end, a measurement 24 hours late and its return, and a refused account; an action to read the values of a tank, its estimated empty day and its use per day
- **widgets:** every tank at a glance with a gauge per tank and the problems first; one tank with its fill level, quantity, reach, battery, 90 days of level, empty day and use per day
- **configuration:** e-mail address and password with a guide, language, "Test the connection" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-oilfox/releases/tag/v0.1.0
