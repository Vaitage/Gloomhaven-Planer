import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { stamina, resolveValue, scenarioProfile, cardPool, suggestHand, handStats, scoreCard, scoreHalf, monsterStats } from '../public/logic.js';

test('Ausdauer entspricht den bekannten Rundenzahlen', () => {
  // bekannte Werte ohne Verlustkarten: 8 -> 16, 9 -> 20, 10 -> 25, 11 -> 30, 12 -> 36
  assert.equal(stamina(8).rounds, 16);
  assert.equal(stamina(9).rounds, 20);
  assert.equal(stamina(10).rounds, 25);
  assert.equal(stamina(11).rounds, 30);
  assert.equal(stamina(12).rounds, 36);
});

test('Verlustkarten verkürzen die Ausdauer', () => {
  assert.ok(stamina(11, 1).rounds < stamina(11, 0).rounds);
  assert.ok(stamina(11, 3).rounds < stamina(11, 1).rounds);
  assert.ok(stamina(11, 0, true).total > stamina(11, 0, false).total);
});

test('Boss-Formeln rechnen mit der Spielerzahl', () => {
  assert.equal(resolveValue('8xC', 4), 32);
  assert.equal(resolveValue('(11xC)/2', 3), 17);
  assert.equal(resolveValue('10xC/2', 4), 20);
  assert.equal(resolveValue(7, 4), 7);
  assert.equal(resolveValue('3+X', 4), 3);
});

const file = new URL('../data/gamedata.json', import.meta.url);
const withData = existsSync(file);
const data = withData ? JSON.parse(readFileSync(file, 'utf8')) : null;

test('Szenario 1 hat die Gegnerzahlen aus dem Szenariobuch', { skip: !withData }, () => {
  const s = data.scenarios.find((x) => x.id === 1);
  const p4 = scenarioProfile(data, s, 4, 1);
  const guards = p4.groups.find((g) => g.id === 'bandit-guard');
  const count = (g, t) => g.types.find((x) => x.type === t)?.count || 0;
  // Raum 1: 4 normale + 2 Elite, Raum 2: 2 normale + 1 Elite
  assert.equal(count(guards, 'normal'), 6);
  assert.equal(count(guards, 'elite'), 3);
  const p2 = scenarioProfile(data, s, 2, 1);
  assert.ok(p2.enemies < p4.enemies);
  assert.equal(monsterStats(data.monsters['bandit-guard'], 'elite', 1, 4).shield, 1);
});

test('Handvorschlag für die Sonnenhüterin ist spielbar', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  assert.equal(sun.handSize, 11);
  const pool = cardPool(sun, 1, []);
  assert.equal(pool.length, 14); // 11 Stufe-1-Karten + 3 X-Karten
  assert.equal(cardPool(sun, 3, [189]).length, 15);
  const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 1);
  const { hand } = suggestHand(pool, profile, sun.handSize);
  assert.equal(hand.length, 11);
  assert.equal(new Set(hand).size, 11);
  const stats = handStats(pool.filter((c) => hand.includes(c.id)), sun.handSize);
  assert.ok(stats.moveCards >= 4);
  assert.ok(stats.attackCards >= 3);
});

test('Durchbohren wird gegen Schild höher bewertet', { skip: !withData }, () => {
  const half = (o) => ({ lost: false, persistent: false, round: false, xp: 0, attacks: [], ranged: false, area: 0, targets: 1, allTargets: false, move: 0, jump: false, heal: 0, healAllies: false, shield: 0, shieldAllies: false, retaliate: 0, pierce: 0, push: 0, pull: 0, loot: 0, summon: false, conditions: [], gen: [], use: [], text: [], ...o });
  const plain = { top: half({ attacks: [3] }), bottom: half({ move: 3 }) };
  const pierce = { top: half({ attacks: [3], pierce: 2 }), bottom: half({ move: 3 }) };
  const base = { players: 4, biggestRoom: 4, shieldAvg: 0, shieldShare: 0, retaliateShare: 0, rangedShare: 0, pierceShare: 0, attackAvg: 3, hpAvg: 6, bossHpShare: 0, bosses: 0, elites: 0, inflicts: {}, immunities: [] };
  const shielded = { ...base, shieldAvg: 2, shieldShare: 1 };
  assert.equal(scoreCard(plain, base).score, scoreCard(pierce, base).score);
  assert.ok(scoreCard(pierce, shielded).score > scoreCard(plain, shielded).score);
});

// ---------- Spielplan ----------
import { gamePlan, killOrder } from '../public/logic.js';

test('Spielplan ist regelkonform und nutzt die Hand voll aus', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 1);
  const pool = cardPool(sun, 1, []);
  const { hand } = suggestHand(pool, profile, sun.handSize);
  const cards = pool.filter((c) => hand.includes(c.id));

  const none = gamePlan(cards, profile, { losses: 0 });
  // ohne Verlustaktionen genau die bekannte Höchstzahl an Runden
  assert.equal(none.rounds, stamina(11).rounds);
  for (const s of none.steps.filter((x) => x.type === 'round')) {
    assert.notEqual(s.top.card.id, s.bottom.card.id);
    // Verlustaktionen nur in der allerletzten Runde, dort kosten sie nichts
    for (const x of [s.top, s.bottom]) assert.ok(x.basic || !x.card[x.side].lost || s.finale, 'keine Verlustaktion ohne Freigabe');
  }
  // innerhalb eines Zyklus wird keine Karte doppelt gespielt
  const byCycle = {};
  for (const s of none.steps.filter((x) => x.type === 'round')) for (const x of [s.top, s.bottom]) {
    const set = (byCycle[s.cycle] ||= new Set());
    assert.ok(!set.has(x.card.id));
    set.add(x.card.id);
  }

  const some = gamePlan(cards, profile, { losses: 3 });
  assert.ok(some.lossesPlanned >= 1 && some.lossesPlanned <= 5);
  assert.ok(some.rounds < none.rounds);
  // eine als Verlust gespielte Karte taucht danach nie wieder auf
  const gone = new Set();
  for (const s of some.steps) {
    if (s.type !== 'round') { assert.ok(!gone.has(s.lose.id)); continue; }
    for (const x of [s.top, s.bottom]) assert.ok(!gone.has(x.card.id));
    s.lost.forEach((id) => gone.add(id));
  }
  const long = gamePlan(cards, profile, { losses: 0, longRest: true });
  assert.ok(long.totalRounds > long.rounds);
});

test('Zielreihenfolge stellt Bosse ans Ende', { skip: !withData }, () => {
  const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 2), 4, 1);
  const order = killOrder(profile);
  assert.ok(order.length >= 2);
  assert.equal(order[order.length - 1].type, 'boss');
});

// ---------- Szenariolänge, Initiative, Schaden ----------
import { autoPlan, estimateRounds, calibration, initiativeOdds, incomingDamage, xpProgress, xpLevel, levelUpAdvice, enhancementCost, slotStickers, applyEnhancements, enhancementAdvice, scoreItem, shopAdvice, reputationPriceChange, itemPrice, itemPlan, scenarioReward, prosperityLevel } from '../public/logic.js';

const sunHand = (scenarioId) => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const scen = data.scenarios.find((x) => x.id === scenarioId);
  const profile = scenarioProfile(data, scen, 4, 1);
  const pool = cardPool(sun, 1, []);
  const { hand } = suggestHand(pool, profile, sun.handSize);
  return { sun, scen, profile, pool, cards: pool.filter((c) => hand.includes(c.id)) };
};

test('Szenariolänge liegt im üblichen Bereich und lernt aus Partien', { skip: !withData }, () => {
  for (const s of data.scenarios) {
    const r = estimateRounds(scenarioProfile(data, s, 4, 2), s).rounds;
    assert.ok(r >= 6 && r <= 30, `Szenario ${s.id}: ${r}`);
  }
  assert.deepEqual(calibration({}), { factor: 1, n: 0 });
  const cal = calibration({ 1: { rounds: 18, est: 12, won: true }, 2: { rounds: 12, est: 12, won: true }, 3: { rounds: 15, est: 12, won: true }, 4: { rounds: 40, est: 10, won: false } });
  assert.equal(cal.n, 3); // die Niederlage zählt nicht
  assert.equal(cal.factor, 1.25);
});

test('Kurze Szenarien bekommen mehr Verlustaktionen als lange', { skip: !withData }, () => {
  const { cards, profile } = sunHand(1);
  const kurz = autoPlan(cards, profile, { target: 10 });
  const lang = autoPlan(cards, profile, { target: 26 });
  assert.ok(kurz.lossesPlanned > lang.lossesPlanned);
  assert.ok(kurz.totalRounds >= 12, 'zwei Runden Reserve über dem Ziel');
  assert.ok(lang.totalRounds >= 28);
  assert.ok(kurz.steps.some((s) => s.reserve));
  // zu langes Ziel: der Plan sagt ehrlich, dass die Hand nicht reicht
  assert.equal(autoPlan(cards, profile, { target: 40 }).enough, false);
});

test('Initiative-Quoten zählen die Karten des Monsterdecks', { skip: !withData }, () => {
  const { profile } = sunHand(1);
  const archers = initiativeOdds(profile, 23).find((o) => o.id === 'bandit-archer');
  assert.equal(archers.of, 8);
  assert.equal(archers.before, 6); // nur die 14 und die 16 sind schneller
  assert.equal(initiativeOdds(profile, 1).find((o) => o.id === 'bandit-archer').before, 8);
  assert.equal(initiativeOdds(profile, 99).find((o) => o.id === 'bandit-archer').before, 0);
});

test('Mehr Schild lässt weniger Schaden durch', { skip: !withData }, () => {
  const { profile } = sunHand(1);
  const inc = incomingDamage(data, profile);
  for (const r of inc.rows) for (let i = 1; i < r.per.length; i++) assert.ok(r.per[i] <= r.per[i - 1]);
  assert.ok(inc.total[0] > inc.total[1] && inc.total[1] > inc.total[2]);
  // Banditen-Wache normal auf Stufe 1: Angriff 2, im Schnitt knapp darunter (eine Karte ohne Angriff)
  const guard = inc.rows.find((r) => r.id === 'bandit-guard' && r.type === 'normal');
  assert.ok(guard.per[0] > 1.5 && guard.per[0] <= 2.2);
});

// ---------- Charakter ----------

test('Erfahrungsbalken rechnet innerhalb der Stufe', () => {
  assert.deepEqual(xpProgress(128, 3), { from: 95, to: 150, ratio: 0.6, missing: 22, ready: false });
  assert.equal(xpProgress(150, 3).ready, true);
  assert.equal(xpProgress(40, 3).ratio, 0);
  assert.equal(xpProgress(999, 9).to, null);
  assert.equal(xpLevel(0), 1);
  assert.equal(xpLevel(45), 2);
  assert.equal(xpLevel(499), 8);
  assert.equal(xpLevel(500), 9);
});

test('Aufstiegsberater vergleicht die Karten der nächsten Stufe', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const rat = levelUpAdvice(data, sun, 1, []);
  assert.equal(rat.next, 2);
  assert.equal(rat.xpNeeded, 45);
  assert.deepEqual(rat.candidates.map((c) => c.card.id).sort(), [189, 190]);
  assert.ok(rat.candidates.every((c) => c.isNew && c.rate >= 0 && c.rate <= 1));
  // auf Stufe 3 steht die auf Stufe 2 ausgelassene Karte weiter zur Wahl
  const spaeter = levelUpAdvice(data, sun, 2, [189]);
  assert.ok(spaeter.candidates.some((c) => c.card.id === 190 && !c.isNew));
  assert.equal(levelUpAdvice(data, sun, 9, []), null);
});

test('Verbesserungskosten folgen dem Regelheft', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const stance = sun.cards.find((c) => c.id === 184); // Stufe 1
  const slot = stance.bottom.slots[0];
  assert.equal(slot.on, 'shield');
  assert.equal(enhancementCost('plus1', slot, stance, 0), 100);
  assert.equal(enhancementCost('plus1', slot, stance, 1), 175); // schon eine Verbesserung auf der Aktion
  assert.equal(enhancementCost('plus1', slot, { ...stance, level: 4 }, 0), 175); // +25 je Stufe über 1
  assert.equal(enhancementCost('plus1', { ...slot, multi: true }, stance, 0), 200);
  assert.equal(enhancementCost('bless', slot, stance, 0), 50);
  assert.equal(enhancementCost('el:light', slot, stance, 0), 100);
  assert.equal(enhancementCost('hex', { on: 'area', shape: 'hex', hexes: 3, multi: true }, stance, 0), 67);
  assert.equal(enhancementCost('plus1', { on: 'target', shape: 'circle', multi: true }, stance, 0), 50); // Ziel +1 wird nie verdoppelt
  // Raute mit Plus: +1, positive Zustände und Elemente, aber keine negativen Zustände
  const stickers = slotStickers(slot, stance.bottom);
  assert.ok(stickers.includes('plus1') && stickers.includes('bless') && stickers.includes('el:light'));
  assert.ok(!stickers.includes('wound'));
  assert.deepEqual(slotStickers({ on: 'range', shape: 'square' }, stance.top), ['plus1']);

  const besser = applyEnhancements(stance, [{ card: 184, side: 'bottom', slot: 0, sticker: 'plus1' }]);
  assert.equal(besser.bottom.shield, stance.bottom.shield + 1);
  assert.equal(stance.bottom.enh, undefined, 'die Originalkarte bleibt unverändert');
  assert.equal(applyEnhancements(stance, []), stance);

  const pool = cardPool(sun, 1, []);
  const top = enhancementAdvice(pool, [], 0)[0];
  assert.equal(top.card.id, 184);
  assert.equal(top.sticker, 'plus1');
});

test('Gegenstände sind importiert und werden passend bewertet', { skip: !withData }, () => {
  assert.equal(data.items.length, 150);
  const trank = data.items.find((i) => i.id === 13);
  assert.equal(trank.tags.stamina, 2);
  assert.equal(trank.slot, 'small');
  assert.ok(trank.img.endsWith('gh-013-minor-stamina-potion.png'));
  const { profile, pool } = sunHand(1);
  const laden = shopAdvice(data, profile, { gold: 30, prosperity: 1, cards: pool });
  assert.equal(laden.length, 14);
  assert.equal(laden[0].item.id, 13);
  assert.ok(laden.every((x) => x.item.prosperity === 1));
  assert.equal(shopAdvice(data, profile, { gold: 30, prosperity: 1, owned: [13], cards: pool }).some((x) => x.item.id === 13), false);
  // Der Bogen wirkt nur bei Fernangriffen, davon hat die Sonnenhüterin auf Stufe 1 kaum welche
  const bogen = data.items.find((i) => i.id === 9);
  assert.ok(scoreItem(bogen, profile, undefined, { melee: 6, ranged: 0 }).score < scoreItem(bogen, profile, undefined, { melee: 0, ranged: 6 }).score);
});

// ---------- Angriffsmodifikator-Deck ----------
import { baseDeck, buildDeck, deckStats, perkAdvice, guidePerk, perksAllowed } from '../public/logic.js';
import { GUIDES } from '../public/tipps.js';

test('Grunddeck hat 20 Karten und im Schnitt keinen Bonus', () => {
  const deck = { cards: baseDeck() };
  const st = deckStats(deck, 3);
  assert.equal(st.size, 20);
  assert.ok(Math.abs(st.avg - 3) < 1e-9);
  assert.equal(st.miss, 1 / 20);
  assert.equal(st.crit, 1 / 20);
  assert.equal(st.worse, 7 / 20); // fünf −1, eine −2, ein Fehlschlag
  assert.equal(st.better, 7 / 20);
});

test('Perks verändern das Deck wie auf dem Charakterbogen', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const idx = (key) => sun.perks.findIndex((p) => p.key === key);
  const take = (...keys) => { const t = []; for (const k of keys) t[idx(k)] = (t[idx(k)] || 0) + 1; return t; };
  // zweimal "entferne zwei −1": eine −1 bleibt
  let d = buildDeck(sun.perks, take('rm:2x-1', 'rm:2x-1'));
  assert.equal(d.cards.length, 16);
  assert.equal(d.cards.filter((c) => c.k === '-1').length, 1);
  // mehr als erlaubt wird nicht gezählt
  const zuViel = []; zuViel[idx('rm:2x-1')] = 5;
  assert.equal(buildDeck(sun.perks, zuViel).cards.length, 16);
  // −2 gegen +0 tauschen
  d = buildDeck(sun.perks, take('re:1x-2>1x+0'));
  assert.equal(d.cards.length, 20);
  assert.equal(d.cards.filter((c) => c.k === '-2').length, 0);
  assert.equal(d.cards.filter((c) => c.k === '+0').length, 7);
  // rollende +1 heben den Schnitt, ohne das Deck für die Trefferquote zu verändern
  const roll = deckStats(buildDeck(sun.perks, take('add:2x+1R')), 3);
  assert.equal(roll.rolling, 2);
  assert.ok(roll.avg > 3 && roll.avg < 3.2);
  assert.equal(roll.miss, 1 / 20);
  // Rüstung bringt −1-Karten, der Perk "negative Gegenstandseffekte ignorieren" hebt das auf
  assert.equal(buildDeck(sun.perks, [], 2).cards.length, 22);
  const frei = buildDeck(sun.perks, take('item+add:2x+1'), 2);
  assert.equal(frei.ignoreItem, true);
  assert.equal(frei.cards.filter((c) => c.item).length, 0);
  assert.equal(frei.cards.length, 22); // 20 + zwei +1
});

test('Perk-Empfehlung: Rechnung und Guide', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const rat = perkAdvice(sun.perks, [], 0);
  assert.equal(rat.list.length, sun.perks.length);
  for (let i = 1; i < rat.list.length; i++) assert.ok(rat.list[i - 1].gain >= rat.list[i].gain);
  assert.ok(rat.list[0].gain > 0);
  // mit Fellrüstung (zwei −1) wird der Gegenstands-Perk deutlich wertvoller
  const ohne = perkAdvice(sun.perks, [], 0).list.find((x) => x.perk.item).gain;
  const mit = perkAdvice(sun.perks, [], 2).list.find((x) => x.perk.item).gain;
  assert.ok(mit > ohne);
  // Guide-Reihenfolge: erst der Gegenstands-Perk, danach −2 tauschen
  const order = GUIDES.sun.perks;
  const first = guidePerk(sun.perks, [], order);
  assert.equal(sun.perks[first].key, 'item+add:2x+1');
  const taken = []; taken[first] = 1;
  assert.equal(sun.perks[guidePerk(sun.perks, taken, order)].key, 're:1x-2>1x+0');
  assert.equal(perksAllowed(1), 0);
  assert.equal(perksAllowed(4, 7), 5);
});

test('Guides passen zu den Daten aller Klassen', { skip: !withData }, () => {
  assert.equal(Object.keys(GUIDES).length, data.characters.length);
  for (const c of data.characters) {
    const g = GUIDES[c.id];
    assert.ok(g, `Guide fehlt: ${c.id}`);
    for (const [lvl, t] of Object.entries(g.aufstieg)) {
      const card = c.cards.find((x) => x.nameEn === t.karte);
      assert.ok(card, `${c.id} Stufe ${lvl}: Karte ${t.karte} gibt es nicht`);
      assert.ok(card.level !== 'X' && card.level >= 2 && card.level <= Number(lvl), `${c.id} Stufe ${lvl}: ${t.karte} hat Stufe ${card.level}`);
    }
    for (const key of g.perks) assert.ok(c.perks.some((p) => p.key === key), `${c.id}: Perk ${key} gibt es nicht`);
    for (const n of g.gegenstaende) assert.ok(data.items.some((i) => i.nameEn === n), `${c.id}: Gegenstand ${n} gibt es nicht`);
    // die Guide-Reihenfolge lässt sich vollständig abarbeiten
    const taken = [];
    for (let i = 0; i < 30; i++) { const next = guidePerk(c.perks, taken, g.perks); if (next < 0) break; taken[next] = (taken[next] || 0) + 1; }
    for (const key of g.perks) { const i = c.perks.findIndex((p) => p.key === key); assert.equal(taken[i], c.perks[i].count, `${c.id}: ${key} bleibt offen`); }
  }
});

test('Jede Klasse hat ein Symbol, das nur aus Formen besteht', { skip: !withData }, () => {
  for (const c of data.characters) {
    assert.ok(c.icon && /^[\d. -]+$/.test(c.icon.box), `Symbol fehlt: ${c.id}`);
    const tags = [...c.icon.body.matchAll(/<\/?([a-zA-Z:]+)/g)].map((m) => m[1]);
    assert.ok(tags.includes('path'), `Symbol ohne Form: ${c.id}`);
    assert.ok(tags.every((t) => ['g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline'].includes(t)), `Unerwartetes Element im Symbol: ${c.id}`);
    assert.ok(!/\son\w+=|href|style=/.test(c.icon.body), `Unerwartetes Attribut im Symbol: ${c.id}`);
  }
});

test('Ruf verändert den Kaufpreis wie im Regelheft', () => {
  const erwartet = { '-20': 5, '-19': 5, '-18': 4, '-15': 4, '-14': 3, '-11': 3, '-10': 2, '-7': 2, '-6': 1, '-3': 1, '-2': 0, 0: 0, 2: 0, 3: -1, 6: -1, 7: -2, 10: -2, 11: -3, 14: -3, 15: -4, 18: -4, 19: -5, 20: -5 };
  for (const [ruf, delta] of Object.entries(erwartet)) assert.equal(reputationPriceChange(Number(ruf)), delta, `Ruf ${ruf}`);
  assert.equal(itemPrice({ cost: 20 }, 7), 18);
  assert.equal(itemPrice({ cost: 20 }, -12), 23);
  assert.equal(itemPrice({ cost: 2 }, 20), 0);
});

test('Kaufliste rechnet mit dem Ruf', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const profil = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 1);
  const teuerster = Math.max(...data.items.filter((i) => i.prosperity === 1).map((i) => i.cost));
  const knapp = shopAdvice(data, profil, { gold: teuerster - 1, prosperity: 1, cards: sun.cards.filter((c) => c.level === 1) });
  const mitRuf = shopAdvice(data, profil, { gold: teuerster - 1, prosperity: 1, reputation: 3, cards: sun.cards.filter((c) => c.level === 1) });
  assert.ok(knapp.some((x) => x.item.cost === teuerster && !x.affordable));
  assert.ok(mitRuf.filter((x) => x.item.cost === teuerster).every((x) => x.affordable && x.price === teuerster - 1));
});

test('Ausdauertrank bringt im Plan eine Runde mehr und holt nur abgeworfene Karten zurück', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 1);
  const pool = cardPool(sun, 1, []);
  const { hand } = suggestHand(pool, profile, sun.handSize);
  const cards = pool.filter((c) => hand.includes(c.id));
  const trank = data.items.find((i) => i.id === 13);
  const ohne = gamePlan(cards, profile, { losses: 0 });
  const mit = gamePlan(cards, profile, { losses: 0, staminaItems: [{ id: 13, name: trank.name, n: trank.tags.stamina }] });
  assert.equal(mit.rounds, ohne.rounds + 1);
  assert.equal(mit.itemsUsed, 1);
  // die zurückgeholten Karten wurden im selben Zyklus schon gespielt und kommen direkt danach wieder dran
  const at = mit.steps.findIndex((s) => s.type === 'item');
  const vorher = new Set(mit.steps.slice(0, at).filter((s) => s.type === 'round').flatMap((s) => [s.top.card.id, s.bottom.card.id]));
  const step = mit.steps[at];
  assert.equal(step.cards.length, 2);
  for (const c of step.cards) assert.ok(vorher.has(c.id));
  const danach = mit.steps[at + 1];
  assert.equal(danach.type, 'round');
  assert.equal(danach.finale, false);
  for (const x of [danach.top, danach.bottom]) assert.ok(step.cards.some((c) => c.id === x.card.id));
  // ohne Freigabe weiterhin keine Verlustaktion
  for (const s of mit.steps.filter((x) => x.type === 'round')) for (const x of [s.top, s.bottom]) assert.ok(x.basic || !x.card[x.side].lost || s.finale);
});

test('Jeder getragene Gegenstand bekommt einen Einsatzvorschlag', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 1);
  const pool = cardPool(sun, 1, []);
  const { hand } = suggestHand(pool, profile, sun.handSize);
  const cards = pool.filter((c) => hand.includes(c.id));
  const items = data.items.filter((i) => i.prosperity >= 1 && i.prosperity <= 9);
  const trank = data.items.find((i) => i.id === 13);
  const plan = gamePlan(cards, profile, { losses: 1, target: 12, staminaItems: [{ id: 13, name: trank.name, n: 2 }] });
  const vorschlag = itemPlan(plan, items, profile);
  assert.equal(vorschlag.length, items.length);
  const runden = new Set(plan.steps.filter((s) => s.type === 'round').map((s) => s.n));
  for (const v of vorschlag) {
    assert.ok(v.when && v.why, `Begründung fehlt: ${v.item.nameEn}`);
    assert.ok(v.round == null || runden.has(v.round), `Runde gibt es nicht: ${v.item.nameEn}`);
  }
  assert.match(vorschlag.find((v) => v.item.id === 13).when, /^Nach Runde \d+/);
  // ein Angriffsbonus landet auf einer Runde mit Angriff
  const bonus = vorschlag.find((v) => v.item.tags.attack && v.item.use !== 'passive' && v.round != null);
  const runde = plan.steps.find((s) => s.type === 'round' && s.n === bonus.round);
  assert.ok([runde.top, runde.bottom].some((x) => x.dmg > 0));
});

test('Abschluss rechnet EP, Gold und Haken wie im Regelheft', () => {
  assert.deepEqual(scenarioReward({ level: 2, won: true, cardXp: 9, coins: 4, goal: 1 }), { xp: 17, bonus: 8, gold: 12, coinValue: 3, checks: 1 });
  // Niederlage: Karten-EP und Gold bleiben, Bonus und Haken nicht
  assert.deepEqual(scenarioReward({ level: 2, won: false, cardXp: 9, coins: 4, goal: 2 }), { xp: 9, bonus: 0, gold: 12, coinValue: 3, checks: 0 });
  assert.equal(scenarioReward({ level: 0, won: true }).xp, 4);
  assert.equal(scenarioReward({ level: 7, won: true, coins: 1 }).gold, 6);
  assert.equal(scenarioReward({ level: 1, cardXp: -3, coins: 'x', goal: 5 }).checks, 2);
});

test('Wohlstandspunkte ergeben die Stufe', () => {
  const stufe = { 0: 1, 3: 1, 4: 2, 8: 2, 9: 3, 14: 3, 15: 4, 21: 4, 22: 5, 25: 5, 29: 5, 30: 6, 38: 6, 39: 7, 49: 7, 50: 8, 63: 8, 64: 9, 99: 9 };
  for (const [punkte, erwartet] of Object.entries(stufe)) assert.equal(prosperityLevel(Number(punkte)).level, erwartet, `Punkte ${punkte}`);
  assert.equal(prosperityLevel(25).missing, 5);
  assert.equal(prosperityLevel(64).missing, null);
});

test('Betäubung an einer Heilung zählt als Preis, nicht als Effekt auf Gegner', { skip: !withData }, () => {
  const saw = data.characters.find((c) => c.id === 'saw');
  const karte = saw.cards.find((c) => c.id === 438);
  assert.equal(karte.name, 'Amputation');
  assert.deepEqual(karte.bottom.conditions, []);
  assert.deepEqual(karte.bottom.drawbacks, ['stun']);
  assert.deepEqual(karte.top.conditions, ['wound', 'immobilize']);
  const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 2);
  const unten = scoreCard(karte, profile).why.filter((w) => w.half === 'unten');
  assert.ok(unten.some((w) => !w.good && /kostet einen Zug/.test(w.text)));
  assert.ok(!unten.some((w) => /Elitegegner/.test(w.text)));
  const ohne = scoreHalf({ ...karte.bottom, drawbacks: [] }, profile).value;
  assert.ok(scoreHalf(karte.bottom, profile).value < ohne);
  // Zustände an Angriffen bleiben Effekte auf Gegner
  for (const c of data.characters) for (const k of c.cards) for (const h of [k.top, k.bottom]) if (h.drawbacks.length) assert.ok(h.heal > 0 || /selbst|Verbündete/.test(h.text.join(' ')), `${k.nameEn}`);
});

test('Bei der Rast verlorene Karte lässt sich vorgeben, der Plan danach kommt ohne sie aus', { skip: !withData }, () => {
  const sun = data.characters.find((c) => c.id === 'sun');
  const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 1);
  const pool = cardPool(sun, 1, []);
  const { hand } = suggestHand(pool, profile, sun.handSize);
  const cards = pool.filter((c) => hand.includes(c.id));
  const vorschlag = gamePlan(cards, profile, { losses: 0 });
  const rast = vorschlag.steps.find((s) => s.type === 'rest');
  assert.equal(rast.index, 0);
  assert.equal(rast.chosen, false);
  assert.equal(rast.lose.id, rast.suggest.id);
  const andere = rast.options.find((c) => c.id !== rast.suggest.id);
  const plan = gamePlan(cards, profile, { losses: 0, restLosses: [andere.id] });
  const steps = plan.steps;
  const at = steps.findIndex((s) => s.type === 'rest');
  assert.equal(steps[at].lose.id, andere.id);
  assert.equal(steps[at].chosen, true);
  assert.equal(steps[at].handAfter, cards.length - 1);
  for (const s of steps.slice(at + 1)) if (s.type === 'round') for (const x of [s.top, s.bottom]) assert.notEqual(x.card.id, andere.id);
  // bis zur Rast bleibt der Plan gleich, die Rundenzahl ohne Verlustaktionen auch
  assert.deepEqual(steps.slice(0, at).map((s) => s.type === 'round' && [s.top.card.id, s.bottom.card.id]), vorschlag.steps.slice(0, at).map((s) => s.type === 'round' && [s.top.card.id, s.bottom.card.id]));
  assert.equal(plan.rounds, vorschlag.rounds);
  // eine Karte, die gar nicht im Ablagestapel liegt, wird ignoriert
  assert.equal(gamePlan(cards, profile, { losses: 0, restLosses: [-1] }).steps.find((s) => s.type === 'rest').chosen, false);
});

test('Ein selbst erzeugtes Element zählt erst in der nächsten Runde', { skip: !withData }, () => {
  for (const id of ['sun', 'spellweaver', 'eclipse']) {
    const cls = data.characters.find((c) => c.id === id);
    const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 1);
    const pool = cardPool(cls, 1, []);
    const { hand } = suggestHand(pool, profile, cls.handSize);
    const plan = gamePlan(pool.filter((c) => hand.includes(c.id)), profile, { losses: 2 });
    let vorher = null;
    for (const s of plan.steps) {
      if (s.type !== 'round') { if (s.type === 'rest') vorher = null; continue; }
      const gen = [...(s.top.half.gen || []), ...(s.bottom.half.gen || [])];
      const use = [...(s.top.half.use || []), ...(s.bottom.half.use || [])].filter((e) => e !== 'wild');
      assert.equal(s.selfFed, undefined);
      // versorgt ist nur, was die Runde davor erzeugt hat, alles andere fehlt
      for (const e of s.fed) assert.ok(vorher && vorher.includes(e), `${id} Runde ${s.n}: ${e}`);
      assert.deepEqual([...s.fed, ...s.hungry].sort(), [...use].sort());
      vorher = gen;
    }
  }
});

// Hilfen für die Tests der Eingaben vom Tisch
function tischHand(level = 1, owned = []) {
  const sun = data.characters.find((c) => c.id === 'sun');
  const profile = scenarioProfile(data, data.scenarios.find((x) => x.id === 1), 4, 1);
  const pool = cardPool(sun, level, owned);
  const { hand } = suggestHand(pool, profile, sun.handSize);
  return { profile, cards: pool.filter((c) => hand.includes(c.id)) };
}
const folge = (steps) => steps.map((s) => (s.type === 'round' ? `${s.n}:${s.top.card.id}/${s.bottom.card.id}` : s.type === 'rest' ? `rast:${s.lose.id}` : s.type));
// Regelprüfung: keine Karte doppelt auf der Hand, verlorene Karten kommen nie wieder
function regelkonform(plan, cards, weg = []) {
  const fort = new Set(weg);
  let offen = new Set(cards.map((c) => c.id));
  let ablage = new Set();
  for (const s of plan.steps) {
    if (s.type === 'round') {
      for (const x of [s.top, s.bottom]) {
        assert.ok(offen.has(x.card.id), `Runde ${s.n}: ${x.card.name} ist nicht auf der Hand`);
        offen.delete(x.card.id);
        if (s.lost.includes(x.card.id)) fort.add(x.card.id); else ablage.add(x.card.id);
      }
      assert.notEqual(s.top.card.id, s.bottom.card.id);
    } else if (s.type === 'rest') {
      assert.ok(ablage.has(s.lose.id));
      ablage.delete(s.lose.id); fort.add(s.lose.id);
      for (const id of ablage) offen.add(id);
      ablage = new Set();
      assert.equal(s.handAfter, offen.size);
    } else if (s.type === 'item') {
      for (const c of s.cards) { assert.ok(ablage.has(c.id)); ablage.delete(c.id); offen.add(c.id); }
    } else if (s.type === 'event' && s.kind === 'lose') {
      assert.ok(offen.has(s.card.id) || ablage.has(s.card.id));
      offen.delete(s.card.id); ablage.delete(s.card.id); fort.add(s.card.id);
    }
  }
  return fort;
}

test('Eingabe „Karte verloren“: Plan davor bleibt, danach kommt die Karte nicht mehr vor', { skip: !withData }, () => {
  const { profile, cards } = tischHand();
  const basis = gamePlan(cards, profile, { losses: 1 });
  regelkonform(basis, cards);
  const runde3 = basis.steps.find((s) => s.type === 'round' && s.n === 3);
  const opfer = runde3.pool.find((c) => !basis.steps.filter((s) => s.type === 'round' && s.n <= 3).some((s) => s.top.card.id === c.id || s.bottom.card.id === c.id));
  assert.ok(opfer, 'nach Runde 3 liegt noch eine ungespielte Karte auf der Hand');
  const plan = gamePlan(cards, profile, { losses: 1, events: [{ after: 3, type: 'lose', card: opfer.id }] });
  assert.deepEqual(folge(plan.steps).slice(0, 3), folge(basis.steps).slice(0, 3));
  assert.equal(plan.steps[3].type, 'event');
  assert.equal(plan.steps[3].card.id, opfer.id);
  for (const s of plan.steps.slice(4)) if (s.type === 'round') assert.ok(s.top.card.id !== opfer.id && s.bottom.card.id !== opfer.id);
  regelkonform(plan, cards);
  assert.ok(plan.rounds < basis.rounds);
  // unbekannte Karte: nichts passiert
  assert.deepEqual(folge(gamePlan(cards, profile, { losses: 1, events: [{ after: 3, type: 'lose', card: -5 }] }).steps), folge(basis.steps));
});

test('Eingabe „hier schon rasten“ zieht die Rast vor', { skip: !withData }, () => {
  const { profile, cards } = tischHand();
  const basis = gamePlan(cards, profile, { losses: 0 });
  const plan = gamePlan(cards, profile, { losses: 0, events: [{ after: 2, type: 'rest' }] });
  assert.deepEqual(folge(plan.steps).slice(0, 2), folge(basis.steps).slice(0, 2));
  assert.equal(plan.steps[2].type, 'rest');
  assert.equal(plan.steps[2].early, 0);
  assert.equal(plan.steps[2].handAfter, cards.length - 1);
  regelkonform(plan, cards);
  // nach der ersten Runde liegen erst zwei Karten ab: Rast möglich. Vor Runde 1 nicht.
  assert.equal(gamePlan(cards, profile, { losses: 0, events: [{ after: 0, type: 'rest' }] }).steps[0].type, 'round');
});

test('Eingabe „Element liegt aus“ versorgt die nächste Runde', { skip: !withData }, () => {
  const { profile, cards } = tischHand();
  const basis = gamePlan(cards, profile, { losses: 2 });
  const hungrig = basis.steps.find((s) => s.type === 'round' && s.n >= 2 && s.hungry.length);
  assert.ok(hungrig, 'im Plan fehlt nirgends ein Element');
  const n = hungrig.n - 1;
  const element = hungrig.hungry[0];
  const plan = gamePlan(cards, profile, { losses: 2, events: [{ after: n, type: 'elements', elements: [element] }] });
  assert.deepEqual(folge(plan.steps).slice(0, n), folge(basis.steps).slice(0, n));
  const danach = plan.steps.filter((s) => s.type === 'round' && s.n === n + 1)[0];
  assert.ok(danach.fed.includes(element));
  assert.ok(!danach.hungry.includes(element));
  regelkonform(plan, cards);
});

test('Mehrere Eingaben: frühere Planteile bleiben stehen, wenn eine spätere dazukommt', { skip: !withData }, () => {
  const { profile, cards } = tischHand();
  const eins = autoPlan(cards, profile, { target: 12, events: [{ after: 2, type: 'rest' }] });
  assert.ok(eins.before >= eins.totalRounds);
  const r5 = eins.steps.find((s) => s.type === 'round' && s.n === 5);
  const zwei = autoPlan(cards, profile, { target: 12, events: [{ after: 2, type: 'rest' }, { after: 5, type: 'lose', card: r5.pool[0].id }] });
  const bis5 = (p) => folge(p.steps.slice(0, p.steps.findIndex((s) => s.type === 'round' && s.n === 5) + 1));
  assert.deepEqual(bis5(zwei), bis5(eins));
  regelkonform(zwei, cards);
  assert.equal(autoPlan(cards, profile, { target: 12 }).before, null);
});
