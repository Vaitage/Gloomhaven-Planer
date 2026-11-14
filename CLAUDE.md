# Hinweise für Claude Code

Gloomhaven-Planer: Web-App zur Szenario-Vorbereitung und Handplanung, läuft als Docker-Container auf dem Raspberry Pi des Nutzers (Port 8090).

## Regeln
- Keine npm-Abhängigkeiten und kein Build-Schritt. Server ist reines Node (`server.mjs`), Oberfläche sind ES-Module in `public/`.
- Spieldaten nie ins Repo legen. `data/gamedata.json` entsteht durch `npm run import -- <ghs-checkout>` und im Dockerfile.
- Der Import ist gegen den GHS-Commit im Dockerfile (`GHS_REF`) getestet. Bei neuerem Stand zuerst Import und `npm test` lokal prüfen.
- Rechenlogik gehört in `public/logic.js` und bekommt einen Test in `test/`. Jede Bewertungsregel liefert einen Begründungstext.
- Oberfläche und Texte auf Deutsch, für das Handy zuerst.

## Erste Inbetriebnahme auf dem Pi
1. `docker compose up -d --build` (der Docker-Build wurde vor dem ersten Push nicht ausgeführt, nur seine Einzelschritte. Bei Fehlern zuerst die Stufe `daten` prüfen).
2. `curl http://localhost:8090/api/health` muss `{"ok":true}` liefern.
3. Falls Port 8090 belegt ist, in `docker-compose.yml` ändern.

## Offene Ideen
- Angriffsmodifikator-Deck mit Perks (Daten stehen in GHS unter `character/<klasse>.json`).
- Gegenstände und Verbesserungen.
- Deutsche Kartentexte für freischaltbare Klassen von Hand nachtragen.
- Schriften lokal ausliefern statt über Google Fonts.
