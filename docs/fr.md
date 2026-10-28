# OilFox

## Présentation

Cette intégration amène dans Gladys les capteurs **OilFox** de votre compte. Un OilFox (de FoxInsights GmbH) est un capteur Wi-Fi à ultrasons posé sur le dessus d’une cuve : fioul, mais aussi granulés (en kg), gazole… L’intégration lit son niveau de remplissage, la quantité restante, l’autonomie en jours et la pile via l’[API client officielle de FoxInsights](https://github.com/foxinsights/customer-api), avec l’adresse e-mail et le mot de passe de votre application **FoxMobile**. Elle ne fait que lire. Elle n’est pas affiliée à FoxInsights.

- Un appareil par capteur OilFox : niveau de remplissage, quantité, autonomie, pile et état de la mesure.
- Deux widgets de tableau de bord : toutes les cuves d’un coup d’œil, les problèmes d’abord ; une cuve avec son niveau sur les 90 derniers jours, la date estimée où elle sera vide et la consommation par jour.
- Déclencheurs de scène : nouvelle mesure, remplissage détecté, problème de mesure, mesure de nouveau correcte, mesure en retard, mesures de retour, accès refusé.
- Action de scène : les valeurs d’une cuve (niveau, quantité, date où elle sera vide, consommation par jour, une phrase…).

Transport : cloud. L’adresse e-mail et le mot de passe partent chez OilFox (`api.oilfox.io`) pour la connexion ; les mesures de vos cuves viennent du cloud OilFox, qui les reçoit du capteur en Wi-Fi.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Un capteur OilFox installé dans l’application FoxMobile, avec sa cuve (forme et dimensions) : sans elles, OilFox ne donne aucun niveau (« Réglages de la cuve manquants »).
- L’adresse e-mail et le mot de passe du compte FoxMobile. Seuls vos propres capteurs peuvent être lus : la politique d’usage raisonnable de FoxInsights interdit de surveiller les appareils d’autres personnes.

Fraîcheur des données : un OilFox mesure sa cuve **environ une fois par jour**. FoxInsights considère une lecture par heure comme un usage raisonnable (au-delà, il répond HTTP 429). L’intégration lit le compte **une fois par heure**, plus une fois 15 minutes après chaque mesure prévue par OilFox (toujours au moins 15 minutes après la lecture précédente) : un nouveau niveau arrive vite, sans en demander plus.

## Configuration

| Champ             | Signification                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Adresse e-mail    | L’e-mail de votre compte FoxMobile                                                                                                             |
| Mot de passe      | Son mot de passe (un secret : jamais réaffiché, jamais écrit dans les journaux ni dans `/data`)                                                |
| Langue des textes | Noms des fonctionnalités, état de la mesure, textes des scènes et erreurs ; automatique suit la langue du dernier widget affiché (en/fr/de/es) |

Boutons :

- **Tester la connexion** se connecte à OilFox, lit les capteurs et liste leurs identifiants matériels.
- **Diagnostic** écrit l’état de l’intégration dans ses journaux, sans le mot de passe, ni le jeton, ni l’adresse e-mail.

Le jeton d’accès (valable 15 minutes) est renouvelé avec un jeton de rafraîchissement à usage unique. Les deux restent en mémoire : après un redémarrage, l’intégration se reconnecte.

## Utilisation

### Appareils

Après la configuration, ouvrez **Découverte** : chaque capteur OilFox est proposé sous le nom « OilFox <identifiant matériel> » (l’API ne donne pas de nom). Ajoutez-le, puis renommez-le dans Gladys (« Cuve à fioul », « Silo à granulés »…) : les widgets et les scènes utilisent le nom que vous lui donnez.

| Fonctionnalité        | Catégorie / type                          | Unité |
| --------------------- | ----------------------------------------- | ----- |
| Niveau de remplissage | `level-sensor` / `liquid-level-percent`   | %     |
| Quantité              | `volume-sensor` / `integer`               | L     |
| Quantité (kg)         | `counter-sensor` / `integer` (cuve en kg) | —     |
| Autonomie             | `duration` / `integer`                    | jours |
| Pile                  | `battery` / `integer`                     | %     |
| État de la mesure     | `text` / `text`                           | —     |

Toutes les fonctionnalités sont en lecture seule et gardent leur historique. Pour une cuve en kg (granulés), la quantité est un compteur sans unité nommé « Quantité (kg) » : Gladys n’a pas d’unité kilogramme. L’autonomie est l’estimation d’OilFox du nombre de jours avant que la cuve soit vide. OilFox donne la pile sous forme de niveau : l’intégration le traduit en pourcentage **approximatif** (Pleine 100, Bonne 75, Moyenne 50, Faible 15, Critique 5) pour que les alertes de pile de Gladys fonctionnent. L’état de la mesure vaut « OK » ou le problème, dans la langue de la configuration.

Une valeur qu’OilFox ne donne pas (par exemple aucun niveau quand la mesure a un problème) n’est pas publiée : la dernière valeur reste. Les valeurs inchangées sont renvoyées toutes les 6 heures, sauf pour un capteur en retard : Gladys affiche alors ses valeurs comme périmées.

### Widgets du tableau de bord

![Les deux widgets : Cuves OilFox avec les jauges d’un silo à granulés et d’une cuve à fioul et une cuve du garage en erreur, et le widget Cuve OilFox de la cuve à fioul avec son niveau sur les 90 derniers jours et un remplissage mi-septembre (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-oilfox/main/docs/assets/widgets.fr.png)

- **Cuves OilFox** : une jauge par cuve dont le niveau est connu (6 au plus), puis une carte par cuve (8 au plus), les problèmes d’abord, puis les capteurs en retard, puis les piles faibles, avec la quantité, l’autonomie et l’âge de la dernière mesure.
- **Cuve OilFox** : une cuve (à choisir dans les réglages du widget ; la première par défaut) : jauge du niveau, quantité, autonomie, pile, le niveau des 90 derniers jours, l’état de la mesure, la dernière et la prochaine mesure, la date estimée où la cuve sera vide et la consommation moyenne par jour sur 30 jours (les baisses entre deux mesures, sans les remplissages). La courbe vient des points que l’intégration garde dans `/data` (environ un an), sans aucune requête en plus : elle apparaît après deux mesures, la consommation par jour après deux jours.

### Scènes

Déclencheurs (une fois par changement, jamais à la première lecture, jamais à la suite d’une action de scène), filtrables par cuve :

- **Nouvelle mesure** : OilFox a mesuré la cuve (environ une fois par jour) ; variables : niveau, quantité, unité, autonomie, niveau de pile, quantité consommée depuis la mesure précédente, heure de la mesure.
- **Remplissage détecté** : le niveau a monté d’au moins 5 points entre deux mesures ; variables : niveau avant et après, quantité ajoutée.
- **Problème de mesure** (filtre : problèmes) : Pas encore de mesure, Mesure incorrecte, Aucun niveau détecté, Mesure défectueuse, Réglages de la cuve manquants, Réglages de la cuve incorrects, Distance mesurée trop courte, Cuve pleine (au-dessus du maximum), Niveau calculé peu plausible ; variables : le code et le libellé.
- **Mesure de nouveau correcte** : le problème a disparu.
- **Mesure en retard** / **Mesures de retour** : la mesure prévue par OilFox a 24 heures de retard (variables : heure attendue, heures de retard), puis de nouveau des mesures.
- **Accès refusé** : OilFox refuse l’adresse e-mail, le mot de passe ou les jetons (raison : `refused`, `unknown_account` ou `token`, et un message).

Une comparaison comme « niveau sous 20 % » n’est pas un déclencheur de l’intégration : utilisez une condition d’appareil de Gladys sur la fonctionnalité Niveau de remplissage, avec votre propre seuil.

Action :

- **Valeurs d’une cuve** : nom, niveau, quantité, unité, autonomie, date estimée où la cuve sera vide (AAAA-MM-JJ), consommation par jour (moyenne sur 30 jours), niveau et pourcentage approximatif de la pile, problème de mesure (code, vide s’il n’y en a pas, et libellé), dernière et prochaine mesure, si elle est en retard, et une phrase (`summary`), depuis la dernière lecture (sans requête).

Exemples :

- Quand le **Niveau de remplissage** de la cuve à fioul passe sous 20 % (condition d’appareil) → envoyer « Il est temps de commander du fioul ».
- Quand **OilFox : remplissage détecté** → envoyer « {{triggerEvent.data.tank_name}} : +{{triggerEvent.data.added_quantity}} {{triggerEvent.data.unit}} livrés ».
- Chaque lundi à 8 h → **OilFox : valeurs d’une cuve** → envoyer son `summary`.
- Quand **OilFox : problème de mesure** → envoyer « {{triggerEvent.data.tank_name}} : {{triggerEvent.data.error_label}} ».

## Dépannage

- **« OilFox ne connaît aucun compte avec cette adresse e-mail »** : OilFox a répondu 404 à la connexion ; vérifiez l’e-mail de l’application FoxMobile.
- **« OilFox a refusé la connexion »** : vérifiez le mot de passe dans l’application FoxMobile. Un compte refusé est réessayé toutes les heures, ou tout de suite avec **Tester la connexion**.
- **« Réglages de la cuve manquants »** : la forme et les dimensions de la cuve ne sont pas renseignées : configurez la cuve dans l’application FoxMobile.
- **Mesure en retard** : le capteur n’a pas mesuré depuis un jour après l’heure prévue : vérifiez son Wi-Fi et sa pile.
- **Lectures en pause** : après un HTTP 429, l’intégration attend une heure ; après une erreur du serveur ou une absence de réponse, 10 minutes, puis le double jusqu’à 2 heures.
- **Une nouvelle valeur arrive tard** : elle arrive dans Gladys jusqu’à environ une heure après l’apparition de la mesure dans l’application.
- Pour un problème, donnez les versions de Gladys et de l’intégration, le message de **Tester la connexion** et les lignes « OilFox diagnostic » écrites par **Diagnostic** dans les journaux de l’intégration (`DEBUG=gladys-integration-sdk` ajoute les journaux du SDK). Ne collez jamais votre mot de passe.
- Limites : jamais testée avec un vrai compte OilFox (écrite d’après la documentation officielle et des réponses réelles de l’API : compte inconnu 404, champ manquant 400, jeton de rafraîchissement invalide 401, mauvais jeton 401) ; un seul compte par intégration ; pas de gallons US.
