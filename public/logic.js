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

  return { value: Math.max(0, v), why };
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
