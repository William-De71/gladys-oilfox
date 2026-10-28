// -----------------------------------------------------------------------------
// Texts of the OilFox integration, in English, French, German and Spanish
// (English fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: feature names and the measurement state, widget contents, scene
// texts, errors, results of the configuration buttons. Vocabulary of the
// Gladys interface (appareil / Gerät / dispositivo, cuve / Tank / depósito).
// German says "du", Spanish "usted", like Gladys.
// -----------------------------------------------------------------------------

const TEXTS = {
  // features (names shown by the dashboard when several share a type)
  feature_fill_level: {
    en: 'Fill level',
    fr: 'Niveau de remplissage',
    de: 'Füllstand',
    es: 'Nivel de llenado',
  },
  feature_quantity: { en: 'Quantity', fr: 'Quantité', de: 'Menge', es: 'Cantidad' },
  feature_quantity_kg: {
    en: 'Quantity (kg)',
    fr: 'Quantité (kg)',
    de: 'Menge (kg)',
    es: 'Cantidad (kg)',
  },
  feature_days_reach: {
    en: 'Days of reach',
    fr: 'Autonomie',
    de: 'Reichweite',
    es: 'Autonomía',
  },
  feature_battery: { en: 'Battery', fr: 'Pile', de: 'Batterie', es: 'Pila' },
  feature_status: {
    en: 'Measurement state',
    fr: 'État de la mesure',
    de: 'Messstatus',
    es: 'Estado de la medición',
  },
  statusMeasureOk: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },

  // validationError of the API (docs/v1/README.md)
  error_NO_METERING: {
    en: 'No measurement yet',
    fr: 'Pas encore de mesure',
    de: 'Noch keine Messung',
    es: 'Todavía sin medición',
  },
  error_EMPTY_METERING: {
    en: 'Incorrect measurement',
    fr: 'Mesure incorrecte',
    de: 'Fehlerhafte Messung',
    es: 'Medición incorrecta',
  },
  error_NO_EXTRACTED_VALUE: {
    en: 'No fill level detected',
    fr: 'Aucun niveau détecté',
    de: 'Kein Füllstand erkannt',
    es: 'Ningún nivel detectado',
  },
  error_SENSOR_CONFIG: {
    en: 'Faulty measurement',
    fr: 'Mesure défectueuse',
    de: 'Fehlerhafte Messung (Sensor)',
    es: 'Medición defectuosa',
  },
  error_MISSING_STORAGE_CONFIG: {
    en: 'Tank settings missing',
    fr: 'Réglages de la cuve manquants',
    de: 'Tankeinstellungen fehlen',
    es: 'Faltan los ajustes del depósito',
  },
  error_INVALID_STORAGE_CONFIG: {
    en: 'Incorrect tank settings',
    fr: 'Réglages de la cuve incorrects',
    de: 'Falsche Tankeinstellungen',
    es: 'Ajustes del depósito incorrectos',
  },
  error_DISTANCE_TOO_SHORT: {
    en: 'Measured distance too small',
    fr: 'Distance mesurée trop courte',
    de: 'Gemessener Abstand zu klein',
    es: 'Distancia medida demasiado corta',
  },
  error_ABOVE_STORAGE_MAX: {
    en: 'Tank full (above its maximum)',
    fr: 'Cuve pleine (au-dessus du maximum)',
    de: 'Tank voll (über dem Maximum)',
    es: 'Depósito lleno (por encima del máximo)',
  },
  error_BELOW_STORAGE_MIN: {
    en: 'Implausible fill level',
    fr: 'Niveau calculé peu plausible',
    de: 'Unplausibler Füllstand',
    es: 'Nivel calculado poco plausible',
  },

  // battery levels of the API
  battery_FULL: { en: 'Full', fr: 'Pleine', de: 'Voll', es: 'Llena' },
  battery_GOOD: { en: 'Good', fr: 'Bonne', de: 'Gut', es: 'Buena' },
  battery_MEDIUM: { en: 'Medium', fr: 'Moyenne', de: 'Mittel', es: 'Media' },
  battery_WARNING: { en: 'Low', fr: 'Faible', de: 'Schwach', es: 'Baja' },
  battery_CRITICAL: { en: 'Critical', fr: 'Critique', de: 'Kritisch', es: 'Crítica' },

  // relative times
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: { en: '{n} min ago', fr: 'il y a {n} min', de: 'vor {n} Min.', es: 'hace {n} min' },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} d ago', fr: 'il y a {n} j', de: 'vor {n} T.', es: 'hace {n} d' },

  // widgets
  badgeError: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  badgeSilent: { en: 'Late', fr: 'En retard', de: 'Verspätet', es: 'Con retraso' },
  badgeBattery: { en: 'Battery', fr: 'Pile', de: 'Batterie', es: 'Pila' },
  badgeOk: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  daysShort: { en: '{n} days', fr: '{n} jours', de: '{n} Tage', es: '{n} días' },
  unitDays: { en: 'days', fr: 'jours', de: 'Tage', es: 'días' },
  widgetMore: {
    en: 'And {count} more tank(s).',
    fr: 'Et {count} autre(s) cuve(s).',
    de: 'Und {count} weitere(r) Tank(s).',
    es: 'Y {count} depósito(s) más.',
  },
  tileFill: { en: 'Fill level', fr: 'Remplissage', de: 'Füllstand', es: 'Llenado' },
  tileQuantity: { en: 'Quantity', fr: 'Quantité', de: 'Menge', es: 'Cantidad' },
  tileReach: { en: 'Reach', fr: 'Autonomie', de: 'Reichweite', es: 'Autonomía' },
  tileBattery: { en: 'Battery', fr: 'Pile', de: 'Batterie', es: 'Pila' },
  chartTitle: {
    en: 'Fill level, last 90 days',
    fr: 'Remplissage sur 90 jours',
    de: 'Füllstand, letzte 90 Tage',
    es: 'Llenado, últimos 90 días',
  },
  rowState: { en: 'Measurement', fr: 'Mesure', de: 'Messung', es: 'Medición' },
  rowLastMetering: {
    en: 'Last measurement',
    fr: 'Dernière mesure',
    de: 'Letzte Messung',
    es: 'Última medición',
  },
  rowNextMetering: {
    en: 'Next measurement',
    fr: 'Prochaine mesure',
    de: 'Nächste Messung',
    es: 'Próxima medición',
  },
  rowAgo: {
    en: '{time} ({ago})',
    fr: '{time} ({ago})',
    de: '{time} ({ago})',
    es: '{time} ({ago})',
  },
  rowEmpty: {
    en: 'Empty around',
    fr: 'Vide vers le',
    de: 'Leer etwa am',
    es: 'Vacío hacia el',
  },
  rowPerDay: {
    en: 'Use, 30-day average',
    fr: 'Conso. moyenne 30 j',
    de: 'Verbrauch, Ø 30 Tage',
    es: 'Consumo medio 30 d',
  },
  perDay: {
    en: '{value} {unit} / day',
    fr: '{value} {unit} / jour',
    de: '{value} {unit} / Tag',
    es: '{value} {unit} / día',
  },

  // status
  statusNoCredentials: {
    en: 'Enter the e-mail address and the password of your OilFox account (FoxMobile app).',
    fr: 'Saisissez l’adresse e-mail et le mot de passe de votre compte OilFox (application FoxMobile).',
    de: 'Gib die E-Mail-Adresse und das Passwort deines OilFox-Kontos (FoxMobile-App) ein.',
    es: 'Introduzca la dirección de correo y la contraseña de su cuenta OilFox (aplicación FoxMobile).',
  },
  statusWaiting: {
    en: 'Reading the OilFox account…',
    fr: 'Lecture du compte OilFox…',
    de: 'OilFox-Konto wird gelesen…',
    es: 'Leyendo la cuenta OilFox…',
  },
  statusNoTank: {
    en: 'No OilFox sensor in this account.',
    fr: 'Aucun capteur OilFox dans ce compte.',
    de: 'Kein OilFox-Sensor in diesem Konto.',
    es: 'Ningún sensor OilFox en esta cuenta.',
  },
  statusOk: {
    en: 'Connected: {tanks} OilFox sensor(s), read every hour.',
    fr: 'Connecté : {tanks} capteur(s) OilFox, lus toutes les heures.',
    de: 'Verbunden: {tanks} OilFox-Sensor(en), stündlich gelesen.',
    es: 'Conectado: {tanks} sensor(es) OilFox, leídos cada hora.',
  },
  statusPaused: {
    en: 'OilFox answers with errors: paused for a while.',
    fr: 'OilFox répond en erreur : pause pendant un moment.',
    de: 'OilFox antwortet mit Fehlern: kurze Pause.',
    es: 'OilFox responde con errores: pausa durante un rato.',
  },

  // errors
  errRefused: {
    en: 'OilFox refused the sign-in: check the e-mail and the password of the FoxMobile app.',
    fr: 'OilFox a refusé la connexion : vérifiez l’e-mail et le mot de passe de l’application FoxMobile.',
    de: 'OilFox hat die Anmeldung abgelehnt: Prüfe E-Mail und Passwort der FoxMobile-App.',
    es: 'OilFox rechazó el inicio de sesión: compruebe el correo y la contraseña de la aplicación FoxMobile.',
  },
  errUnknownAccount: {
    en: 'OilFox knows no account with this e-mail address.',
    fr: 'OilFox ne connaît aucun compte avec cette adresse e-mail.',
    de: 'OilFox kennt kein Konto mit dieser E-Mail-Adresse.',
    es: 'OilFox no conoce ninguna cuenta con esta dirección de correo.',
  },
  errToken: {
    en: 'OilFox refused the access token after a new sign-in.',
    fr: 'OilFox a refusé le jeton d’accès après une nouvelle connexion.',
    de: 'OilFox hat das Zugriffstoken nach einer neuen Anmeldung abgelehnt.',
    es: 'OilFox rechazó el token de acceso tras un nuevo inicio de sesión.',
  },
  errPaused: {
    en: 'OilFox asked to wait or answered with errors: the readings resume later.',
    fr: 'OilFox a demandé d’attendre ou répond en erreur : les lectures reprennent plus tard.',
    de: 'OilFox bat zu warten oder antwortete mit Fehlern: Die Abfragen laufen später weiter.',
    es: 'OilFox pidió esperar o responde con errores: las lecturas se reanudan más tarde.',
  },
  errServer: {
    en: 'The OilFox service answers with an error: it will be tried again.',
    fr: 'Le service OilFox répond en erreur : nouvel essai plus tard.',
    de: 'Der OilFox-Dienst antwortet mit einem Fehler: Es wird erneut versucht.',
    es: 'El servicio OilFox responde con un error: se volverá a intentar.',
  },
  errUnreachable: {
    en: 'OilFox cannot be reached: check the Internet access of Gladys.',
    fr: 'OilFox est injoignable : vérifiez l’accès à Internet de Gladys.',
    de: 'OilFox ist nicht erreichbar: Prüfe den Internetzugang von Gladys.',
    es: 'No se puede acceder a OilFox: compruebe el acceso a Internet de Gladys.',
  },
  errFailed: {
    en: 'OilFox reading failed: {detail}',
    fr: 'Échec de la lecture OilFox : {detail}',
    de: 'OilFox-Abfrage fehlgeschlagen: {detail}',
    es: 'Error de lectura de OilFox: {detail}',
  },
  errNoTank: {
    en: 'No OilFox sensor read yet.',
    fr: 'Aucun capteur OilFox lu pour l’instant.',
    de: 'Noch kein OilFox-Sensor gelesen.',
    es: 'Todavía no se ha leído ningún sensor OilFox.',
  },

  // scene texts
  summaryTank: {
    en: '{name}: {percent} % ({quantity}), about {days} days of reach.',
    fr: '{name} : {percent} % ({quantity}), environ {days} jours d’autonomie.',
    de: '{name}: {percent} % ({quantity}), etwa {days} Tage Reichweite.',
    es: '{name}: {percent} % ({quantity}), unos {days} días de autonomía.',
  },
  summaryError: {
    en: 'Measurement: {error}.',
    fr: 'Mesure : {error}.',
    de: 'Messung: {error}.',
    es: 'Medición: {error}.',
  },
  summarySilent: {
    en: 'The planned measurement is late.',
    fr: 'La mesure prévue est en retard.',
    de: 'Die geplante Messung ist verspätet.',
    es: 'La medición prevista lleva retraso.',
  },

  // configuration buttons
  testOk: {
    en: 'Connected to OilFox: {count} sensor(s){names}.',
    fr: 'Connecté à OilFox : {count} capteur(s){names}.',
    de: 'Mit OilFox verbunden: {count} Sensor(en){names}.',
    es: 'Conectado a OilFox: {count} sensor(es){names}.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration ({count} line(s), no password, no token).',
    fr: 'Diagnostic écrit dans les journaux de l’intégration ({count} ligne(s), sans mot de passe ni jeton).',
    de: 'Diagnose in die Logs der Integration geschrieben ({count} Zeile(n), ohne Passwort und Token).',
    es: 'Diagnóstico escrito en los registros de la integración ({count} línea(s), sin contraseña ni token).',
  },
};

export { TEXTS };
