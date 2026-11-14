# Hinweise für Claude Code

Gloomhaven-Planer: Web-App zur Szenario-Vorbereitung und Handplanung, läuft als Docker-Container auf dem Raspberry Pi des Nutzers (Port 8090).

## Regeln
- Keine npm-Abhängigkeiten und kein Build-Schritt. Server ist reines Node (`server.mjs`), Oberfläche sind ES-Module in `public/`.
- Spieldaten nie ins Repo legen. `data/gamedata.json` entsteht durch `npm run import -- <ghs-checkout>` und im Dockerfile.
- Der Import ist gegen den GHS-Commit im Dockerfile (`GHS_REF`) getestet. Bei neuerem Stand zuerst Import und `npm test` lokal prüfen.
- Rechenlogik gehört in `public/logic.js` und bekommt einen Test in `test/`. Jede Bewertungsregel liefert einen Begründungstext.
- Oberfläche und Texte auf Deutsch, für das Handy zuerst.
- Eigene Übersetzungen stehen in `scripts/uebersetzungen/de.json` (Aufbau wie die GHS-Label-Dateien, hat Vorrang). Gedruckte deutsche Kartennamen kommen dort unter `ability` hinein (englischer Name -> deutscher Name).
- Commit-Titel verständlich auf Deutsch schreiben: Die App zeigt sie dem Nutzer unter „App aktualisieren“ als Änderungsliste.
- Jeder Push auf `main` ist für den Nutzer per Knopf einspielbar. Vor dem Push `npm test` und den Import laufen lassen.

## Erste Inbetriebnahme auf dem Pi
1. `docker compose up -d --build` (der Docker-Build wurde vor dem ersten Push nicht ausgeführt, nur seine Einzelschritte. Bei Fehlern zuerst die Stufe `daten` prüfen).
2. `curl http://localhost:8090/api/health` muss `{"ok":true}` liefern.
3. Falls Port 8090 belegt ist: `PORT=<frei>` in die Datei `.env` schreiben.
4. `bash tools/pi/updates-einrichten.sh` richtet den Update-Knopf ein (Cron-Job, `UPDATES_IN_APP=1` in `.env`). In der App erscheint unter „Notizen“ der Bereich „App aktualisieren“.
5. Daten liegen in `./data` (Bind-Mount). Der Container läuft als Benutzer 1000, der Ordner muss für ihn schreibbar sein.

## Update-Dienst
App und Dienst sprechen nur über `data/update/anfrage` (schreibt die App: `pruefen` oder `aktualisieren`) und `data/update/status.json` (schreibt `tools/pi/selbst-aktualisieren.sh`). Der Ablauf des Dienstes wurde mit nachgestelltem Git-Remote und Docker getestet (Erfolg, fehlgeschlagener Build mit Rückfall, ungültige Anfrage), auf einem echten Pi noch nicht.

## Spielplan
`gamePlan()` in `public/logic.js` spielt die Hand durch: pro Rastzyklus die wertvollste Paarung der Handkarten (exakt über Teilmengen), Reihenfolge nach Aufbau und Elementen, Verlustaktionen nach Budget (Aufbau im ersten Zyklus, Rest spät, letzte Runde frei), beim Rasten geht die schwächste Karte. Bewertet wird mit `scoreHalf()`, neue Regeln gehören dorthin.

## Charakterbildschirm
`public/held.js` zeichnet ihn und verarbeitet seine Klicks. Es bekommt alles über `heldCtx` aus `app.js` und hält keinen eigenen Zustand. Am Profil hängen `xp`, `gold`, `items` (`{id, worn}`), `enh` (gekaufte Verbesserungen je Klasse) und `tank`. `heldDefaults()` ergänzt die Felder bei alten Profilen. Gekaufte Verbesserungen rechnet `applyEnhancements()` in die Karten ein, deshalb läuft der Kartenvorrat immer über `pool()`.

Guide-Empfehlungen stehen in `public/tipps.js` (Kartennamen englisch, Text in eigenen Worten, Quelle nennen). Die Aufstiegsempfehlung folgt dem Guide, wenn einer hinterlegt ist, sonst der Rechnung aus `levelUpAdvice()`.

Gegenstände kommen aus `items.json` von GHS. `itemTags()` im Import leitet aus dem englischen Regeltext grobe Merkmale ab, `scoreItem()` bewertet damit.

## Offene Ideen
- Angriffsmodifikator-Deck mit Perks: vom Nutzer ausdrücklich nicht gewünscht.
- Gruppenansicht über alle Spieler: ebenfalls nicht gewünscht.
- Verbesserungsfelder von Beschwörungen.
- Gedruckte deutsche Kartennamen der Sonnenhüterin eintragen, sobald der Nutzer Fotos schickt.
- Deutsche Kartentexte für die anderen freischaltbaren Klassen von Hand nachtragen.
- Schriften lokal ausliefern statt über Google Fonts.
