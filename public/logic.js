// Reine Rechenlogik ohne Browser-Abhängigkeiten, läuft im Browser und in den Tests.
// Alle Bewertungen sind einfache, nachvollziehbare Faustregeln. Jede Regel
// liefert eine Begründung mit, damit man sieht, warum eine Karte empfohlen wird.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

// ---------- Monsterwerte ----------

// Boss-Werte wie "8xC" oder "(11xC)/2" hängen von der Spielerzahl C ab.
export function resolveValue(value, players) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  const expr = value.replace(/(\d)\s*x\s*C/gi, '$1*C').replace(/C/g, String(players));
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return parseInt(value, 10) || 0; // z. B. "3+X"
  try {
    return Math.ceil(Function(`"use strict";return (${expr});`)());
  } catch {
    return 0;
  }
}

export function monsterStats(monster, type, level, players) {
  const table = type === 'boss' ? monster.bossStats : monster[type];
  const raw = (table && table[level]) || (monster.bossStats && monster.bossStats[level]) || null;
  if (!raw) return null;
  return {
    ...raw,
    hp: resolveValue(raw.hp, players),
    attackText: String(raw.attack),
    attack: resolveValue(raw.attack, players),
    rangeText: String(raw.range),
    range: resolveValue(raw.range, players),
  };
}

// ---------- Szenario-Profil ----------

export function scenarioProfile(data, scenario, players, level) {
  const p = clamp(players, 2, 4);
  const groups = new Map();
  let biggestRoom = 0;
  for (const room of scenario.rooms) {
    let inRoom = 0;
    for (const [id, c] of Object.entries(room.counts[p] || {})) {
      if (scenario.allies.includes(id)) continue;
      const g = groups.get(id) || { id, normal: 0, elite: 0, boss: 0 };
      g.normal += c.normal || 0;
      g.elite += c.elite || 0;
      g.boss += c.boss || 0;
      groups.set(id, g);
      inRoom += (c.normal || 0) + (c.elite || 0) + (c.boss || 0);
    }
    biggestRoom = Math.max(biggestRoom, inRoom);
  }

  const list = [];
  const t = {
    enemies: 0, elites: 0, bosses: 0, hp: 0, shield: 0, shielded: 0, shieldMax: 0,
    retaliating: 0, retaliateMax: 0, ranged: 0, flying: 0, attack: 0, piercing: 0, multi: 0,
  };
  const inflicts = {};
  const immunities = new Set();
  let bossHp = 0;

  for (const g of groups.values()) {
    const m = data.monsters[g.id];
    if (!m) continue;
    const entry = { id: g.id, name: m.name, boss: m.boss, flying: m.flying, deck: m.deck, specials: m.specials, immunities: m.immunities, types: [] };
    for (const type of ['normal', 'elite', 'boss']) {
      const count = g[type];
      if (!count) continue;
      const s = monsterStats(m, m.boss ? 'boss' : type, level, p);
      if (!s) continue;
      entry.types.push({ type: m.boss ? 'boss' : type, count, stats: s });
      t.enemies += count;
      if (type === 'elite') t.elites += count;
      if (m.boss) { t.bosses += count; bossHp += s.hp * count; m.immunities.forEach((i) => immunities.add(i)); }
      t.hp += s.hp * count;
      t.shield += s.shield * count;
      if (s.shield > 0) t.shielded += count;
      t.shieldMax = Math.max(t.shieldMax, s.shield);
      if (s.retaliate > 0) t.retaliating += count;
      t.retaliateMax = Math.max(t.retaliateMax, s.retaliate);
      if (s.range > 0) t.ranged += count;
      if (m.flying) t.flying += count;
      t.attack += s.attack * count;
      if (s.pierce > 0) t.piercing += count;
      if (s.targets > 1) t.multi += count;
      for (const c of s.conditions) inflicts[c] = (inflicts[c] || 0) + count;
    }
    if (entry.types.length) list.push(entry);
  }

  const n = Math.max(1, t.enemies);
  for (const k of Object.keys(inflicts)) inflicts[k] = inflicts[k] / n;

  // Was die Monsterdecks zusätzlich können (Schild, Heilung …)
  const deckTraits = {};
  for (const e of list) {
    const cards = data.decks[e.deck] || [];
    if (!cards.length) continue;
    const inits = cards.map((c) => c.initiative);
    deckTraits[e.id] = {
      initMin: Math.min(...inits), initMax: Math.max(...inits),
      initAvg: Math.round(inits.reduce((a, b) => a + b, 0) / inits.length),
      shield: cards.some((c) => c.shield > 0), heal: cards.some((c) => c.heal > 0),
      retaliate: cards.some((c) => c.retaliate > 0),
      conditions: [...new Set(cards.flatMap((c) => c.conditions))],
    };
  }

  const profile = {
    players: p, level, groups: list, deckTraits,
    enemies: t.enemies, elites: t.elites, bosses: t.bosses, biggestRoom,
    hpTotal: t.hp, hpAvg: t.hp / n, bossHpShare: t.hp ? bossHp / t.hp : 0,
    shieldAvg: t.shield / n, shieldShare: t.shielded / n, shieldMax: t.shieldMax,
    retaliateShare: t.retaliating / n, retaliateMax: t.retaliateMax,
    rangedShare: t.ranged / n, flyingShare: t.flying / n,
    attackAvg: t.attack / n, pierceShare: t.piercing / n, multiShare: t.multi / n,
    inflicts, immunities: [...immunities],
  };
  profile.notes = profileNotes(profile, data);
  return profile;
}

// Kurze Einschätzung in Klartext, worauf es im Szenario ankommt.
export function profileNotes(p, data) {
  const cn = (c) => (data && data.conditionNames && data.conditionNames[c]) || c;
  const notes = [];
  const pct = (v) => `${Math.round(v * 100)} %`;
  if (!p.enemies) return [{ kind: 'info', text: 'Für dieses Szenario sind keine Gegner hinterlegt, vermutlich ein Sonderszenario.' }];
  if (p.shieldShare >= 0.25) {
    notes.push({ kind: 'warn', text: `${pct(p.shieldShare)} der Gegner haben Schild (bis ${p.shieldMax}). Durchbohren, Gift, Wunde und wenige starke Angriffe sind besser als viele kleine.` });
  }
  if (p.retaliateShare >= 0.2) {
    notes.push({ kind: 'warn', text: `${pct(p.retaliateShare)} der Gegner haben Vergeltung (bis ${p.retaliateMax}). Fernangriffe bevorzugen, Nahkampf kostet Lebenspunkte.` });
  }
  if (p.rangedShare >= 0.4) {
    notes.push({ kind: 'info', text: `${pct(p.rangedShare)} der Gegner greifen aus der Ferne an. Vergeltung bringt wenig, Beweglichkeit hilft beim Aufschließen.` });
  }
  if (p.biggestRoom >= p.players * 2) {
    notes.push({ kind: 'info', text: `Bis zu ${p.biggestRoom} Gegner in einem Raum. Flächen- und Mehrfachangriffe lohnen sich, Schild fängt viele kleine Treffer ab.` });
  }
  if (p.pierceShare >= 0.2) {
    notes.push({ kind: 'warn', text: `${pct(p.pierceShare)} der Gegner haben Durchbohren. Eigener Schild ist weniger wert, lieber Heilung einplanen.` });
  }
  const bad = Object.entries(p.inflicts).filter(([, v]) => v >= 0.2).map(([c]) => c);
  if (bad.length) {
    const healable = bad.some((c) => c === 'poison' || c === 'wound');
    notes.push({ kind: 'warn', text: `Gegner verteilen ${bad.map(cn).join(', ')}.${healable ? ' Heilung entfernt Gift und Wunde.' : ''}` });
  }
  if (p.bosses) {
    const imm = p.immunities.length ? ` Der Boss ist immun gegen ${p.immunities.map(cn).join(', ')}.` : '';
    notes.push({ kind: 'warn', text: `Bosskampf.${imm} Hoher Einzelschaden zählt, Verlustkarten für den Boss aufheben.` });
  }
  if (p.flyingShare >= 0.5) notes.push({ kind: 'info', text: 'Viele fliegende Gegner: Hindernisse und Fallen halten sie nicht auf.' });
  const hpPerPlayer = p.hpTotal / p.players;
  if (hpPerPlayer >= 60) {
    notes.push({ kind: 'info', text: `Viel Leben zu bewältigen (${Math.round(hpPerPlayer)} Lebenspunkte pro Spieler). Ausdauer zählt, mit Verlustkarten sparsam umgehen.` });
  }
  if (!notes.length) notes.push({ kind: 'info', text: 'Keine Besonderheiten. Eine ausgewogene Hand passt.' });
  return notes;
}

// ---------- Kartenbewertung ----------

const CONDITION_VALUE = {
  stun: 3, disarm: 2.5, immobilize: 1.8, muddle: 1.5, wound: 1.5, poison: 1.5, curse: 1.5,
  bless: 1.5, strengthen: 2, invisible: 2.5,
};
const ENEMY_CONDITIONS = ['stun', 'disarm', 'immobilize', 'muddle', 'wound', 'poison', 'curse'];

function crowdCap(p) {
  if (p.biggestRoom >= 6) return 3;
  if (p.biggestRoom >= 4) return 2.5;
  return 2;
}

export function scoreHalf(half, p, cn = (c) => c) {
  let v = 0;
  let dmg = 0;
  const why = [];
  const add = (text, good = true) => { if (!why.some((w) => w.text === text)) why.push({ text, good }); };

  if (half.attacks.length) {
    let targets = Math.max(half.targets, half.area || 1);
    if (half.allTargets) targets = Math.max(targets, 3);
    const eff = Math.min(targets, crowdCap(p));
    const shield = Math.max(0, p.shieldAvg - half.pierce);
    const raw = half.attacks.reduce((a, b) => a + b, 0);
    const after = half.attacks.reduce((a, b) => a + Math.max(0, b - shield), 0);
    v += after * eff;
    dmg = after * eff;
    if (p.shieldShare >= 0.25) {
      if (half.pierce) add('Durchbohren hilft gegen Schild');
      else if (raw && after / raw < 0.7) add('Schild schluckt viel von diesem Angriff', false);
      else if (Math.max(...half.attacks) >= 4) add('Starker Einzelangriff kommt durch Schild');
    }
    if (targets > 1 && p.biggestRoom >= p.players * 2) add('Trifft mehrere der vielen Gegner');
    if (targets > 1 && p.biggestRoom < 3) add('Mehrfachziele finden hier selten genug Gegner', false);
    if (p.retaliateShare >= 0.2) {
      if (half.ranged) { v += 1.5; add('Fernangriff umgeht Vergeltung'); }
      else { v -= 1; add('Nahkampf löst Vergeltung aus', false); }
    }
    if (p.bosses && Math.max(...half.attacks) >= 5) { v += 1; add('Hoher Schaden für den Boss'); }
  }

  for (const c of half.conditions) {
    let cv = CONDITION_VALUE[c] ?? 1;
    if (ENEMY_CONDITIONS.includes(c)) {
      if (p.immunities.includes(c)) {
        cv *= 1 - p.bossHpShare;
        add(`Boss ist immun gegen ${cn(c)}`, false);
      }
      if ((c === 'poison' || c === 'wound') && (p.shieldShare >= 0.25 || p.hpAvg >= 10)) {
        cv += 1; add(`${cn(c)} wirkt an Schild vorbei und lohnt bei viel Leben`);
      }
      if (c === 'immobilize') {
        cv *= 1 - p.rangedShare;
        if (p.rangedShare >= 0.5) add('Lähmung bringt wenig gegen Fernkämpfer', false);
      }
      if (c === 'disarm' || c === 'stun') {
        if (p.elites + p.bosses >= 2) { cv += 0.5; add(`${cn(c)} nimmt Elitegegner aus dem Spiel`); }
      }
    }
    v += cv;
  }

  if (half.move) {
    v += half.move * 0.55 + (half.jump ? 0.5 : 0);
    if (p.rangedShare >= 0.4 && half.move >= 4) { v += 0.5; add('Weite Bewegung, um Fernkämpfer zu erreichen'); }
  }

  if (half.heal) {
    let hv = half.heal * 0.6 + (half.healAllies ? 1 : 0);
    if ((p.inflicts.poison || 0) + (p.inflicts.wound || 0) >= 0.2) { hv += 1.5; add('Heilung entfernt Gift und Wunde'); }
    if (p.pierceShare >= 0.2) { hv += 0.5; add('Heilung statt Schild gegen Durchbohren'); }
    v += hv;
  }

  if (half.shield) {
    const duration = half.persistent ? 3 : 1;
    let sv = half.shield * 1.2 * duration + (half.shieldAllies ? 1 : 0);
    if (p.pierceShare >= 0.2) { sv *= 1 - p.pierceShare; add('Gegner durchbohren Schild', false); }
    if (p.biggestRoom >= p.players * 2 && p.attackAvg <= 3.5) { sv += 1.5; add('Schild fängt viele schwache Angriffe ab'); }
    v += sv;
  }

  if (half.retaliate) {
    const duration = half.persistent ? 2.5 : 1;
    let rv = half.retaliate * duration * (1 - p.rangedShare);
    if (p.rangedShare >= 0.5) add('Vergeltung trifft Fernkämpfer nicht', false);
    else if (p.biggestRoom >= p.players * 2) { rv += 1; add('Vergeltung lohnt gegen viele Nahkämpfer'); }
    v += rv;
  }

  v += half.loot * 0.5 + (half.push + half.pull) * 0.4 + (half.summon ? 2.5 : 0) + half.xp * 0.2 + half.gen.length * 0.3;

  // Reine Textkarten (Unterstützung, Sondereffekte) lassen sich nicht ausrechnen.
  const countable = half.attacks.length || half.conditions.length || half.move || half.heal || half.shield || half.retaliate || half.loot || half.summon;
  if (!countable && half.text.length) { v += 3; add('Sondereffekt, bitte selbst einschätzen'); }

  return { value: Math.max(0, v), why, dmg };
}

export function scoreCard(card, profile, cn) {
  const top = scoreHalf(card.top, profile, cn);
  const bottom = scoreHalf(card.bottom, profile, cn);
  const hi = Math.max(top.value, bottom.value);
  const lo = Math.min(top.value, bottom.value);
  const why = [...top.why.map((w) => ({ ...w, half: 'oben' })), ...bottom.why.map((w) => ({ ...w, half: 'unten' }))];
  return { score: round1(hi * 0.65 + lo * 0.35), top: round1(top.value), bottom: round1(bottom.value), why };
}

// ---------- Kartenvorrat und Handvorschlag ----------

// Stufe-1- und X-Karten gehören immer zum Vorrat, höhere nur, wenn sie gewählt wurden.
export function cardPool(character, level, owned = []) {
  return character.cards.filter((c) => c.level === 'X' || c.level === 1 || (c.level <= level && owned.includes(c.id)));
}

const isLossCard = (c) => c.top.lost || c.bottom.lost;
const hasMove = (c) => (c.bottom.move >= 2 && !c.bottom.lost) || (c.top.move >= 2 && !c.top.lost);
const hasAttack = (c) => (c.top.attacks.length && !c.top.lost) || (c.bottom.attacks.length && !c.bottom.lost);
// "Verlust-lastig": die bessere Hälfte geht nur als Verlust
const lossHeavy = (c, s) => (s.top >= s.bottom ? c.top.lost : c.bottom.lost);

export function suggestHand(pool, profile, handSize, opts = {}) {
  const cn = opts.conditionName;
  const maxLossHeavy = opts.maxLossHeavy ?? Math.max(2, Math.floor(handSize / 4));
  const scored = pool.map((card) => ({ card, s: scoreCard(card, profile, cn) })).sort((a, b) => b.s.score - a.s.score);
  if (scored.length <= handSize) return { hand: scored.map((x) => x.card.id), scored, swaps: [] };

  const hand = [];
  const rest = [];
  let heavy = 0;
  for (const x of scored) {
    const h = lossHeavy(x.card, x.s);
    if (hand.length < handSize && (!h || heavy < maxLossHeavy)) { hand.push(x); if (h) heavy++; } else rest.push(x);
  }
  while (hand.length < handSize && rest.length) hand.push(rest.shift());

  // Mindestmengen sicherstellen: genug Bewegung und genug wiederholbare Angriffe
  const swaps = [];
  const ensure = (test, need, label) => {
    let guard = 0;
    while (hand.filter((x) => test(x.card)).length < need && guard++ < handSize) {
      const inIdx = rest.findIndex((x) => test(x.card));
      if (inIdx < 0) break;
      let outIdx = -1;
      for (let i = hand.length - 1; i >= 0; i--) if (!test(hand[i].card)) { outIdx = i; break; }
      if (outIdx < 0) break;
      const [incoming] = rest.splice(inIdx, 1);
      const [outgoing] = hand.splice(outIdx, 1, incoming);
      rest.push(outgoing);
      rest.sort((a, b) => b.s.score - a.s.score);
      hand.sort((a, b) => b.s.score - a.s.score);
      swaps.push({ in: incoming.card.id, out: outgoing.card.id, label });
    }
  };
  ensure(hasMove, Math.ceil(handSize / 3), 'für genug Bewegung');
  ensure(hasAttack, Math.ceil(handSize / 4), 'für genug Angriffe');

  return { hand: hand.map((x) => x.card.id), scored, swaps };
}

// ---------- Hand-Kennzahlen ----------

export function handStats(cards, handSize, elementName = (e) => e) {
  const gen = {};
  const use = {};
  for (const c of cards) {
    for (const h of [c.top, c.bottom]) {
      for (const e of h.gen) gen[e] = (gen[e] || 0) + 1;
      for (const e of h.use) use[e] = (use[e] || 0) + 1;
    }
  }
  const inits = cards.map((c) => c.initiative).sort((a, b) => a - b);
  const stats = {
    count: cards.length, handSize,
    lossCards: cards.filter(isLossCard).length,
    moveCards: cards.filter(hasMove).length,
    attackCards: cards.filter(hasAttack).length,
    healCards: cards.filter((c) => c.top.heal || c.bottom.heal).length,
    shieldCards: cards.filter((c) => c.top.shield || c.bottom.shield).length,
    fast: inits.filter((i) => i <= 25).length,
    slow: inits.filter((i) => i >= 75).length,
    initMin: inits[0] ?? null, initMax: inits[inits.length - 1] ?? null,
    gen, use, warnings: [],
  };
  const w = stats.warnings;
  if (cards.length < handSize) w.push(`Noch ${handSize - cards.length} Karte(n) wählen, die Hand hat ${handSize} Karten.`);
  if (cards.length > handSize) w.push(`${cards.length - handSize} Karte(n) zu viel, die Hand hat ${handSize} Karten.`);
  if (cards.length >= handSize - 1) {
    if (stats.moveCards < Math.ceil(handSize / 3)) w.push(`Nur ${stats.moveCards} Karten mit wiederholbarer Bewegung. Das wird eng beim Positionieren.`);
    if (stats.attackCards < Math.ceil(handSize / 4)) w.push(`Nur ${stats.attackCards} Karten mit wiederholbarem Angriff.`);
    if (stats.fast === 0) w.push('Keine schnelle Karte (Initiative bis 25). Du handelst fast immer nach den Monstern.');
    if (stats.slow === 0) w.push('Keine langsame Karte (Initiative ab 75). Du kannst Monster nicht gezielt zuerst kommen lassen.');
  }
  for (const [e, n] of Object.entries(use)) {
    if (e === 'wild') continue;
    const g = (gen[e] || 0) + (gen.wild || 0);
    if (g === 0) w.push(`${n} Karte(n) verbrauchen ${elementName(e)}, aber keine erzeugt es. Das müssen Mitspieler liefern.`);
    else if (g < n / 2) w.push(`${n} Karten verbrauchen ${elementName(e)}, nur ${g} erzeugen es.`);
  }
  return stats;
}

// ---------- Ausdauer ----------

// Wie viele Runden hält die Hand? Pro Runde zwei Karten, bei weniger als zwei
// Handkarten wird gerastet und dabei eine Karte verloren. "lossesPlayed" sind
// zusätzlich gespielte Verlustaktionen (eine pro Rastzyklus, früh gespielt).
export function stamina(handSize, lossesPlayed = 0, longRest = false) {
  let hand = handSize;
  let discard = 0;
  let lossesLeft = lossesPlayed;
  let played = 0;
  let rests = 0;
  const cycles = [];
  let inCycle = 0;
  let lossThisCycle = false;
  for (let guard = 0; guard < 500; guard++) {
    if (hand >= 2) {
      hand -= 2;
      if (lossesLeft > 0 && !lossThisCycle) { discard += 1; lossesLeft--; lossThisCycle = true; } else discard += 2;
      played++; inCycle++;
      continue;
    }
    if (discard < 2) break; // Rasten nicht mehr möglich
    hand += discard - 1;
    discard = 0;
    rests++;
    cycles.push(inCycle);
    inCycle = 0;
    lossThisCycle = false;
    if (hand < 2) break;
  }
  if (inCycle) cycles.push(inCycle);
  return { rounds: played, rests, total: played + (longRest ? rests : 0), cycles };
}

// ---------- Spielplan ----------

// Jede Karte lässt sich statt ihrer Aktion auch als Standardaktion spielen:
// oben Angriff 2, unten Bewegung 2.
const BASIC = { top: { attacks: [2], move: 0 }, bottom: { attacks: [], move: 2 } };

// Zielreihenfolge: gefährlich und schnell zu töten kommt zuerst.
export function killOrder(profile) {
  const rows = [];
  for (const g of profile.groups) {
    for (const t of g.types) {
      const s = t.stats;
      const threat = s.attack * s.targets * (s.range ? 1.25 : 1) + s.conditions.length + (s.retaliate ? 0.5 : 0);
      const tough = s.hp + s.shield * 3;
      const why = [];
      if (g.boss) why.push('Boss, hält am längsten durch');
      if (s.range) why.push('greift aus der Ferne an');
      if (s.targets > 1) why.push(`trifft ${s.targets} Ziele`);
      if (s.conditions.length) why.push('verteilt Zustände');
      if (s.shield) why.push(`Schild ${s.shield}, nur mit starken Treffern lohnend`);
      if (s.retaliate) why.push(`Vergeltung ${s.retaliate}, besser aus der Ferne`);
      if (!why.length) why.push(tough <= 6 ? 'fällt schnell' : 'viel Leben, wenig Besonderes');
      rows.push({ id: g.id, name: g.name, type: g.boss ? 'boss' : t.type, count: t.count, priority: g.boss ? -1 : threat / Math.max(1, tough), why });
    }
  }
  return rows.sort((a, b) => b.priority - a.priority);
}

// Mittlere Initiative der Gegner, gewichtet nach Anzahl
export function enemyInitiative(profile) {
  let sum = 0;
  let n = 0;
  for (const g of profile.groups) {
    const d = profile.deckTraits[g.id];
    if (!d) continue;
    const count = g.types.reduce((a, t) => a + t.count, 0);
    sum += d.initAvg * count; n += count;
  }
  return n ? Math.round(sum / n) : 50;
}

const isSetup = (h) => h.persistent || h.summon;
const melee = (h) => h.attacks.length > 0 && !h.ranged;

// Bewertet, Karte a oben und Karte b unten in einer Runde zu spielen.
// "enabled" enthält die Verlusthälften, die in diesem Zyklus gespielt werden dürfen.
function pairOption(a, b, val, enabled, basicAttack) {
  const pick = (card, side) => {
    const h = card[side];
    const usable = !h.lost || enabled.has(`${card.id}:${side}`);
    const real = usable ? val[card.id][side] : null;
    const basicValue = side === 'top' ? basicAttack : 1.1;
    if (real && real.value >= basicValue) return { card, side, half: h, value: real.value, dmg: real.dmg, basic: false };
    return { card, side, half: BASIC[side], value: basicValue, dmg: side === 'top' ? basicAttack : 0, basic: true };
  };
  const top = pick(a, 'top');
  const bottom = pick(b, 'bottom');
  let value = top.value + bottom.value;
  const notes = [];
  const th = top.half;
  const bh = bottom.half;
  const moves = (th.move || 0) + (bh.move || 0);
  if (!moves && (melee(th) || melee(bh)) ) { value -= 1; notes.push('Ohne Bewegung: nur spielen, wenn ein Gegner neben dir steht.'); }
  if (moves >= 3 && (melee(th) || melee(bh))) value += 0.5;
  const gen = [...(th.gen || []), ...(bh.gen || [])];
  const use = [...(th.use || []), ...(bh.use || [])].filter((e) => e !== 'wild');
  const self = use.filter((e) => gen.includes(e));
  if (self.length) { value += 1.5; }
  return { top, bottom, value, notes, gen, use, selfFed: self };
}

// Beste Aufteilung der Handkarten in Zweierpaare (exakt, über alle Teilmengen).
function bestPairing(cards, val, enabled, basicAttack) {
  const n = cards.length;
  const opt = (i, j) => {
    const x = pairOption(cards[i], cards[j], val, enabled, basicAttack);
    const y = pairOption(cards[j], cards[i], val, enabled, basicAttack);
    return x.value >= y.value ? x : y;
  };
  const memo = new Map();
  const solve = (mask, skipLeft) => {
    if (mask === 0) return { value: 0, pairs: [], left: [] };
    const key = mask * 2 + (skipLeft ? 1 : 0);
    if (memo.has(key)) return memo.get(key);
    let i = 0;
    while (!(mask & (1 << i))) i++;
    let best = null;
    if (skipLeft) { // bei ungerader Kartenzahl bleibt genau eine Karte auf der Hand
      const r = solve(mask & ~(1 << i), false);
      best = { value: r.value, pairs: r.pairs, left: [cards[i], ...r.left] };
    }
    for (let j = i + 1; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const o = opt(i, j);
      const r = solve(mask & ~(1 << i) & ~(1 << j), skipLeft);
      if (!best || o.value + r.value > best.value) best = { value: o.value + r.value, pairs: [o, ...r.pairs], left: r.left };
    }
    memo.set(key, best);
    return best;
  };
  return solve((1 << n) - 1, n % 2 === 1);
}

// Reihenfolge der Runden im Zyklus: Aufbau zuerst, Elemente erst erzeugen, dann verbrauchen.
function orderRounds(pairs, carried) {
  const rest = [...pairs];
  const out = [];
  let avail = new Set(carried);
  const needs = (p) => p.use.filter((e) => !p.selfFed.includes(e));
  const take = (i) => { const [p] = rest.splice(i, 1); p.fed = needs(p).filter((e) => avail.has(e)); p.hungry = needs(p).filter((e) => !avail.has(e)); out.push(p); avail = new Set(p.gen); };
  while (rest.length) {
    let i = rest.findIndex((p) => isSetup(p.top.half) || isSetup(p.bottom.half));
    if (i < 0) i = rest.findIndex((p) => needs(p).length && needs(p).every((e) => avail.has(e)));
    if (i < 0) {
      const wanted = new Set(rest.flatMap(needs));
      i = rest.findIndex((p) => p.gen.some((e) => wanted.has(e)) && !needs(p).length);
    }
    if (i < 0) i = rest.reduce((b, p, k) => (p.value > rest[b].value ? k : b), 0);
    take(i);
  }
  return { rounds: out, carried: [...avail] };
}

// Spielt die Hand komplett durch und liefert einen Rundenplan.
// opts.losses: wie viele Verlustaktionen eingeplant werden dürfen
// opts.longRest: lange Rasten (Karte frei wählbar, kostet eine Runde)
export function gamePlan(cards, profile, opts = {}) {
  const cn = opts.conditionName;
  let budget = opts.losses ?? 2;
  const longRest = !!opts.longRest;
  const val = {};
  for (const c of cards) val[c.id] = { top: scoreHalf(c.top, profile, cn), bottom: scoreHalf(c.bottom, profile, cn), card: scoreCard(c, profile, cn).score };
  const basicAttack = Math.max(0, 2 - profile.shieldAvg);
  const enemyInit = enemyInitiative(profile);
  const lossHalves = (pool) => pool.flatMap((c) => ['top', 'bottom'].filter((s) => c[s].lost).map((s) => ({ key: `${c.id}:${s}`, card: c, side: s, value: val[c.id][s].value, setup: isSetup(c[s]) })));

  let hand = [...cards];
  let discard = [];
  const steps = [];
  let round = 0;
  let cycle = 0;
  let carried = [];
  let damage = 0;
  const lostPlayed = [];

  for (let guard = 0; guard < 60 && hand.length >= 2; guard++) {
    // Welche Verlustaktionen sind in diesem Zyklus freigegeben?
    const enabled = new Set();
    const candidates = lossHalves(hand).sort((a, b) => b.value - a.value);
    let free = budget;
    if (cycle === 0) for (const c of candidates.filter((x) => x.setup).slice(0, Math.min(2, free))) { enabled.add(c.key); free--; }
    if (hand.length <= 6 && free > 0) { const c = candidates.find((x) => !x.setup && !enabled.has(x.key)); if (c) enabled.add(c.key); }
    // Letzte Runde vor der Erschöpfung: Verlustaktionen kosten nichts mehr
    if (hand.length === 2) for (const c of candidates) enabled.add(c.key);

    const pairing = bestPairing(hand, val, enabled, basicAttack);
    const ordered = orderRounds(pairing.pairs, carried);
    carried = ordered.carried;
    for (const p of ordered.rounds) {
      round++;
      const inis = [p.top.card.initiative, p.bottom.card.initiative].sort((a, b) => a - b);
      const halves = [p.top.half, p.bottom.half];
      const protect = halves.some((h) => (h.conditions || []).some((c) => ['stun', 'disarm', 'immobilize'].includes(c)) || h.heal || h.shield);
      const waitForThem = !protect && halves.some(melee) && !halves.some((h) => h.move >= 3) && profile.rangedShare < 0.5;
      const lead = waitForThem ? inis[1] : inis[0];
      const leadWhy = waitForThem ? 'spät gehen und die Gegner herankommen lassen' : protect ? 'früh gehen, damit Schutz und Kontrolle vor den Gegnern wirken' : 'früh gehen und zuerst zuschlagen';
      const lostNow = [p.top, p.bottom].filter((x) => !x.basic && x.card[x.side].lost);
      const finale = hand.length === 2;
      for (const x of lostNow) { if (!finale) budget--; lostPlayed.push(x.card.id); }
      damage += p.top.dmg + p.bottom.dmg;
      steps.push({
        type: 'round', n: round, cycle, value: round1(p.value), top: p.top, bottom: p.bottom,
        lead, other: lead === inis[0] ? inis[1] : inis[0], leadWhy, beforeEnemies: lead < enemyInit,
        notes: p.notes, selfFed: p.selfFed, fed: p.fed || [], hungry: p.hungry || [],
        lost: lostNow.map((x) => x.card.id), finale,
      });
      const gone = new Set(lostNow.map((x) => x.card.id));
      for (const c of [p.top.card, p.bottom.card]) if (!gone.has(c.id)) discard.push(c);
    }
    hand = pairing.left;
    if (hand.length >= 2) continue;
    if (discard.length < 2) break;
    // Rasten: die Karte abgeben, die für dieses Szenario am wenigsten bringt
    const worst = discard.reduce((b, c) => (val[c.id].card < val[b.id].card ? c : b), discard[0]);
    discard = discard.filter((c) => c !== worst);
    hand = [...hand, ...discard];
    discard = [];
    if (longRest) round++;
    steps.push({ type: 'rest', long: longRest, n: longRest ? round : null, lose: worst, handAfter: hand.length });
    cycle++;
    carried = [];
    if (hand.length < 2) break;
  }

  const rounds = steps.filter((s) => s.type === 'round').length;
  return {
    steps, rounds, totalRounds: round, damage: Math.round(damage), share: Math.round(profile.hpTotal / profile.players),
    enemyInit, killOrder: killOrder(profile), lossesPlanned: lostPlayed.length,
  };
}
