#!/usr/bin/env node
// Liest die Spieldaten aus einem Checkout von "Gloomhaven Secretariat" (GHS)
// und schreibt eine kompakte gamedata.json für den Planer.
//
// Aufruf: node scripts/import-data.mjs <pfad-zu-ghs> [ausgabe.json]
//
// Die Spieldaten selbst liegen bewusst NICHT in diesem Repo, sie werden beim
// Docker-Build frisch aus GHS geholt (siehe Dockerfile).

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ghsDir = process.argv[2];
const outFile = process.argv[3] || 'data/gamedata.json';
if (!ghsDir || !existsSync(join(ghsDir, 'data', 'gh'))) {
  console.error('Aufruf: node scripts/import-data.mjs <pfad-zu-ghs> [ausgabe.json]');
  process.exit(1);
}

const GH = join(ghsDir, 'data', 'gh');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readDir = (p) => readdirSync(p).filter((f) => f.endsWith('.json')).sort();
const maybe = (p) => (existsSync(p) ? readJson(p) : {});

// ---------- Texte ----------
const de = maybe(join(GH, 'label', 'de.json'));
const en = maybe(join(GH, 'label', 'en.json'));
const deSp = maybe(join(GH, 'label', 'spoiler', 'de.json'));
const enSp = maybe(join(GH, 'label', 'spoiler', 'en.json'));
const appDe = maybe(join(ghsDir, 'src', 'assets', 'locales', 'de.json')).game || {};

const str = (v) => (v && typeof v === 'object' ? v[''] : v);
const dig = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
const firstOf = (path, sources) => {
  for (const s of sources) {
    const v = str(dig(s, path));
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
};

const term = (group, key, fallback) => str(dig(appDe, [group, key])) || fallback || key;
const COND = (c) => term('condition', c, c).replace('Verwirrrung', 'Verwirrung');
const ELEM = (e) => term('element', e, e);
const ACTION = {
  attack: term('action', 'attack', 'Angriff'),
  move: term('action', 'move', 'Bewegung'),
  heal: term('action', 'heal', 'Heilen'),
  shield: 'Schild',
  retaliate: 'Vergeltung',
  range: term('action', 'range', 'Reichweite'),
  target: 'Ziele',
  pierce: 'Durchbohren',
  push: term('action', 'push', 'Schieben'),
  pull: term('action', 'pull', 'Ziehen'),
  jump: term('action', 'jump', 'Springen'),
  loot: term('action', 'loot', 'Beute'),
  summon: 'Beschwören',
  sufferDamage: 'Erleide Schaden',
};

const monsterName = (id) => firstOf(['monster', id], [de, en]) || id;

function resolveText(text, depth = 0) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/%([^%]+)%/g, (_, raw) => {
      const [key, arg] = raw.split(':');
      const p = key.split('.');
      if (p[0] === 'data') {
        if (depth > 3) return '';
        const path = p.slice(1);
        const v = firstOf(path, [de, deSp, en, enSp]);
        return v ? resolveText(v, depth + 1) : '';
      }
      if (p[0] !== 'game') return '';
      if (p[1] === 'action') {
        const name = ACTION[p[2]] || p[2];
        if (p[3] === 'valueSign') return `${Number(arg) > 0 ? '+' : ''}${arg} ${name}`;
        return arg ? `${name} ${arg}` : name;
      }
      if (p[1] === 'condition') return COND(p[2]);
      if (p[1] === 'element') return p[2] === 'consume' ? `${ELEM(p[3])} verbrauchen` : ELEM(p[2]);
      if (p[1] === 'card' && p[2] === 'experience') return `${arg || ''} EP`.trim();
      if (p[1] === 'card') return '';
      if (p[1] === 'damage') return arg ? `${arg} Schaden` : 'Schaden';
      if (p[1] === 'custom' && p[2] === 'advantage') return 'Vorteil';
      if (p[1] === 'custom' && p[2] === 'disadvantage') return 'Nachteil';
      if (p[1] === 'specialTarget' && p[2] === 'self') return 'selbst';
      if (p[1] === 'mapMarker') return (p[2] || '').toUpperCase();
      return '';
    })
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

// ---------- Aktionen auswerten ----------
const TARGET_TEXT = [
  [/^self$/, 'selbst'],
  [/^selfAllies.*Adjacent/, 'selbst und angrenzende Verbündete'],
  [/^selfAllies.*Range:(\d+)/, 'selbst und Verbündete in Reichweite $1'],
  [/^selfAllies/, 'selbst und alle Verbündeten'],
  [/^enemiesAdjacent/, 'alle angrenzenden Gegner'],
  [/^enemyAdjacent/, 'ein angrenzender Gegner'],
  [/^enemiesRange(?:Exact)?:(\d+)/, 'alle Gegner in Reichweite $1'],
  [/^enemiesMovedThrough/, 'alle durchquerten Gegner'],
  [/^enemies/, 'alle Gegner'],
  [/^allies.*Adjacent/, 'alle angrenzenden Verbündeten'],
  [/^allies.*Range.*:(\d+)/, 'alle Verbündeten in Reichweite $1'],
  [/^alliesEnemies/, 'alle Verbündeten und Gegner'],
  [/^allies/, 'alle Verbündeten'],
  [/^ally.*Adjacent/, 'ein angrenzender Verbündeter'],
  [/^ally.*Range:(\d+)/, 'ein Verbündeter in Reichweite $1'],
  [/^ally/, 'ein Verbündeter'],
];
function targetText(value) {
  const v = String(value);
  for (const [re, text] of TARGET_TEXT) {
    const m = v.match(re);
    if (m) return text.replace('$1', m[1] || '');
  }
  return v;
}

const emptyHalf = () => ({
  lost: false, persistent: false, round: false, xp: 0,
  attacks: [], ranged: false, area: 0, targets: 1, allTargets: false,
  move: 0, jump: false, heal: 0, healAllies: false, shield: 0, shieldAllies: false,
  retaliate: 0, pierce: 0, push: 0, pull: 0, loot: 0, summon: false,
  conditions: [], gen: [], use: [], text: [],
});

function signed(a) {
  if (a.valueType === 'plus' || a.valueType === 'add') return `+${a.value}`;
  if (a.valueType === 'minus' || a.valueType === 'subtract') return `-${a.value}`;
  return `${a.value}`;
}

// Geht den Aktionsbaum durch. "ctx" merkt sich, zu welcher Hauptaktion
// Unteraktionen (Reichweite, Zustände, Ziele) gehören.
function walk(actions, half, ctx) {
  const out = [];
  for (const a of actions || []) {
    const sub = a.subActions || [];
    const num = typeof a.value === 'number' ? a.value : parseInt(a.value, 10) || 0;
    switch (a.type) {
      case 'attack': {
        // "+1 Angriff" als Bonus (z. B. nach Elementverbrauch) ist kein eigener Angriff
        const isBonus = a.valueType === 'plus' || a.valueType === 'minus' || a.valueType === 'add';
        if (!isBonus) half.attacks.push(num);
        const inner = walk(sub, half, { kind: 'attack' });
        out.push([`${ACTION.attack} ${signed(a)}`, ...inner].join(', '));
        break;
      }
      case 'move':
        if (!ctx) half.move = Math.max(half.move, num);
        out.push([`${ACTION.move} ${signed(a)}`, ...walk(sub, half, { kind: 'move' })].join(', '));
        break;
      case 'jump':
        half.jump = true;
        out.push(ACTION.jump, ...walk(sub, half, ctx));
        break;
      case 'heal': {
        half.heal = Math.max(half.heal, num);
        const inner = walk(sub, half, { kind: 'heal' });
        out.push([`${ACTION.heal} ${signed(a)}`, ...inner].join(', '));
        break;
      }
      case 'shield': {
        half.shield = Math.max(half.shield, num);
        const inner = walk(sub, half, { kind: 'shield' });
        out.push([`${ACTION.shield} ${signed(a)}`, ...inner].join(', '));
        break;
      }
      case 'retaliate':
        half.retaliate = Math.max(half.retaliate, num);
        out.push([`${ACTION.retaliate} ${signed(a)}`, ...walk(sub, half, { kind: 'retaliate' })].join(', '));
        break;
      case 'range':
        if (ctx && ctx.kind === 'attack' && num > 1) half.ranged = true;
        out.push(`${ACTION.range} ${signed(a)}`, ...walk(sub, half, ctx));
        break;
      case 'target':
        if (ctx && ctx.kind === 'attack') half.targets = Math.max(half.targets, num || 1);
        out.push(`${ACTION.target} ${signed(a)}`, ...walk(sub, half, ctx));
        break;
      case 'pierce':
        half.pierce = Math.max(half.pierce, num);
        out.push(`${ACTION.pierce} ${signed(a)}`);
        break;
      case 'push':
        half.push = Math.max(half.push, num);
        out.push(`${ACTION.push} ${signed(a)}`);
        break;
      case 'pull':
        half.pull = Math.max(half.pull, num);
        out.push(`${ACTION.pull} ${signed(a)}`);
        break;
      case 'loot':
        half.loot = Math.max(half.loot, num);
        out.push(`${ACTION.loot} ${signed(a)}`);
        break;
      case 'sufferDamage':
        out.push(`Erleide ${a.value} Schaden`);
        break;
      case 'summon':
        half.summon = true;
        out.push(ACTION.summon);
        break;
      case 'area': {
        const n = (String(a.value).match(/target/g) || []).length;
        half.area = Math.max(half.area, n);
        out.push(`Fläche (${n} Felder)`);
        break;
      }
      case 'condition': {
        const c = String(a.value).split(':')[0];
        if (!half.conditions.includes(c)) half.conditions.push(c);
        const inner = walk(sub, half, { kind: 'condition' });
        out.push([COND(c), ...inner].join(', '));
        break;
      }
      case 'element': {
        const els = String(a.value).split(':');
        const names = els.map(ELEM).join(' + ');
        if (a.valueType === 'minus') {
          for (const e of els) half.use.push(e);
          const inner = walk(sub, half, ctx);
          out.push(inner.length ? `${names} verbrauchen: ${inner.join(', ')}` : `${names} verbrauchen`);
        } else {
          for (const e of els) half.gen.push(e);
          out.push(`erzeugt ${names}`);
        }
        break;
      }
      case 'specialTarget': {
        const v = String(a.value);
        if (/^enemies/.test(v) && ctx && ctx.kind === 'attack') half.allTargets = true;
        if (/all(y|ies)/i.test(v) && ctx) {
          if (ctx.kind === 'heal') half.healAllies = true;
          if (ctx.kind === 'shield') half.shieldAllies = true;
        }
        out.push(`Ziel: ${targetText(v)}`, ...walk(sub, half, ctx));
        break;
      }
      case 'card': {
        const [k, n] = String(a.value).split(':');
        if (k === 'lost') half.lost = true;
        else if (k === 'persistent') half.persistent = true;
        else if (k === 'round') half.round = true;
        else if (k === 'experience') half.xp += Number(n) || 0;
        break;
      }
      case 'custom': {
        const t = resolveText(String(a.value));
        const inner = walk(sub, half, ctx);
        if (t) out.push([t, ...inner].join(' '));
        else out.push(...inner);
        break;
      }
      default:
        // concatenation, box, grid, hint …: nur der Inhalt zählt
        out.push(...walk(sub, half, ctx));
    }
  }
  return out.filter(Boolean);
}

function summarize(actions, lostFlag) {
  const half = emptyHalf();
  half.text = walk(actions, half, null);
  if (lostFlag) half.lost = true;
  half.gen = [...new Set(half.gen)];
  return half;
}

// ---------- Klassen und Karten ----------
// Ordnerkürzel der Kartenbilder im Worldhaven-Projekt
const WORLDHAVEN_CODE = {
  brute: 'br', tinkerer: 'ti', spellweaver: 'sw', scoundrel: 'sc', cragheart: 'ch', mindthief: 'mt',
  sun: 'sk', 'three-spears': 'qm', circles: 'su', eclipse: 'ns', squidface: 'ph', lightning: 'be',
  'music-note': 'ss', 'angry-face': 'ds', saw: 'sb', triangles: 'el', 'two-mini': 'bt',
};
const slug = (name) => name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const characters = [];
for (const file of readDir(join(GH, 'character'))) {
  const c = readJson(join(GH, 'character', file));
  const deckFile = join(GH, 'character', 'deck', file);
  if (!existsSync(deckFile)) continue;
  const deck = readJson(deckFile);
  const code = WORLDHAVEN_CODE[c.name];
  characters.push({
    id: c.name,
    name: firstOf(['character', 'gh', c.name], [de, deSp, en, enSp]) || c.name,
    nameEn: firstOf(['character', 'gh', c.name], [en, enSp]) || c.name,
    locked: !!c.spoiler,
    handSize: c.handSize,
    color: c.color,
    health: (c.stats || []).sort((a, b) => a.level - b.level).map((s) => s.health),
    cards: deck.abilities.map((a) => ({
      id: a.cardId,
      name: firstOf(['ability', a.name], [de]) || a.name,
      nameEn: a.name,
      level: a.level === 'X' ? 'X' : Number(a.level),
      initiative: a.initiative,
      top: summarize(a.actions, a.lost),
      bottom: summarize(a.bottomActions, a.bottomLost),
      img: code ? `${code}/gh-${slug(a.name)}.png` : null,
    })),
  });
}

// ---------- Monster ----------
function monsterStat(base, s, isBoss) {
  const merged = { ...base, ...s };
  const acts = [...(base.actions || []), ...(s.actions || [])];
  const st = {
    hp: merged.health ?? 0, move: merged.movement ?? 0, attack: merged.attack ?? 0, range: merged.range ?? 0,
    shield: 0, retaliate: 0, retaliateRange: 0, targets: 1, pierce: 0, conditions: [], advantage: false, disadvantage: false,
  };
  for (const a of acts) {
    if (a.type === 'shield') st.shield = a.value;
    else if (a.type === 'retaliate') {
      st.retaliate = a.value;
      const r = (a.subActions || []).find((x) => x.type === 'range');
      if (r) st.retaliateRange = r.value;
    } else if (a.type === 'target') st.targets = a.value;
    else if (a.type === 'pierce') st.pierce = a.value;
    else if (a.type === 'range') st.range = a.value;
    else if (a.type === 'condition') st.conditions.push(a.value);
    else if (a.type === 'custom' && /disadvantage/.test(a.value)) st.disadvantage = true;
    else if (a.type === 'custom' && /advantage/.test(a.value)) st.advantage = true;
  }
  return st;
}

const monsters = {};
for (const file of readDir(join(GH, 'monster'))) {
  const m = readJson(join(GH, 'monster', file));
  const base = m.baseStat || {};
  const { type: _t, immunities, special, note: _n, ...baseVals } = base;
  const levels = { normal: [], elite: [], boss: [] };
  for (const s of m.stats || []) {
    const type = s.type || base.type || 'normal';
    if (!levels[type]) continue;
    levels[type][s.level] = monsterStat(baseVals, s, !!m.boss);
  }
  const specials = (special || []).map((sp) => walk(sp, emptyHalf(), null).join(', ')).filter(Boolean);
  monsters[m.name] = {
    id: m.name,
    name: resolveText(monsterName(m.name)),
    boss: !!m.boss,
    flying: !!m.flying,
    deck: m.deck || m.name,
    immunities: immunities || [],
    specials,
    normal: levels.normal, elite: levels.elite, bossStats: levels.boss,
  };
}

const decks = {};
for (const file of readDir(join(GH, 'monster', 'deck'))) {
  const d = readJson(join(GH, 'monster', 'deck', file));
  decks[d.name] = d.abilities.map((a) => {
    const half = emptyHalf();
    const text = walk(a.actions, half, null);
    return {
      initiative: a.initiative, shuffle: !!a.shuffle, text,
      shield: half.shield, heal: half.heal, retaliate: half.retaliate,
      conditions: half.conditions, ranged: half.ranged, area: half.area > 0,
    };
  });
}

// ---------- Szenarien ----------
const scenarios = [];
for (const file of readDir(join(GH, 'scenarios'))) {
  const s = readJson(join(GH, 'scenarios', file));
  if (s.group || !/^\d+$/.test(s.index)) continue; // Solo- und Zufallsszenarien weglassen
  const rooms = (s.rooms || []).map((r) => {
    const counts = { 2: {}, 3: {}, 4: {} };
    for (const m of r.monster || []) {
      for (const p of [2, 3, 4]) {
        const type = m.type || m[`player${p}`];
        if (!type) continue;
        const c = (counts[p][m.name] ||= { normal: 0, elite: 0, boss: 0 });
        c[type] = (c[type] || 0) + 1;
      }
    }
    return { n: r.roomNumber, ref: r.ref || '', initial: !!r.initial, counts };
  });
  scenarios.push({
    id: Number(s.index),
    name: firstOf(['scenario', 'title', 'gh', s.index], [de]) || s.name,
    nameEn: s.name,
    monsters: s.monsters || [],
    allies: s.allies || [],
    rooms,
  });
}
scenarios.sort((a, b) => a.id - b.id);

// ---------- Ausgabe ----------
const conditionNames = {};
for (const c of ['stun', 'immobilize', 'disarm', 'wound', 'muddle', 'poison', 'curse', 'bless', 'strengthen', 'invisible']) {
  conditionNames[c] = COND(c);
}
const elementNames = {};
for (const e of ['fire', 'ice', 'air', 'earth', 'light', 'dark', 'wild']) elementNames[e] = ELEM(e);

const out = {
  source: 'Gloomhaven Secretariat (github.com/Lurkars/gloomhavensecretariat), Daten: CC BY-NC-SA 4.0 / Cephalofair Games',
  imported: new Date().toISOString().slice(0, 10),
  imageBase: 'https://raw.githubusercontent.com/any2cards/worldhaven/master/images/character-ability-cards/gloomhaven/',
  conditionNames, elementNames,
  characters, monsters, decks, scenarios,
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out));
console.log(
  `gamedata geschrieben: ${characters.length} Klassen, ${characters.reduce((n, c) => n + c.cards.length, 0)} Karten, ` +
  `${Object.keys(monsters).length} Monster, ${scenarios.length} Szenarien -> ${outFile}`,
);
