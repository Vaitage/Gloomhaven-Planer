# Gloomhaven-Planer

Vorbereitungshilfe für das Brettspiel Gloomhaven. Die App ersetzt nichts am Tisch, sie hilft vor dem Spielabend:

- **Szenario**: Welche Gegner kommen bei eurer Spielerzahl und Szenariostufe, mit welchen Werten, und worauf kommt es an (Schild, Vergeltung, Fernkämpfer, Zustände, Boss-Immunitäten).
- **Karten**: Dein Kartenvorrat, sortiert nach Nutzen für genau dieses Szenario, mit Begründung zu jeder Karte.
- **Hand**: Handvorschlag, Initiative-Übersicht, Element-Bilanz, Warnungen (zu wenig Bewegung usw.) und Ausdauer-Rechner.
- **Notizen**: Gemeinsame Notizen pro Szenario für die ganze Gruppe.

Jeder Spieler legt ein eigenes Profil an (Name, Klasse, Stufe). Freischaltbare Klassen stehen nur mit ihrem Symbol in der Auswahl.

## Auf dem Raspberry Pi starten

```bash
git clone https://github.com/Vaitage/gloomhaven-planer.git
cd gloomhaven-planer
docker compose up -d --build
```

Danach im Browser `http://<adresse-des-pi>:8090` öffnen. Auf dem iPhone über „Teilen → Zum Home-Bildschirm“ als App ablegen.

Der Build braucht Internet: Er holt die Spieldaten aus dem Projekt [Gloomhaven Secretariat](https://github.com/Lurkars/gloomhavensecretariat). Profile, Hände und Notizen liegen im Docker-Volume `planer-daten`.

Aktualisieren: `git pull && docker compose up -d --build`

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
| `server.mjs` | liefert die App aus und speichert den Stand als JSON |
| `test/` | Tests der Rechenlogik |

## Grenzen

- Die Bewertung besteht aus Faustregeln, keine Simulation. Sie zeigt ihre Gründe an, damit ihr sie einschätzen könnt. Karten mit reinem Sondertext kann sie nicht ausrechnen.
- Kartennamen und Sondertexte der freischaltbaren Klassen sind englisch, weil GHS dafür keine deutsche Übersetzung enthält. Kartennummer und Initiative stimmen mit den gedruckten Karten überein.
- Sonderregeln der Szenarien (Ziele, Fallen, nachrückende Gegner) sind nicht berücksichtigt, nur die Gegner aus der Aufstellung.
- Gegenstände, Angriffsmodifikatoren und Verbesserungen fehlen noch.

## Rechtliches

Gloomhaven samt Texten und Bildern gehört Cephalofair Games. Dieses Repo enthält keine Spieldaten. Sie werden beim Build aus Gloomhaven Secretariat geholt (Daten dort u. a. aus dem Creator Pack, CC BY-NC-SA 4.0). Kartenbilder lädt die App auf Wunsch direkt aus dem Projekt [Worldhaven](https://github.com/any2cards/worldhaven). Gedacht für den privaten, nicht kommerziellen Gebrauch.
