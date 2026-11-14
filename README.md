# Gloomhaven-Planer

Vorbereitungshilfe für das Brettspiel Gloomhaven. Die App ersetzt nichts am Tisch, sie hilft vor dem Spielabend:

- **Szenario**: Welche Gegner kommen bei eurer Spielerzahl und Szenariostufe, mit welchen Werten, und worauf kommt es an (Schild, Vergeltung, Fernkämpfer, Zustände, Boss-Immunitäten). Dazu eine Tabelle, wie viel Schaden je Gegnertyp bei Schild 0 bis 3 bei dir ankommt.
- **Karten**: Dein Kartenvorrat, sortiert nach Nutzen für genau dieses Szenario, mit Begründung zu jeder Karte.
- **Hand**: Handvorschlag, Initiative-Übersicht, Element-Bilanz, Warnungen (zu wenig Bewegung usw.) und Ausdauer-Rechner.
- **Plan**: Rundenplan für deine Hand: welche zwei Karten pro Runde (oben/unten), mit welcher Initiative und wie oft du damit vor welchem Gegnertyp dran bist, wann rasten, wen zuerst angreifen. Die App schätzt die Länge des Szenarios und plant so viele Verlustaktionen ein, wie dafür noch reichen.
- **Charakterbildschirm** (Tipp auf den Namen oben links): Erfahrungsbalken, Gold, Ausrüstung mit Suche über alle Gegenstände, Kaufempfehlung für dein Gold, Berater für den Stufenaufstieg (Karte und Perk), Angriffsdeck mit allen Perks und Kostenrechner für Verbesserungen.
- **Erst-Setup**: Beim ersten Start führt die App durch das Anlegen eines Charakters, auch eines schon länger gespielten: Stufe, Erfahrung, Gold, gewählte Karten, Perks und Ausrüstung. Weitere Charaktere legst du im Charakterbildschirm über „Wechseln“ an.
- **Farbschema**: Die App färbt sich nach der Klasse des gewählten Charakters.
- **Notizen**: Gemeinsame Notizen pro Szenario für die ganze Gruppe. Hier tragt ihr auch ein, wie viele Runden ein Szenario gedauert hat. Daraus lernt die Schätzung der Szenariolänge.

Jeder Spieler legt seinen eigenen Charakter an. Alle 17 Klassen des Grundspiels sind enthalten, jede mit Aufstiegs- und Perk-Empfehlungen aus einem Guide. Freischaltbare Klassen stehen nur mit ihrem Symbol in der Auswahl.

## Auf dem Raspberry Pi starten

```bash
git clone https://github.com/Vaitage/gloomhaven-planer.git
cd gloomhaven-planer
docker compose up -d --build
```

Danach im Browser `http://<adresse-des-pi>:8090` öffnen. Auf dem iPhone über „Teilen → Zum Home-Bildschirm“ als App ablegen.

Der Build braucht Internet: Er holt die Spieldaten aus dem Projekt [Gloomhaven Secretariat](https://github.com/Lurkars/gloomhavensecretariat). Profile, Hände und Notizen liegen im Ordner `data/` neben dem Repo.

### Updates per Knopf in der App

Einmal auf dem Pi einrichten:

```bash
bash tools/pi/updates-einrichten.sh
```

Danach gibt es in der App unter „Notizen“ ganz unten den Bereich „App aktualisieren“. Der Pi schaut stündlich bei GitHub nach einem neuen Stand von `main`. „Jetzt aktualisieren“ holt ihn, baut neu und startet die App. Startet der neue Stand nicht, läuft die App mit dem vorherigen weiter. Automatisch eingespielt wird nie.

So funktioniert es: Die App im Container kann am Pi nichts ändern. Sie legt nur das Wort `pruefen` oder `aktualisieren` in `data/update/anfrage` ab. Ein Cron-Job (`~/.local/bin/gloomhaven-update.sh`, jede Minute) holt es ab und schreibt seinen Stand nach `data/update/status.json`. Protokoll: `~/gloomhaven-update.log`. Ausschalten: `crontab -e` und die Zeile mit `gloomhaven-update.sh` löschen.

Von Hand aktualisieren geht weiterhin: `git pull && docker compose up -d --build`

## Ohne Docker entwickeln

Braucht nur Node 20 oder neuer, keine weiteren Pakete.

```bash
git clone --depth 1 https://github.com/Lurkars/gloomhavensecretariat.git /tmp/ghs
npm run import -- /tmp/ghs      # schreibt data/gamedata.json
npm test
npm start                       # http://localhost:8090
```

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `scripts/import-data.mjs` | liest Klassen, Karten, Monster und Szenarien aus GHS und schreibt `gamedata.json` |
| `public/logic.js` | Rechenlogik: Szenario-Profil, Kartenbewertung, Handvorschlag, Ausdauer |
| `public/app.js`, `style.css` | Oberfläche (ohne Build-Schritt) |
| `public/held.js` | Charakterbildschirm: Erfahrung, Gold, Ausrüstung, Aufstieg, Verbesserungen |
| `public/setup.js` | Erst-Setup zum Anlegen und Bearbeiten von Charakteren |
| `public/tipps.js` | Empfehlungen aus Guides für alle Klassen, in eigenen Worten |
| `server.mjs` | liefert die App aus und speichert den Stand als JSON |
| `scripts/uebersetzungen/de.json` | eigene deutsche Texte, wo GHS nur englische hat |
| `tools/pi/` | Update-Dienst für den Pi und sein Einrichtungsskript |
| `test/` | Tests für Rechenlogik und Server |

## Grenzen

- Der Plan kennt weder Positionen noch Monsterkarten oder die Züge der Mitspieler. Er ist ein Reihenfolge-Vorschlag, kein Zugzwang.
- Die Bewertung besteht aus Faustregeln, keine Simulation. Sie zeigt ihre Gründe an, damit ihr sie einschätzen könnt. Karten mit reinem Sondertext kann sie nicht ausrechnen.
- Kartennamen der freischaltbaren Klassen sind englisch, weil GHS dafür keine deutsche Übersetzung enthält. Kartennummer und Initiative stimmen mit den gedruckten Karten überein. Die Sondertexte der Sonnenhüterin sind selbst übersetzt (`scripts/uebersetzungen/de.json`), der Wortlaut kann von den gedruckten Karten abweichen. Bei den anderen freischaltbaren Klassen sind sie noch englisch.
- Sonderregeln der Szenarien (Ziele, Fallen, nachrückende Gegner) sind nicht berücksichtigt, nur die Gegner aus der Aufstellung.
- Die Szenariolänge ist eine Schätzung aus Gegnerleben und üblichem Gruppenschaden. Sie wird besser, je mehr Partien ihr eintragt.
- Gegenstände werden über Stichworte aus ihrem Regeltext eingeordnet, das ist grob. Bei 17 Gegenständen fehlt in den Daten der deutsche Text, sie erscheinen englisch.
- Verbesserungskosten folgen der Tabelle im Regelheft (1. Auflage). Verbesserungsfelder von Beschwörungen fehlen.
- Die Empfehlungen für Karten und Perks beim Aufstieg folgen je Klasse einem einzelnen Guide. Daneben steht die eigene Rechnung, die vor allem Zahlenwerte bewertet und Sondertexte nicht einschätzen kann.
- Das Angriffsdeck rechnet mit Mittelwerten über das volle Deck. Vorteil, Nachteil, Segen und Fluch sind nicht eingerechnet.
- Deutsche Sondertexte gibt es bisher nur für die Sonnenhüterin. Bei den anderen Klassen sind Standardaktionen deutsch, Sondertexte und die meisten Kartennamen englisch.

## Quellen der Empfehlungen

- Kartenwahl, Perk-Reihenfolge, Gegenstände und Verbesserungen aller Klassen: die Klassen-Guides von [gameslikefinder.com](https://gameslikefinder.com/article/gloomhaven-classes/)
- Verbesserungen der Sonnenhüterin zusätzlich: Guide von u/Gripeaway auf r/Gloomhaven

Die Empfehlungen sind in eigenen Worten zusammengefasst (`public/tipps.js`).

## Rechtliches

Gloomhaven samt Texten und Bildern gehört Cephalofair Games. Dieses Repo enthält keine Spieldaten. Sie werden beim Build aus Gloomhaven Secretariat geholt (Daten dort u. a. aus dem Creator Pack, CC BY-NC-SA 4.0). Karten- und Gegenstandsbilder lädt die App direkt aus dem Projekt [Worldhaven](https://github.com/any2cards/worldhaven). Gedacht für den privaten, nicht kommerziellen Gebrauch.
