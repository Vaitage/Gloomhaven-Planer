import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { stamina, resolveValue, scenarioProfile, cardPool, suggestHand, handStats, scoreCard, monsterStats } from '../public/logic.js';

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
