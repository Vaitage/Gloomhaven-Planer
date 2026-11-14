// Empfehlungen aus Guides, in eigenen Worten zusammengefasst. Kartennamen stehen
// auf Englisch, weil die App sie darüber den Karten zuordnet.
//
// Quellen für die Sonnenhüterin:
//   - gameslikefinder.com: "Gloomhaven Sunkeeper Guide" (Kartenwahl je Stufe, Gegenstände)
//   - u/Gripeaway auf r/Gloomhaven: "Sun class guide" (Verbesserungen)
export const GUIDES = {
  sun: {
    quelle: 'Sunkeeper-Guide von gameslikefinder.com',
    url: 'https://gameslikefinder.com/article/gloomhaven-sunkeeper-guide/',
    aufstieg: {
      2: { karte: 'Practical Plans', grund: 'Angriff und eine weite Bewegung auf einer Karte. Genau das fehlt dir auf Stufe 1.' },
      3: { karte: 'Mobilizing Axiom', grund: 'Auf lange Sicht dein wichtigster Lichterzeuger.' },
      4: { karte: 'Righteous Strength', grund: 'Zwei starke Aktionen für die Gruppe und eine verlässliche Bewegung.' },
      5: { karte: 'Path of Glory', grund: 'Gegner schneller zu besiegen verhindert mehr Schaden als zusätzlicher Schutz.' },
      6: { karte: 'Illuminate the Target', grund: 'Die Standardwahl. Nur ohne Nahkämpfer in der Gruppe ist Supportive Chant besser.' },
      7: { karte: 'Weapon of Purity', grund: 'Am vielseitigsten. In großen Gruppen wie eurer Viererrunde ist Bright Aegis eine echte Alternative.' },
      8: { karte: 'Cleansing Force', grund: 'Starke untere Aktion mit Bewegung und Lichterzeugung.' },
      9: { karte: 'Angelic Ascension', grund: 'Die beste Bewegung über fast das ganze Szenario und am Ende ein Kraftschub.' },
    },
    gegenstaende: ['Minor Stamina Potion', 'Boots of Striding', 'Minor Healing Potion', 'Hide Armor', 'Iron Helmet'],
    verbesserungen: [
      '+1 Schild unten auf Defensive Stance. Das ist der wichtigste Kauf, weil der Schild das ganze Szenario wirkt.',
      'Licht auf Cautious Advance oder Tactical Order, damit deine Lichtkarten ihren Bonus bekommen.',
      'Wunde oben auf Holy Strike.',
      '+1 Bewegung unten auf Cautious Advance, Hammer Blow oder Righteous Strength.',
    ],
    verbesserungenQuelle: 'u/Gripeaway und gameslikefinder.com',
  },
};
