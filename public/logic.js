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
      inits: [...inits].sort((x, y) => x - y),
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

  // Schädliche Zustände, die die eigene Seite treffen (z. B. Heilung mit Betäubung): Preis der Aktion
  for (const c of half.drawbacks || []) {
    v -= (CONDITION_VALUE[c] ?? 1) * 0.8;
    const wen = half.heal && !/selbst/.test(half.text.join(' ')) ? 'den Geheilten' : 'die eigene Seite';
    add(c === 'stun' ? `${cn(c)} trifft ${wen} und kostet einen Zug` : `${cn(c)} trifft ${wen}`, false);
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
  // Ein Element, das du in diesem Zug erzeugst, ist erst ab dem Ende deines Zuges da.
  // Die andere Aktion desselben Zuges kann es also nicht verbrauchen.
  return { top, bottom, value, notes, gen, use };
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

// Reihenfolge der Runden im Zyklus: Aufbau zuerst, Elemente in einer Runde erzeugen und in der
// nächsten verbrauchen (dort sind sie noch schwindend vorhanden, danach verfallen sie).
function orderRounds(pairs, carried) {
  const rest = [...pairs];
  const out = [];
  let avail = new Set(carried);
  const needs = (p) => p.use;
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

// Wie oft bist du mit dieser Initiative vor den einzelnen Gegnertypen dran?
// Gezählt wird über die Karten des Monsterdecks. Bei Gleichstand sind Spieler zuerst dran.
export function initiativeOdds(profile, initiative) {
  return profile.groups.map((g) => {
    const d = profile.deckTraits[g.id];
    if (!d || !d.inits) return null;
    return {
      id: g.id, name: g.name, of: d.inits.length,
      before: d.inits.filter((i) => i >= initiative).length,
      count: g.types.reduce((a, t) => a + t.count, 0),
    };
  }).filter(Boolean).sort((a, b) => b.count - a.count);
}

// Geschätzte Szenariolänge in Runden: Gegnerleben (Schild zählt mit) geteilt durch
// den üblichen Gruppenschaden, plus Wege zwischen den Räumen. "factor" kommt aus
// euren eingetragenen Partien.
export function estimateRounds(profile, scenario, factor = 1) {
  if (!profile.enemies) return { rounds: 12, base: 12, known: false };
  let eff = 0;
  for (const g of profile.groups) for (const t of g.types) eff += t.count * (t.stats.hp + t.stats.shield * Math.ceil(t.stats.hp / 4));
  const perRound = profile.players * (2.5 + 0.6 * profile.level);
  const rooms = scenario && scenario.rooms ? scenario.rooms.length : 1;
  const base = Math.round(clamp(eff / perRound + rooms, 6, 28));
  return { rounds: Math.round(clamp(base * factor, 6, 30)), base, known: true };
}

// Verhältnis aus gespielten zu geschätzten Runden über eure Partien (Median)
export function calibration(results) {
  // nur gewonnene Partien: eine Niederlage sagt nichts über die Länge des Szenarios
  const ratios = Object.values(results || {}).filter((r) => r && r.won !== false && r.rounds > 0 && r.est > 0).map((r) => r.rounds / r.est).sort((a, b) => a - b);
  if (!ratios.length) return { factor: 1, n: 0 };
  const m = ratios.length;
  const mid = m % 2 ? ratios[(m - 1) / 2] : (ratios[m / 2 - 1] + ratios[m / 2]) / 2;
  return { factor: clamp(mid, 0.6, 1.7), n: m };
}

// Spielt die Hand komplett durch und liefert einen Rundenplan.
// opts.losses: wie viele Verlustaktionen eingeplant werden dürfen
// opts.target: geschätzte Szenariolänge. Ist sie bekannt, kommen Verlustaktionen früh.
// opts.longRest: lange Rasten (Karte frei wählbar, kostet eine Runde)
// opts.tank: du willst die Angriffe auf dich ziehen
// opts.restLosses: Karten-IDs, die bei den bisherigen Rasten tatsächlich verloren gingen (der Reihe nach)
// opts.events: Eingaben vom Tisch, je { after: Runde, type: 'lose' | 'rest' | 'elements', card, elements }.
//   Die Runden bis dahin bleiben, wie sie ohne die Eingabe wären, alles danach wird neu geplant.
//   type 'basic' mit side 'top' | 'bottom': in Runde "after" wurde von der Karte nur die Standardaktion gespielt.
// opts.eventBudgets: je Eingabe, wie viele Verlustaktionen danach noch eingeplant werden dürfen
// opts.staminaItems: getragene Ausdauertränke ({ id, name, n }), jeder holt einmal n abgeworfene Karten zurück.
//   Getrunken wird vor einer Rast, sobald daraus eine zusätzliche Runde wird.
export function gamePlan(cards, profile, opts = {}) {
  const cn = opts.conditionName;
  let budget = opts.losses ?? 2;
  const longRest = !!opts.longRest;
  const target = opts.target || 0;
  const tank = !!opts.tank;
  const val = {};
  for (const c of cards) val[c.id] = { top: scoreHalf(c.top, profile, cn), bottom: scoreHalf(c.bottom, profile, cn), card: scoreCard(c, profile, cn).score };
  const basicAttack = Math.max(0, 2 - profile.shieldAvg);
  const enemyInit = enemyInitiative(profile);
  const lossHalves = (pool) => pool.flatMap((c) => ['top', 'bottom'].filter((s) => c[s].lost).map((s) => ({ key: `${c.id}:${s}`, card: c, side: s, value: val[c.id][s].value, setup: isSetup(c[s]) })));
  // Bosskampf: die stärkste Angriffs-Verlustaktion bleibt für das Ende aufgehoben
  const held = profile.bosses && target
    ? lossHalves(cards).filter((x) => !x.setup && x.card[x.side].attacks.length).sort((a, b) => b.value - a.value)[0] : null;

  let hand = [...cards];
  let discard = [];
  const steps = [];
  let round = 0;
  let cycle = 0;
  let carried = [];
  let damage = 0;
  let xp = 0;
  const lostPlayed = [];
  const potions = [...(opts.staminaItems || [])];
  const restLosses = opts.restLosses || [];
  let restIndex = 0;

  // Eingaben vom Tisch: nach Runde "after" ging eine Karte verloren, wurde gerastet oder liegt ein Element aus.
  const events = (opts.events || []).map((e, index) => ({ ...e, index })).sort((a, b) => a.after - b.after || a.index - b.index);
  const eventBudgets = opts.eventBudgets || [];
  const due = () => events.some((e) => !e.done && e.type !== 'basic' && e.after === round);
  // Wendet alle Eingaben an, die nach der aktuellen Runde fällig sind. Liefert true, wenn gerastet werden soll.
  const applyEvents = () => {
    let rest = false;
    for (const e of events) {
      if (e.done || e.type === 'basic' || e.after !== round) continue;
      e.done = true;
      const reserve = target > 0 && round >= target;
      if (e.type === 'lose') {
        const card = [...hand, ...discard].find((c) => c.id === e.card);
        if (card) {
          hand = hand.filter((c) => c !== card);
          discard = discard.filter((c) => c !== card);
          steps.push({ type: 'event', kind: 'lose', index: e.index, n: round, card, reserve });
        }
      } else if (e.type === 'elements') {
        carried = [...new Set([...carried, ...(e.elements || [])])];
        steps.push({ type: 'event', kind: 'elements', index: e.index, n: round, elements: e.elements || [], reserve });
      } else if (e.type === 'rest') rest = e;
      // Ab hier dürfen nur noch so viele Verlustaktionen eingeplant werden, wie die Hand noch hergibt
      if (eventBudgets[e.index] != null) budget = Math.min(budget, eventBudgets[e.index]);
    }
    return rest;
  };

  for (let guard = 0; guard < 80; guard++) {
    let forced = applyEvents();
    if (forced && discard.length < 2) forced = false;
    if (!forced && hand.length >= 2) {
      // Welche Verlustaktionen sind in diesem Zyklus freigegeben?
      const enabled = new Set();
      const candidates = lossHalves(hand).sort((a, b) => b.value - a.value);
      let free = budget;
      if (cycle === 0) for (const c of candidates.filter((x) => x.setup).slice(0, Math.min(2, free))) { enabled.add(c.key); free--; }
      if (free > 0 && (target > 0 || hand.length <= 6)) {
        const c = candidates.find((x) => !x.setup && !enabled.has(x.key) && (!held || x.key !== held.key || round >= target - 5));
        if (c) enabled.add(c.key);
      }
      // Letzte Runde vor der Erschöpfung: Verlustaktionen kosten nichts mehr
      const lastRound = hand.length === 2 && discard.length === 0;
      if (lastRound) for (const c of candidates) enabled.add(c.key);

      const pairing = bestPairing(hand, val, enabled, basicAttack);
      const ordered = orderRounds(pairing.pairs, carried);
      carried = ordered.carried;
      let cut = false;
      for (let k = 0; k < ordered.rounds.length; k++) {
        const p = ordered.rounds[k];
        round++;
        // Eingabe: in dieser Runde wurde von einer Karte nur die Standardaktion gespielt.
        // Eine geplante Verlustaktion ist damit nicht verbraucht, die Karte bleibt im Spiel.
        const basicBy = {};
        for (const e of events) {
          if (e.done || e.type !== 'basic' || e.after !== round) continue;
          e.done = true;
          const x = p[e.side];
          if (x && !x.basic) {
            p[e.side] = { card: x.card, side: x.side, half: BASIC[x.side], value: x.side === 'top' ? basicAttack : 1.1, dmg: x.side === 'top' ? basicAttack : 0, basic: true };
            p.gen = [...(p.top.half.gen || []), ...(p.bottom.half.gen || [])];
            const use = [...(p.top.half.use || []), ...(p.bottom.half.use || [])];
            p.fed = (p.fed || []).filter((el) => use.includes(el));
            p.hungry = (p.hungry || []).filter((el) => use.includes(el));
            basicBy[e.side] = e.index;
          }
          if (eventBudgets[e.index] != null) budget = Math.min(budget, eventBudgets[e.index]);
        }
        const replan = Object.keys(basicBy).length > 0;
        const inis = [p.top.card.initiative, p.bottom.card.initiative].sort((a, b) => a - b);
        const halves = [p.top.half, p.bottom.half];
        const protect = halves.some((h) => (h.conditions || []).some((c) => ['stun', 'disarm', 'immobilize'].includes(c)) || h.heal || h.shield);
        const waitForThem = !tank && !protect && halves.some(melee) && !halves.some((h) => h.move >= 3) && profile.rangedShare < 0.5;
        const lead = waitForThem ? inis[1] : inis[0];
        const leadWhy = tank ? 'früh gehen, damit du vorn stehst und bei Gleichstand das Ziel bist'
          : waitForThem ? 'spät gehen und die Gegner herankommen lassen'
            : protect ? 'früh gehen, damit Schutz und Kontrolle vor den Gegnern wirken' : 'früh gehen und zuerst zuschlagen';
        const lostNow = [p.top, p.bottom].filter((x) => !x.basic && x.card[x.side].lost);
        const finale = lastRound;
        for (const x of lostNow) { if (!finale) budget--; lostPlayed.push(x.card.id); }
        damage += p.top.dmg + p.bottom.dmg;
        for (const x of [p.top, p.bottom]) if (!x.basic) xp += x.card[x.side].xp || 0;
        const gone = new Set(lostNow.map((x) => x.card.id));
        for (const c of [p.top.card, p.bottom.card]) if (!gone.has(c.id)) discard.push(c);
        const later = ordered.rounds.slice(k + 1).flatMap((x) => [x.top.card, x.bottom.card]);
        steps.push({
          type: 'round', n: round, cycle, value: round1(p.value), top: p.top, bottom: p.bottom,
          lead, other: lead === inis[0] ? inis[1] : inis[0], leadWhy, beforeEnemies: lead < enemyInit,
          odds: initiativeOdds(profile, lead),
          notes: p.notes, fed: p.fed || [], hungry: p.hungry || [],
          lost: lostNow.map((x) => x.card.id), finale, reserve: target > 0 && round > target,
          // was nach dieser Runde noch da ist: für Eingaben wie "Karte verloren" oder "hier rasten"
          pool: [...pairing.left, ...later, ...discard], canRest: discard.length >= 2, basicBy,
        });
        // Eine Eingabe nach dieser Runde: der Rest des Zyklus wird mit dem neuen Stand neu geplant
        if ((due() || replan) && k < ordered.rounds.length - 1) {
          hand = [...pairing.left, ...later];
          carried = [...p.gen];
          cut = true;
          break;
        }
      }
      if (cut) continue;
      hand = pairing.left;
      if (due()) continue;
      if (hand.length >= 2) continue;
    }
    // Ausdauertrank: vor der Rast die stärksten abgeworfenen Karten zurückholen und noch einmal spielen
    // Nur wenn daraus eine ganze Runde wird: mit einer zurückgeholten Karte braucht es noch eine auf der Hand.
    const potionAt = forced ? -1 : potions.findIndex((x) => discard.length >= (x.n || 1) && hand.length + (x.n || 1) >= 2);
    if (potionAt >= 0) {
      const [item] = potions.splice(potionAt, 1);
      const back = [...discard].sort((a, b) => val[b.id].card - val[a.id].card).slice(0, item.n || 1);
      discard = discard.filter((c) => !back.includes(c));
      hand = [...hand, ...back];
      steps.push({ type: 'item', n: round, item, cards: back, reserve: target > 0 && round >= target });
      continue;
    }
    if (discard.length < 2) break;
    // Rasten: die Karte abgeben, die für dieses Szenario am wenigsten bringt
    const worst = discard.reduce((b, c) => (val[c.id].card < val[b.id].card ? c : b), discard[0]);
    // opts.restLosses: was bei der 1., 2., ... Rast wirklich verloren ging (Karten-ID), sonst der Vorschlag
    const options = [...discard];
    const actual = discard.find((c) => c.id === restLosses[restIndex]);
    const lose = actual || worst;
    discard = discard.filter((c) => c !== lose);
    hand = [...hand, ...discard];
    discard = [];
    if (longRest) round++;
    steps.push({ type: 'rest', index: restIndex, long: longRest, n: longRest ? round : null, lose, suggest: worst, chosen: !!actual, options, handAfter: hand.length, reserve: target > 0 && round > target, early: forced ? forced.index : null });
    restIndex++;
    cycle++;
    carried = [];
    if (hand.length < 2) break;
  }

  const rounds = steps.filter((s) => s.type === 'round').length;
  return {
    steps, rounds, totalRounds: round, damage: Math.round(damage), share: Math.round(profile.hpTotal / profile.players),
    enemyInit, killOrder: killOrder(profile), lossesPlanned: lostPlayed.length, xp, itemsUsed: steps.filter((s) => s.type === 'item').length,
    target, spare: target ? round - target : null,
  };
}

// Plant so viele Verlustaktionen ein, wie die geschätzte Szenariolänge hergibt:
// der stärkste Plan, der noch "margin" Runden Reserve über dem Ziel lässt.
export function autoPlan(cards, profile, opts = {}) {
  const target = opts.target || 0;
  const margin = opts.margin ?? 2;
  const events = opts.events || [];
  let plan = null;
  let losses = 0;
  for (let b = 6; b >= 0; b--) {
    plan = gamePlan(cards, profile, { ...opts, events: [], losses: b });
    losses = b;
    if (plan.totalRounds >= target + margin) break;
  }
  const before = plan.totalRounds;
  const beforeLosses = plan.lossesPlanned;
  // Eingaben vom Tisch der Reihe nach: Der Plan bis zu einer Eingabe bleibt, wie er war. Danach
  // werden nur so viele Verlustaktionen eingeplant, wie die Hand nach der Eingabe noch hergibt.
  const eventBudgets = [];
  const order = events.map((e, index) => ({ e, index })).sort((a, b) => a.e.after - b.e.after || a.index - b.index);
  for (let k = 0; k < order.length; k++) {
    const active = events.map((e, index) => (order.slice(0, k + 1).some((o) => o.index === index) ? e : { ...e, after: -1 }));
    for (let b = k ? Math.min(...eventBudgets.filter((x) => x != null)) : losses; b >= 0; b--) {
      eventBudgets[order[k].index] = b;
      plan = gamePlan(cards, profile, { ...opts, events: active, eventBudgets, losses });
      if (plan.totalRounds >= target + margin) break;
    }
  }
  plan.auto = true;
  plan.enough = plan.totalRounds >= target;
  plan.before = events.length ? before : null;
  plan.beforeLosses = events.length ? beforeLosses : null;
  return plan;
}

// ---------- Gegenstände im Plan ----------

// Schlägt für jeden getragenen Gegenstand vor, wann er im Plan am meisten bringt.
// Liefert je Gegenstand { item, round, when, why }. round ist die Planrunde oder null.
export function itemPlan(plan, items, profile, opts = {}) {
  const en = opts.elementName || ((e) => e);
  const all = plan.steps.filter((s) => s.type === 'round');
  const rounds = all.some((s) => !s.reserve) ? all.filter((s) => !s.reserve) : all;
  const again = (item) => (item.use === 'spent' && opts.longRest ? ' Nach jeder langen Rast wieder einsetzbar.' : '');
  return (items || []).map((item) => {
    const t = item.tags || {};
    const out = (round, when, why) => ({ item, round, when, why: why + again(item) });
    if (t.stamina) {
      const step = plan.steps.find((s) => s.type === 'item' && s.item.id === item.id);
      if (!step) return out(null, 'Kurz bevor du rasten müsstest', 'Holt abgeworfene Karten zurück: eine Runde mehr.');
      return out(step.n, `Nach Runde ${step.n}, bevor du rastest`, step.cards.length === 1
        ? `Hol ${step.cards[0].name} zurück. Zusammen mit der Karte, die du noch auf der Hand hast, ist das eine Runde mehr.`
        : `Hol ${step.cards.map((c) => c.name).join(' und ')} zurück: eine Runde mehr, mit deinen stärksten Karten.`);
    }
    if (item.use === 'passive') return out(null, 'Wirkt dauerhaft', 'Nichts zu tun.');
    if (t.attack || t.pierce || t.advantage || (t.inflict || []).length || (t.selfBuff || []).includes('strengthen')) {
      let best = null;
      for (const s of rounds) for (const x of [s.top, s.bottom]) {
        if (!(x.dmg > 0) || !x.half.attacks.length) continue;
        if (t.needs && (t.needs === 'ranged') !== !!x.half.ranged) continue;
        if (!best || x.dmg > best.x.dmg) best = { s, x };
      }
      const grund = t.pierce && profile.shieldShare >= 0.25 ? 'Gegen den Schild der Gegner, auf deinem stärksten Angriff.'
        : (t.inflict || []).length ? 'Auf einen Angriff legen, der sicher trifft und ein wichtiges Ziel hat.'
          : 'Auf deinem stärksten Angriff bringt der Bonus am meisten.';
      if (!best) return out(null, 'Bei deinem stärksten Angriff', t.needs ? `Wirkt nur im ${t.needs === 'ranged' ? 'Fernkampf' : 'Nahkampf'}, dafür ist im Plan kein Angriff vorgesehen.` : grund);
      return out(best.s.n, `Runde ${best.s.n}, zusammen mit ${best.x.card.name}`, grund);
    }
    if (t.element) {
      const s = rounds.find((r) => r.hungry.length && (t.element === 'wild' || r.hungry.includes(t.element)));
      if (s) return out(s.n, `Runde ${s.n}`, `Liefert ${s.hungry.map(en).join(', ')} für den Bonus deiner Karten, den sonst ein Mitspieler vorbereiten müsste.`);
      return out(null, 'Wenn ein Bonus ein Element braucht', 'Im Plan versorgst du dich selbst, heb ihn für Mitspieler oder eine Planänderung auf.');
    }
    if (t.initiative) {
      let best = null;
      for (const s of rounds) {
        const o = s.odds[0];
        if (!o || !o.of) continue;
        const d = Math.abs(o.before / o.of - 0.5);
        if (!best || d < best.d) best = { s, d };
      }
      return best ? out(best.s.n, `Runde ${best.s.n}`, 'Hier ist es am knappsten, ob du vor den Gegnern dran bist.')
        : out(null, 'Wenn die Initiative knapp wird', 'Damit bist du gezielt vor oder nach den Gegnern dran.');
    }
    if (t.shield || t.noDamage || t.attackerDisadvantage || t.retaliate) {
      const s = rounds.find((r) => [r.top, r.bottom].some((x) => x.half.attacks.length && !x.half.ranged));
      const ab = s ? `Ab Runde ${s.n}, sobald du vorn stehst` : 'Sobald du angegriffen wirst';
      if (t.noDamage) return out(s ? s.n : null, ab, profile.bosses ? 'Für den schwersten Treffer aufheben, am besten für den Boss.' : 'Für den schwersten Einzeltreffer aufheben, nicht für Kleinkram.');
      if (t.shield) return out(s ? s.n : null, ab, `Zählt nur für die nächsten ${t.charges > 1 ? `${t.charges} Treffer` : 'Angriffe dieser Runde'}: einschalten, wenn mehrere Gegner auf dich gehen.`);
      return out(s ? s.n : null, ab, 'Einschalten, wenn mehrere Gegner auf dich gehen.');
    }
    if (t.move || t.jump) return out(rounds.length ? rounds[0].n : null, 'Runde 1 oder beim Wechsel in den nächsten Raum', t.jump ? 'Über Hindernisse und Gegner hinweg früh in Position kommen.' : 'Früh in Position kommen spart später eine ganze Bewegung.');
    if (t.heal) {
      const gift = (profile.inflicts.poison || 0) + (profile.inflicts.wound || 0) >= 0.2;
      return out(null, `Sobald dir ${t.heal} oder mehr Leben fehlen`, gift ? 'Hier sofort bei Gift oder Wunde trinken, die Heilung entfernt beides.' : 'Nicht bis zum letzten Leben warten, sonst kostet dich der nächste Treffer eine Karte.');
    }
    if (t.cure) return out(null, 'Sobald dich ein Zustand einen Zug kosten würde', 'Betäubung, Entwaffnen und Festhalten sind die teuren.');
    if (t.refresh) return out(null, 'Nachdem deine anderen Gegenstände verbraucht sind', 'Frischt sie wieder auf.');
    return out(null, 'Nach eigenem Ermessen', 'Sondereffekt, den die App nicht einordnen kann.');
  });
}

// ---------- Nach dem Szenario ----------

export const COIN_VALUE = [2, 2, 3, 3, 4, 4, 5, 6]; // Gold je Münze nach Szenariostufe

// Was ein Szenario einbringt. EP von Karten und Münzen behältst du auch bei einer Niederlage,
// den Szenario-Bonus (4 + 2 × Stufe) und Kampfziel-Haken gibt es nur bei einem Sieg.
export function scenarioReward({ level = 1, won = true, cardXp = 0, coins = 0, goal = 0 } = {}) {
  const n = (x, max) => Math.max(0, Math.min(max, Math.round(Number(x) || 0)));
  const lvl = n(level, 7);
  const bonus = won ? 4 + 2 * lvl : 0;
  const coinValue = COIN_VALUE[lvl];
  return { xp: n(cardXp, 99) + bonus, bonus, gold: n(coins, 99) * coinValue, coinValue, checks: won ? n(goal, 2) : 0 };
}

// ---------- Was bei dir ankommt ----------

// Mittlerer Schaden pro Aktivierung eines Gegners gegen dich, je nach deinem Schild.
// Gerechnet über alle Karten des Monsterdecks, ohne Angriffsmodifikatoren.
export function incomingDamage(data, profile, shields = [0, 1, 2, 3]) {
  const rows = [];
  for (const g of profile.groups) {
    const deck = data.decks[g.deck] || [];
    const cards = deck.length ? deck : [{ attacks: [{ rel: 0, pierce: 0 }] }];
    for (const t of g.types) {
      const s = t.stats;
      const hit = (a) => (a.abs != null ? a.abs : s.attack + (a.rel || 0));
      const per = shields.map((sh) => {
        let sum = 0;
        for (const c of cards) for (const a of c.attacks || []) sum += Math.max(0, hit(a) - Math.max(0, sh - s.pierce - (a.pierce || 0)));
        return round1(sum / cards.length);
      });
      const max = Math.max(0, ...cards.map((c) => (c.attacks || []).reduce((m, a) => m + Math.max(0, hit(a)), 0)));
      rows.push({
        id: g.id, name: g.name, type: t.type, count: t.count, per, max, pierce: s.pierce, ranged: s.range > 0,
        idle: cards.filter((c) => !(c.attacks || []).length).length, cards: cards.length,
      });
    }
  }
  const total = shields.map((_, i) => round1(rows.reduce((a, r) => a + r.per[i] * r.count, 0)));
  return { shields, rows, total };
}

// ---------- Erfahrung ----------

// Nötige Erfahrungspunkte für Stufe 1 bis 9
export const XP_LEVELS = [0, 45, 95, 150, 210, 275, 345, 420, 500];

export function xpLevel(xp) {
  let l = 1;
  while (l < 9 && xp >= XP_LEVELS[l]) l++;
  return l;
}

export function xpProgress(xp, level) {
  const lvl = clamp(level, 1, 9);
  const from = XP_LEVELS[lvl - 1];
  if (lvl >= 9) return { from, to: null, ratio: 1, missing: 0, ready: false };
  const to = XP_LEVELS[lvl];
  return { from, to, ratio: clamp((xp - from) / (to - from), 0, 1), missing: Math.max(0, to - xp), ready: xp >= to };
}

// ---------- Stufenaufstieg ----------

const profileCache = new Map();
function allProfiles(data, players, level) {
  const key = `${players}|${level}`;
  if (!profileCache.has(key)) {
    profileCache.set(key, data.scenarios.map((s) => scenarioProfile(data, s, players, level)).filter((p) => p.enemies > 0));
  }
  return profileCache.get(key);
}

// Vergleicht die Karten, die beim nächsten Stufenaufstieg zur Wahl stehen, über alle
// Szenarien: Um wie viel wird die beste Hand besser, und wie oft schafft es die Karte hinein?
export function levelUpAdvice(data, character, level, owned, players = 4, cn) {
  if (level >= 9) return null;
  const next = level + 1;
  const have = cardPool(character, level, owned);
  const haveIds = new Set(have.map((c) => c.id));
  const candidates = character.cards.filter((c) => c.level !== 'X' && c.level >= 2 && c.level <= next && !haveIds.has(c.id));
  const profiles = allProfiles(data, players, Math.ceil(next / 2));
  const stats = candidates.map((card) => ({ card, delta: 0, inHand: 0, score: 0, reasons: new Map() }));
  for (const p of profiles) {
    const base = suggestHand(have, p, character.handSize, { conditionName: cn });
    const baseScore = new Map(base.scored.map((x) => [x.card.id, x.s.score]));
    const baseValue = base.hand.reduce((a, id) => a + baseScore.get(id), 0);
    for (const st of stats) {
      const r = suggestHand([...have, st.card], p, character.handSize, { conditionName: cn });
      const sc = new Map(r.scored.map((x) => [x.card.id, x.s]));
      st.delta += Math.max(0, r.hand.reduce((a, id) => a + sc.get(id).score, 0) - baseValue);
      const own = sc.get(st.card.id);
      st.score += own.score;
      if (r.hand.includes(st.card.id)) st.inHand++;
      for (const w of own.why) if (w.good) st.reasons.set(w.text, (st.reasons.get(w.text) || 0) + 1);
    }
  }
  const n = Math.max(1, profiles.length);
  const out = stats.map((st) => ({
    card: st.card, isNew: st.card.level === next,
    delta: round1(st.delta / n), rate: st.inHand / n, score: round1(st.score / n),
    reasons: [...st.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text, count]) => ({ text, share: count / n })),
  })).sort((a, b) => b.delta - a.delta || b.score - a.score);
  return { next, xpNeeded: XP_LEVELS[next - 1], candidates: out, best: out[0] || null, scenarios: profiles.length };
}

// ---------- Verbesserungen ----------

// Grundkosten nach Regelheft (Gloomhaven, 1. Auflage)
export const ENHANCE_BASE = {
  plus1: { move: 30, attack: 50, range: 30, shield: 100, push: 30, pull: 30, pierce: 30, retaliate: 100, heal: 30, target: 50 },
  poison: 75, wound: 75, muddle: 50, immobilize: 100, disarm: 150, curse: 75, strengthen: 50, bless: 50,
  jump: 50, element: 100, wild: 150, hex: 200,
};
const NEGATIVE = ['poison', 'wound', 'muddle', 'immobilize', 'disarm', 'curse'];
const POSITIVE = ['strengthen', 'bless'];
const ELEMENTS = ['fire', 'ice', 'air', 'earth', 'light', 'dark'];

// Welche Aufkleber passen auf ein Verbesserungsfeld? Die Form des Feldes entscheidet:
// Quadrat nur +1, Kreis auch Elemente, Raute auch negative, Raute+ auch positive Zustände.
export function slotStickers(slot, half) {
  if (slot.shape === 'hex') return ['hex'];
  const out = [];
  if (ENHANCE_BASE.plus1[slot.on]) out.push('plus1');
  if (slot.on === 'move' && !half.jump) out.push('jump');
  if (slot.shape === 'diamond') out.push(...NEGATIVE);
  if (slot.shape === 'diamond_plus') out.push(...POSITIVE);
  if (slot.shape !== 'square') out.push(...ELEMENTS.map((e) => `el:${e}`), 'el:wild');
  return out;
}

// Kosten: Grundpreis (doppelt bei mehreren Zielen), +25 je Kartenstufe über 1,
// +75 je Verbesserung, die schon auf derselben Aktion klebt.
export function enhancementCost(sticker, slot, card, previous = 0) {
  let base;
  if (sticker === 'plus1') base = ENHANCE_BASE.plus1[slot.on] || 0;
  else if (sticker === 'hex') base = Math.ceil(ENHANCE_BASE.hex / Math.max(1, slot.hexes));
  else if (sticker === 'el:wild') base = ENHANCE_BASE.wild;
  else if (sticker.startsWith('el:')) base = ENHANCE_BASE.element;
  else base = ENHANCE_BASE[sticker] || 0;
  if (slot.multi && sticker !== 'hex' && !(sticker === 'plus1' && slot.on === 'target')) base *= 2;
  const level = card.level === 'X' ? 1 : card.level;
  return base + 25 * (level - 1) + 75 * previous;
}

const cloneHalf = (h) => ({ ...h, attacks: [...h.attacks], conditions: [...h.conditions], drawbacks: [...(h.drawbacks || [])], gen: [...h.gen], use: [...h.use], text: [...h.text], enh: [] });

// Rechnet gekaufte Verbesserungen in die Kartenwerte ein.
export function applyEnhancements(card, list) {
  const mine = (list || []).filter((e) => e.card === card.id);
  if (!mine.length) return card;
  const copy = { ...card, top: cloneHalf(card.top), bottom: cloneHalf(card.bottom) };
  for (const e of mine) {
    const half = copy[e.side];
    const slot = half && half.slots[e.slot];
    if (!slot) continue;
    const s = e.sticker;
    if (s === 'plus1') {
      if (slot.on === 'attack') { if (slot.ai >= 0 && slot.ai < half.attacks.length) half.attacks[slot.ai] += 1; }
      else if (slot.on === 'target') half.targets += 1;
      else if (slot.on !== 'range' && typeof half[slot.on] === 'number') half[slot.on] += 1;
    } else if (s === 'jump') half.jump = true;
    else if (s === 'hex') half.area += 1;
    else if (s.startsWith('el:')) half.gen = [...new Set([...half.gen, s.slice(3)])];
    else if (!half.conditions.includes(s)) half.conditions.push(s);
    half.enh.push({ sticker: s, on: slot.on });
  }
  return copy;
}

// Welche Verbesserungen bringen pro Gold am meisten? Faustregel: Nutzen pro Einsatz
// mal Einsätze pro Szenario (dauerhafte Effekte zählen vielfach, Verlustaktionen einmal).
export function enhancementAdvice(cards, enhancements, gold = 0) {
  const list = enhancements || [];
  const useCount = {};
  for (const c of cards) for (const h of [c.top, c.bottom]) for (const e of h.use) if (e !== 'wild') useCount[e] = (useCount[e] || 0) + 1;
  const wanted = Object.entries(useCount).sort((a, b) => b[1] - a[1])[0];
  const out = [];
  for (const card of cards) {
    for (const side of ['top', 'bottom']) {
      const half = card[side];
      const previous = list.filter((e) => e.card === card.id && e.side === side).length;
      const plays = half.lost ? 1 : 4; // so oft spielst du die Aktion ungefähr pro Szenario
      const targets = Math.min(3, Math.max(half.targets, half.area || 1, half.allTargets ? 3 : 1));
      half.slots.forEach((slot, index) => {
        if (list.some((e) => e.card === card.id && e.side === side && e.slot === index)) return;
        for (const sticker of slotStickers(slot, half)) {
          let benefit = 0;
          // Ein dauerhafter Schild wirkt bei jedem Treffer, alles andere nur beim Ausspielen
          const lasting = half.persistent && sticker === 'plus1' && (slot.on === 'shield' || slot.on === 'retaliate');
          const uses = lasting ? 10 : plays;
          if (sticker === 'plus1') {
            benefit = ({
              attack: targets, move: 0.55, heal: 0.6 * (half.healAllies ? 2 : 1), shield: 1.2 * (half.shieldAllies ? 1.5 : 1),
              retaliate: 1, range: 0.4, target: (half.attacks[0] || 2) * 0.8, pierce: 0.3, push: 0.3, pull: 0.3,
            })[slot.on] || 0;
          } else if (sticker === 'jump') benefit = 0.5;
          else if (sticker === 'hex') benefit = (half.attacks[0] || 2) * 0.7;
          else if (sticker.startsWith('el:')) benefit = wanted && wanted[1] >= 2 && sticker === `el:${wanted[0]}` && !half.gen.includes(wanted[0]) ? 1.2 : 0;
          else if (POSITIVE.includes(sticker)) benefit = (CONDITION_VALUE[sticker] || 1) * 0.5;
          else benefit = (CONDITION_VALUE[sticker] || 1) * 0.8 * (slot.on === 'attack' ? targets : 1);
          if (benefit <= 0) continue;
          const cost = enhancementCost(sticker, slot, card, previous);
          out.push({ card, side, index, slot, sticker, cost, value: round1(benefit * uses), ratio: (benefit * uses) / cost * 100, affordable: cost <= gold });
        }
      });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

// ---------- Gegenstände ----------

// Bewertet einen Gegenstand für ein Szenario. Grundlage sind grobe Merkmale aus dem
// Regeltext, deshalb nur als Orientierung gedacht.
export function scoreItem(item, p, cn = (c) => c, fit = null) {
  const t = item.tags || {};
  let v = 0;
  const why = [];
  const add = (x, text) => { v += x; if (text) why.push(text); };
  const bad = (p.inflicts.poison || 0) + (p.inflicts.wound || 0);
  if (t.stamina) add(2 + 2 * t.stamina, t.stamina === 1 ? 'Holt eine gespielte Karte zurück: oft eine Runde mehr und deine beste Aktion ein zweites Mal' : 'Holt gespielte Karten zurück: mehr Runden und deine beste Aktion ein zweites Mal');
  if (t.move) add(1.2 * t.move + (p.rangedShare >= 0.4 ? 1 : 0), p.rangedShare >= 0.4 ? 'Mehr Bewegung, um die Fernkämpfer zu erreichen' : 'Mehr Bewegung');
  if (t.jump) add(1.2, 'Über Hindernisse und Gegner hinweg');
  if (t.shield) {
    const crowd = p.biggestRoom >= p.players * 2 && p.attackAvg <= 3.5;
    add(1.3 * t.shield * (t.charges || 1) * (1 - p.pierceShare) + (crowd ? 1 : 0),
      p.pierceShare >= 0.2 ? 'Schild, aber Gegner durchbohren ihn teilweise' : crowd ? 'Schild gegen viele schwache Angriffe' : 'Schild gegen mehrere Treffer');
  }
  if (t.noDamage) add(3.5, p.bosses ? 'Verhindert einen ganzen Treffer, stark gegen den Boss' : 'Verhindert einen ganzen Treffer');
  if (t.attackerDisadvantage) add(2.2, 'Angreifer haben Nachteil');
  if (t.heal) add(0.5 * t.heal + (bad >= 0.2 ? 1.5 : 0), bad >= 0.2 ? 'Heilung entfernt Gift und Wunde' : 'Heilung im Notfall');
  if (t.attack) add(1.5 * t.attack + (p.bosses ? 0.5 : 0), p.bosses ? 'Mehr Schaden für den Boss' : 'Mehr Schaden');
  if (t.pierce) add(p.shieldShare >= 0.25 ? 3 : 0.5, p.shieldShare >= 0.25 ? 'Umgeht den Schild der Gegner' : '');
  if (t.advantage) add(1.5, 'Vorteil beim Angriff');
  if (t.range) add(0.8 * t.range + (p.retaliateShare >= 0.2 ? 1 : 0), p.retaliateShare >= 0.2 ? 'Mehr Reichweite, um Vergeltung zu umgehen' : 'Mehr Reichweite');
  if (t.retaliate) add(t.retaliate * (1 - p.rangedShare), 'Vergeltung gegen Nahkämpfer');
  for (const c of t.inflict || []) {
    let cv = CONDITION_VALUE[c] ?? 1;
    if (p.immunities.includes(c)) cv *= 1 - p.bossHpShare;
    if ((c === 'poison' || c === 'wound') && p.shieldShare >= 0.25) cv += 1;
    add(cv, `Verteilt ${cn(c)}`);
  }
  for (const c of t.immune || []) {
    const share = p.inflicts[c] || 0;
    add(share >= 0.2 ? 3 : share > 0 ? 1.5 : 0.2, share > 0 ? `Gegner verteilen ${cn(c)}, du bist immun` : '');
  }
  for (const c of t.selfBuff || []) add(c === 'invisible' ? 2.5 : 1.5, c === 'invisible' ? 'Unsichtbar: Gegner können dich nicht angreifen' : `Gibt dir ${cn(c)}`);
  if (t.cure) add(Object.values(p.inflicts).some((x) => x >= 0.2) ? 2.5 : 0.5, 'Entfernt Zustände');
  if (t.refresh) add(1.5, 'Frischt Gegenstände auf');
  if (t.element) add(0.5, '');
  if (t.initiative) add(t.initiative / 10, 'Initiative verschieben: gezielt vor oder nach den Gegnern dran sein');
  if (t.noCrit) add(2.2, 'Gegnerische ×2-Treffer zählen nur als +0');
  if (t.minusOne) add(-0.4 * t.minusOne, `Bringt ${t.minusOne}× −1 ins Angriffsdeck`);
  if (item.use === 'passive') v *= 1.4;
  else if (item.use === 'spent') v *= 1.2;
  if (v <= 0 && !why.length) { v = 1; why.push('Sondereffekt, bitte selbst einschätzen'); }
  // Passt der Gegenstand zu deinen Karten?
  if (t.needs && fit && fit[t.needs] < 2) {
    v *= 0.25;
    why.unshift(t.needs === 'ranged' ? 'Wirkt nur bei Fernangriffen, davon hast du kaum welche' : 'Wirkt nur im Nahkampf, davon hast du kaum Angriffe');
  }
  return { score: round1(Math.max(0, v)), why: why.filter(Boolean).slice(0, 3) };
}

// Wie viele wiederholbare Nah- und Fernangriffe stecken in deinen Karten?
export function attackFit(cards) {
  const fit = { melee: 0, ranged: 0 };
  for (const c of cards) for (const h of [c.top, c.bottom]) if (h.attacks.length && !h.lost) fit[h.ranged ? 'ranged' : 'melee']++;
  return fit;
}

// Wohlstand: so viele Punkte (Kreuze auf der Karte) braucht die Stadt für Stufe 1 bis 9
export const PROSPERITY_STEPS = [0, 4, 9, 15, 22, 30, 39, 50, 64];

// Stufe zu einer Punktzahl, dazu wie viele Punkte bis zur nächsten Stufe fehlen (null auf Stufe 9)
export function prosperityLevel(points = 0) {
  const p = Math.max(0, Math.min(PROSPERITY_STEPS[8], Math.round(Number(points) || 0)));
  let level = 1;
  while (level < 9 && p >= PROSPERITY_STEPS[level]) level++;
  return { points: p, level, missing: level < 9 ? PROSPERITY_STEPS[level] - p : null };
}

// Preisänderung im Laden durch das Ansehen der Gruppe (Gruppenbogen, „Ladenpreis-Modifikator“): ab ±3 je vier Punkte 1 Gold,
// bei gutem Ansehen billiger, bei schlechtem teurer, höchstens 5 Gold.
export function reputationPriceChange(reputation = 0) {
  const r = Math.max(-20, Math.min(20, Math.round(Number(reputation) || 0)));
  const stufe = Math.abs(r) < 3 ? 0 : Math.min(5, Math.floor((Math.abs(r) - 3) / 4) + 1);
  return !stufe ? 0 : r > 0 ? -stufe : stufe;
}

// Kaufpreis eines Gegenstands bei diesem Ansehen. Verkauft wird immer zum halben aufgedruckten Preis.
export function itemPrice(item, reputation = 0) {
  return Math.max(0, item.cost + reputationPriceChange(reputation));
}

// Kaufempfehlung: was es bei eurer Wohlstandsstufe im Laden gibt, sortiert nach Nutzen.
export function shopAdvice(data, p, opts = {}) {
  const { gold = 0, prosperity = 1, reputation = 0, owned = [], cn, cards = null } = opts;
  const fit = cards ? attackFit(cards) : null;
  return (data.items || [])
    .filter((it) => it.prosperity > 0 && it.prosperity <= prosperity && !owned.includes(it.id))
    .map((item) => { const price = itemPrice(item, reputation); return { item, ...scoreItem(item, p, cn, fit), price, affordable: price <= gold }; })
    .sort((a, b) => b.score - a.score);
}

// ---------- Angriffsmodifikator-Deck ----------

// Das Grunddeck: 6× +0, 5× +1, 5× −1, je einmal +2, −2, ×2 und Fehlschlag
export function baseDeck() {
  const card = (v, n) => Array.from({ length: n }, () => ({ v, k: `${v >= 0 ? '+' : ''}${v}` }));
  return [...card(0, 6), ...card(1, 5), ...card(-1, 5), ...card(2, 1), ...card(-2, 1), { v: 0, x: 2, k: 'x2' }, { v: 0, x: 0, k: 'x0' }];
}

// Baut das Deck aus den gewählten Perks. "taken" zählt je Perk, wie oft er genommen wurde.
// "itemMinus" sind −1-Karten aus getragener Rüstung.
export function buildDeck(perks, taken = [], itemMinus = 0) {
  const cards = baseDeck();
  let ignoreItem = false;
  let ignoreScenario = false;
  (perks || []).forEach((perk, i) => {
    const times = Math.min(perk.count, Math.max(0, taken[i] || 0));
    for (let t = 0; t < times; t++) {
      for (const c of perk.remove) {
        const at = cards.findIndex((d) => d.k === c.k);
        if (at >= 0) cards.splice(at, 1);
      }
      for (const c of perk.add) cards.push({ v: c.v, r: c.r, fx: c.fx, k: c.k });
      if (perk.item) ignoreItem = true;
      if (perk.scenario) ignoreScenario = true;
    }
  });
  if (!ignoreItem) for (let i = 0; i < itemMinus; i++) cards.push({ v: -1, k: '-1', item: true });
  return { cards, ignoreItem, ignoreScenario };
}

// Was ein Zusatzeffekt auf einer Modifikatorkarte ungefähr wert ist (in Schadenspunkten)
const FX_VALUE = {
  stun: 3, disarm: 2.5, immobilize: 1.8, muddle: 1.5, wound: 1.5, poison: 1.5, curse: 1.5, invisible: 2.5,
  target: 3, heal: 0.6, shield: 1.2, pierce: 0.2, push: 0.3, pull: 0.3, element: 0.3, refresh: 2,
};
const fxValue = (f) => (FX_VALUE[f.k] ?? 0.5) * (['heal', 'pierce', 'push', 'pull'].includes(f.k) ? f.n || 1 : 1);

// Kennzahlen des Decks für einen Angriff mit Grundwert "attack".
// Rollende Karten werden weitergezogen: jede kommt mit Wahrscheinlichkeit 1/(N+1)
// vor der ersten nicht rollenden Karte (N = Zahl der nicht rollenden Karten).
export function deckStats(deck, attack = 3) {
  const cards = deck.cards;
  const term = cards.filter((c) => !c.r);
  const roll = cards.filter((c) => c.r);
  const n = Math.max(1, term.length);
  const rollBonus = roll.reduce((a, c) => a + c.v, 0) / (n + 1);
  let sum = 0;
  for (const c of term) sum += c.x === 2 ? 2 * (attack + rollBonus) : c.x === 0 ? 0 : Math.max(0, attack + rollBonus + c.v);
  const share = (f) => term.filter(f).length / n;
  const effects = {};
  let effectValue = 0;
  for (const c of cards) {
    const p = c.r ? 1 / (n + 1) : 1 / n;
    for (const f of c.fx || []) {
      const key = f.k === 'element' ? `element:${f.e}` : f.n ? `${f.k}:${f.n}` : f.k;
      effects[key] = (effects[key] || 0) + p;
      effectValue += p * fxValue(f);
    }
  }
  const counts = {};
  for (const c of cards) counts[c.k] = (counts[c.k] || 0) + 1;
  return {
    size: cards.length, rolling: roll.length, avg: sum / n, mod: sum / n - attack, rollBonus,
    miss: share((c) => c.x === 0), crit: share((c) => c.x === 2),
    worse: share((c) => c.x === 0 || (c.x == null && c.v < 0)),
    better: share((c) => c.x === 2 || (c.x == null && c.v > 0)),
    effects, effectValue, counts,
  };
}

// Welcher Perk bringt als nächster am meisten? Verglichen wird das Deck vorher und nachher:
// mittlerer Schaden, Wert der Zusatzeffekte und wie oft eine schlechte Karte kommt.
export function perkAdvice(perks, taken = [], itemMinus = 0, attack = 3) {
  const now = deckStats(buildDeck(perks, taken, itemMinus), attack);
  const out = [];
  (perks || []).forEach((perk, index) => {
    if ((taken[index] || 0) >= perk.count) return;
    const next = [...taken];
    next[index] = (next[index] || 0) + 1;
    const after = deckStats(buildDeck(perks, next, itemMinus), attack);
    const dAvg = after.avg - now.avg;
    const dFx = after.effectValue - now.effectValue;
    const dWorse = now.worse - after.worse;
    let gain = dAvg + dFx + 0.5 * dWorse;
    if (perk.scenario) gain += 0.05; // lässt sich nicht rechnen, hilft nur in manchen Szenarien
    out.push({ index, perk, gain, dAvg, dFx, dWorse, before: now, after });
  });
  return { now, list: out.sort((a, b) => b.gain - a.gain) };
}

// Nächster Perk laut Guide: der erste aus der Reihenfolge, von dem noch einer frei ist.
// Ein Tausch-Perk wird übersprungen, solange die zu tauschende Karte nicht im Deck ist.
export function guidePerk(perks, taken = [], order = []) {
  const deck = buildDeck(perks, taken).cards;
  for (const key of order) {
    const index = (perks || []).findIndex((p) => p.key === key);
    if (index < 0 || (taken[index] || 0) >= perks[index].count) continue;
    const need = {};
    for (const c of perks[index].remove) need[c.k] = (need[c.k] || 0) + 1;
    if (Object.entries(need).some(([kk, n]) => deck.filter((d) => d.k === kk).length < n)) continue;
    return index;
  }
  return -1;
}

// Wie viele Perks stehen einem Charakter zu? Einer je Stufenaufstieg, einer je drei Kampfziel-Haken.
export const perksAllowed = (level, checks = 0) => Math.max(0, level - 1) + Math.floor(Math.max(0, checks) / 3);
