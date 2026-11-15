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

## Handy-Variante (GitHub Pages)
Dieselbe Oberfläche ohne Server, in Chrome als App installierbar: `https://vaitage.github.io/Gloomhaven-Planer/`. `.github/workflows/pages.yml` baut sie bei jedem Push auf `main` mit `scripts/build-statisch.mjs` (setzt `<meta name="planer-modus">` auf `statisch` und die Version in `sw.js`). In dieser Betriebsart speichert `request()` in `app.js` den Stand im Gerätespeicher (`gp.stand`), ein Service Worker macht sie offline nutzbar, den Update-Bereich gibt es dort nicht. Pfade in `public/` müssen relativ bleiben, weil die Seite unter `/Gloomhaven-Planer/` liegt. Neue Dateien in `public/` auch in `KERN` in `sw.js` eintragen.

Einmalig nötig: Settings → Pages → Source „GitHub Actions“ (oder `gh api -X POST repos/Vaitage/Gloomhaven-Planer/pages -f build_type=workflow`). Lokal getestet (Speichern, Neuladen, offline), auf GitHub Pages und einem echten Android-Gerät noch nicht.

## Update-Dienst
App und Dienst sprechen nur über `data/update/anfrage` (schreibt die App: `pruefen` oder `aktualisieren`) und `data/update/status.json` (schreibt `tools/pi/selbst-aktualisieren.sh`). Der Ablauf des Dienstes wurde mit nachgestelltem Git-Remote und Docker getestet (Erfolg, fehlgeschlagener Build mit Rückfall, ungültige Anfrage), auf einem echten Pi noch nicht.

## Spielplan
`gamePlan()` in `public/logic.js` spielt die Hand durch: pro Rastzyklus die wertvollste Paarung der Handkarten (exakt über Teilmengen), Reihenfolge nach Aufbau und Elementen (ein erzeugtes Element ist erst ab Zugende da, also frühestens in der nächsten Runde nutzbar), Verlustaktionen nach Budget (Aufbau im ersten Zyklus, Rest spät, letzte Runde frei), beim Rasten geht die schwächste Karte. Bewertet wird mit `scoreHalf()`, neue Regeln gehören dorthin. Schädliche Zustände, die die eigene Seite treffen (an einer Heilung oder mit Ziel „selbst“/Verbündeter), legt der Import in `drawbacks` statt `conditions` ab, `scoreHalf()` zieht sie ab. Bei jeder Rast lässt sich im Plan die tatsächlich verlorene Karte wählen (`restLosses`, in `app.js` als `local.rastVerlust` nur für die aktuelle Hand gemerkt) und zwischen kurzer und langer Rast umschalten (`restKinds`, `local.rastArt`), der Rest wird neu gerechnet. Weitere Eingaben vom Tisch (`events`: Karte verloren, vorgezogene Rast, Element liegt aus, jeweils nach Runde `after`, dazu `basic`: in Runde `after` von einer Karte nur die Standardaktion gespielt) lassen den Plan bis dahin unverändert und planen den Rest neu. `autoPlan()` senkt danach nur das Verlustbudget (`eventBudgets`). In `app.js` stehen sie in `local.planEvents`. Getragene Ausdauertränke gehen als `staminaItems` in den Plan ein (eigener Schritt `type: 'item'` vor der ersten Rast). `itemPlan()` schlägt für jeden getragenen Gegenstand vor, wann er sich lohnt.

## Szenario abschließen
Unter „Notizen“: Runden, Karten-EP, Münzen und Kampfziel in einem Schritt. `scenarioReward()` rechnet, gebucht wird in `app.js` (`erg`). Die Gutschrift je Held steht in `state.shared.results[szenario].rewards[name]` und wird beim Neu-Eintragen oder Löschen zurückgerechnet.

## Charakterbildschirm
`public/held.js` zeichnet ihn und verarbeitet seine Klicks. Es bekommt alles über `heldCtx` aus `app.js` und hält keinen eigenen Zustand. Am Profil hängen `xp`, `gold`, `items` (`{id, worn}`), `enh` (gekaufte Verbesserungen je Klasse) und `tank`. `heldDefaults()` ergänzt die Felder bei alten Profilen. Gekaufte Verbesserungen rechnet `applyEnhancements()` in die Karten ein, deshalb läuft der Kartenvorrat immer über `pool()`.

Guide-Empfehlungen stehen in `public/tipps.js` für alle 17 Klassen (Kartennamen englisch wie in den GHS-Daten, Text in eigenen Worten, Quelle nennen). Die Aufstiegsempfehlung folgt dem Guide, wenn einer hinterlegt ist, sonst der Rechnung aus `levelUpAdvice()`. Ein Test prüft, dass jede genannte Karte, jeder Perk-Schlüssel und jeder Gegenstand in den Daten existiert.

## Angriffsdeck und Perks
Der Import schreibt je Klasse `perks` mit Schlüssel (`rm:2x-1`, `re:1x-1>1x+1`, `add:2x+1R`, `item+add:2x+1`, `scen` …), deutschem Text und den Karten, die entfernt oder hinzugefügt werden. `buildDeck()`, `deckStats()` und `perkAdvice()` in `logic.js` rechnen damit. `guidePerk()` liefert den nächsten Perk nach der Guide-Reihenfolge aus `tipps.js`. Am Profil stehen `perks` (Zähler je Klasse) und `checks` (Kampfziel-Haken).

## Erst-Setup und Farbschema
`public/setup.js` führt durch das Anlegen oder Bearbeiten eines Charakters. Der Entwurf liegt in `local.setup` und wird erst am Ende ins Profil geschrieben. `applyTheme()` in `app.js` leitet aus der Klassenfarbe alle Farb-Variablen ab (Hintergrund und Flächen nur mit einem Hauch Farbton, Rahmen und Akzente deutlich). Das Klassensymbol im Kopf kommt aus den GHS-Symbolen: `classIcon()` im Import legt es als bereinigtes SVG in `gamedata.json` (`icon`), deshalb steht `src/assets/images/character/icons` im Sparse-Checkout von Dockerfile und Workflow. Gold behält über `--gold` seine eigene Farbe.

Gegenstände kommen aus `items.json` von GHS. Der Kaufpreis läuft immer über `itemPrice()` (Ansehen der Gruppe aus `state.shared.reputation`, Tabelle in `reputationPriceChange()`, mit dem deutschen Gruppenbogen abgeglichen), verkauft wird zum halben aufgedruckten Preis. Der Wohlstand wird in Punkten geführt (`state.shared.prosperityPoints`), `prosperityLevel()` leitet die Stufe ab und `state.shared.prosperity` wird mitgeschrieben. Die Stufe bestimmt nur das Angebot. `itemTags()` im Import leitet aus dem englischen Regeltext grobe Merkmale ab, `scoreItem()` bewertet damit. Abweichungen der überarbeiteten Auflage von den GHS-Daten stehen in `REVISED_ITEMS` im Import (Ausdauertränke: kleiner 1 Karte, großer 2).

## Offene Ideen
- Gruppenansicht über alle Spieler: vom Nutzer nicht gewünscht.
- Vorteil, Nachteil, Segen und Fluch im Angriffsdeck.
- Verbesserungsfelder von Beschwörungen.
- Gedruckte deutsche Kartennamen der Sonnenhüterin eintragen, sobald der Nutzer Fotos schickt.
- Deutsche Kartentexte für die anderen freischaltbaren Klassen von Hand nachtragen.
- Schriften lokal ausliefern statt über Google Fonts.
