#!/usr/bin/env bash
# Richtet Updates aus der App ein: Der Pi schaut stündlich bei GitHub nach einem
# neuen Stand von main. In der App erscheint dann unter „Notizen“ der Hinweis
# „Neue Version verfügbar“, und „Jetzt aktualisieren“ spielt ihn ein
# (tools/pi/selbst-aktualisieren.sh). Automatisch eingespielt wird nie.
# Läuft AUF dem Pi, ohne sudo, im geklonten Ordner:
#
#   bash tools/pi/updates-einrichten.sh
#
# Ausschalten: crontab -e und die Zeile mit gloomhaven-update.sh löschen.
set -euo pipefail

HAUPT="${HAUPT:-$(cd "$(dirname "$0")/../.." && pwd)}"
REPO_URL="${1:-$(git -C "$HAUPT" remote get-url origin 2>/dev/null || true)}"
[ -d "$HAUPT/.git" ] || { echo "$HAUPT ist kein Git-Ordner."; exit 1; }
[ -n "$REPO_URL" ] || { echo "Bitte die GitHub-Adresse angeben: bash $0 https://github.com/<name>/Gloomhaven-Planer"; exit 1; }
for cmd in flock python3 curl docker git; do
  command -v "$cmd" >/dev/null || { echo "$cmd fehlt auf dem Pi."; exit 1; }
done
export GIT_TERMINAL_PROMPT=0
git ls-remote -q "$REPO_URL" HEAD >/dev/null 2>&1 || { echo "Kein Zugriff auf $REPO_URL. Das Repository muss öffentlich sein."; exit 1; }
if [ "$(id -u)" != 1000 ]; then
  echo "Hinweis: Du bist nicht Benutzer 1000. Die App im Container läuft als Benutzer 1000 und"
  echo "muss in $HAUPT/data schreiben können. Falls das Speichern nicht klappt: chmod -R a+rwX $HAUPT/data"
fi

mkdir -p "$HOME/.config" "$HOME/.local/bin" "$HOME/.cache/gloomhaven-update" "$HAUPT/data/update"
{
  printf 'HAUPT=%q\n' "$HAUPT"
  printf 'REPO_URL=%q\n' "$REPO_URL"
} > "$HOME/.config/gloomhaven-update.conf"
install -m 755 "$HAUPT/tools/pi/selbst-aktualisieren.sh" "$HOME/.local/bin/gloomhaven-update.sh"

# Jede Minute: schaut nur nach Anfragen aus der App. Zu GitHub geht es stündlich.
ZEILE="* * * * * $HOME/.local/bin/gloomhaven-update.sh >> $HOME/gloomhaven-update.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'gloomhaven-update.sh' || true; echo "$ZEILE" ) | crontab -

# Bereich „App aktualisieren“ in der App einschalten
touch "$HAUPT/.env"
if grep -q '^UPDATES_IN_APP=' "$HAUPT/.env"; then
  sed -i 's/^UPDATES_IN_APP=.*/UPDATES_IN_APP=1/' "$HAUPT/.env"
else
  echo 'UPDATES_IN_APP=1' >> "$HAUPT/.env"
fi
(cd "$HAUPT" && docker compose up -d)

echo "Eingerichtet. Der Pi schaut stündlich nach Updates, eingespielt wird nur per Knopf in der App."
echo "In der App: Reiter „Notizen“, ganz unten „App aktualisieren“. Protokoll: ~/gloomhaven-update.log"
