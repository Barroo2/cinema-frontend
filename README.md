# cinema-frontend

Web-Oberfläche des Kino-Ticketsystems (Modul 321, Microservices). Reines HTML/CSS/JavaScript ohne Build-Schritt,
ausgeliefert von nginx. Der Browser erreicht das Frontend und alle APIs über das Gateway (`http://localhost:8000`).

## Ablauf

1. Vorstellungen ansehen und einen Sitzplatz wählen (ohne Login).
2. "Anmelden und buchen": Login bei Keycloak (Authorization Code mit PKCE). Die Auswahl bleibt erhalten.
3. `POST /api/bookings` mit Bearer-Token. Gesendet werden nur `showtimeId` und `seats`, den Preis bestimmt der booking-service.
4. Die Buchung steht auf "Zahlung läuft". Die Seite lädt den Status alle 2 s nach, bis sie auf "Bestätigt" wechselt.

## Showtime-API v1 und v2

`showtimesPath` in `web/config.js` legt fest, welche Version das Frontend aufruft. Als Tolerant Reader versteht es beide
Preisformate: `price` als Zahl (v1) und als `{ amount, currency }` (v2). Der Ablauf der Umstellung steht im README von
`cinema-deploy`.

## Verhalten bei Ausfällen

| Ausfall | Verhalten |
|---|---|
| payment-notification-service | Buchung wird angenommen, bleibt auf "Zahlung läuft" und wechselt nach dem Neustart von selbst |
| showtime-service | Meldung statt Vorstellungen, Button "Erneut laden". Bestehende Buchungen bleiben sichtbar |
| booking-service | Meldung, die Vorstellungen bleiben sichtbar |
| Keycloak | Seite bleibt nutzbar, Buchen ist deaktiviert |

## Bekannte Einschränkungen

- Die API kennt keinen Endpunkt für belegte Sitze. Sie werden aus `GET /api/bookings` abgeleitet und sind nur angemeldet
  sichtbar. Ist ein Sitz schon vergeben, meldet das Buchen einen Konflikt (409).
- "Meine Buchungen" filtert im Browser nach der E-Mail im Token. Der booking-service selbst liefert allen angemeldeten
  Usern alle Buchungen.

## Starten

Das Repo muss neben `cinema-deploy` liegen (gleicher Ordner), dort wird es über Compose gebaut und gestartet.
Anleitung im README von `cinema-deploy`.

Der Demo-User steht in `cinema-deploy/keycloak/import/cinema-realm.json`.

## Struktur

| Pfad | Inhalt |
|---|---|
| `web/app.js` | Ablauf, API-Aufrufe, Darstellung |
| `web/config.js` | API-Pfade und Keycloak-Einstellungen |
| `web/vendor/` | `keycloak-js` 26.2.5, unverändert aus dem npm-Paket |
| `nginx.conf`, `Dockerfile` | Auslieferung als Container |
