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
import { fileURLToPath } from 'node:url';

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
// Eigene Übersetzungen haben Vorrang vor allem, was GHS liefert
const own = maybe(join(dirname(fileURLToPath(import.meta.url)), 'uebersetzungen', 'de.json'));
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
  heal: 'Heilung', // wie auf den gedruckten deutschen Karten
  shield: 'Schild',
  retaliate: 'Vergeltung',
  range: term('action', 'range', 'Reichweite'),
  target: 'Ziele',
  pierce: 'Durchbohren',
  push: term('action', 'push', 'Schieben'),
  pull: term('action', 'pull', 'Ziehen'),
  jump: term('action', 'jump', 'Springen'),
  fly: 'Fliegen',
  loot: term('action', 'loot', 'Beute'),
  summon: 'Beschwören',
  sufferDamage: 'Erleide Schaden',
};

const SLOT_NAME = { head: 'Kopf', body: 'Körper', legs: 'Beine', onehand: 'Einhand', twohand: 'Zweihand', small: 'Klein' };
const monsterName = (id) => firstOf(['monster', id], [de, en]) || id;

function resolveText(text, depth = 0) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/%([^%]+)%/g, (_, raw) => {
      const [key, arg] = raw.split(':');
      const p = key.split('.');
      if (p[0] === 'data' && p[1] === 'characterColored') return arg || '';
      if (p[0] === 'data') {
        if (depth > 3) return '';
        const path = p.slice(1);
        const v = firstOf(path, [own, de, deSp, en, enSp]);
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
      if (p[1] === 'items' && p[2] === 'slots') return `(${SLOT_NAME[p[3]] || p[3]})`;
      if (p[1] === 'attackmodifier') return { double: '×2', plus0: '+0', minus1: '−1', minus2: '−2', plus1: '+1', plus2: '+2', null: 'Fehlschlag' }[p[2]] || '';
      return '';
    })
    .replace(/<br>/g, ' ')
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
  conditions: [], drawbacks: [], gen: [], use: [], text: [], slots: [],
});

// Trifft die Aktion mehrere Ziele? Dann kosten Verbesserungen darauf das Doppelte.
const isMulti = (a) => (a.subActions || []).some((x) => x.type === 'area'
  || (x.type === 'target' && Number(x.value) > 1)
  || (x.type === 'specialTarget' && /^(enemies|allies|selfAllies|alliesEnemies)/.test(String(x.value))));
const MODIFIER = ['range', 'target', 'pierce', 'push', 'pull', 'condition', 'area', 'specialTarget'];
const SLOT_SHAPES = ['square', 'circle', 'diamond', 'diamond_plus', 'hex'];

function signed(a) {
  if (a.valueType === 'plus' || a.valueType === 'add') return `+${a.value}`;
  if (a.valueType === 'minus' || a.valueType === 'subtract') return `-${a.value}`;
  return `${a.value}`;
}

const HARMFUL = ['stun', 'disarm', 'immobilize', 'muddle', 'wound', 'poison', 'curse'];

// Geht den Aktionsbaum durch. "ctx" merkt sich, zu welcher Hauptaktion
// Unteraktionen (Reichweite, Zustände, Ziele) gehören.
function walk(actions, half, ctx) {
  const out = [];
  for (const a of actions || []) {
    const sub = a.subActions || [];
    const num = typeof a.value === 'number' ? a.value : parseInt(a.value, 10) || 0;
    const multi = isMulti(a) || !!(ctx && ctx.multi && MODIFIER.includes(a.type));
    // Verbesserungsfelder dieser Zeile merken (Form bestimmt, welche Aufkleber passen)
    for (const shape of a.enhancementTypes || []) {
      if (!SLOT_SHAPES.includes(shape)) continue;
      const bonus = a.valueType === 'plus' || a.valueType === 'minus' || a.valueType === 'add';
      half.slots.push({
        on: a.type, shape, multi,
        ai: a.type === 'attack' && !bonus ? half.attacks.length : -1,
        hexes: a.type === 'area' ? (String(a.value).match(/target/g) || []).length : 0,
      });
    }
    switch (a.type) {
      case 'attack': {
        // "+1 Angriff" als Bonus (z. B. nach Elementverbrauch) ist kein eigener Angriff
        const isBonus = a.valueType === 'plus' || a.valueType === 'minus' || a.valueType === 'add';
        if (!isBonus) half.attacks.push(num);
        const inner = walk(sub, half, { kind: 'attack', multi });
        out.push([`${ACTION.attack} ${signed(a)}`, ...inner].join(', '));
        break;
      }
      case 'move':
        if (!ctx) half.move = Math.max(half.move, num);
        out.push([`${ACTION.move} ${signed(a)}`, ...walk(sub, half, { kind: 'move', multi })].join(', '));
        break;
      case 'jump':
        half.jump = true;
        out.push(ACTION.jump, ...walk(sub, half, ctx));
        break;
      case 'heal': {
        half.heal = Math.max(half.heal, num);
        const inner = walk(sub, half, { kind: 'heal', multi });
        out.push([`${ACTION.heal} ${signed(a)}`, ...inner].join(', '));
        break;
      }
      case 'shield': {
        half.shield = Math.max(half.shield, num);
        const inner = walk(sub, half, { kind: 'shield', multi });
        out.push([`${ACTION.shield} ${signed(a)}`, ...inner].join(', '));
        break;
      }
      case 'retaliate':
        half.retaliate = Math.max(half.retaliate, num);
        out.push([`${ACTION.retaliate} ${signed(a)}`, ...walk(sub, half, { kind: 'retaliate', multi })].join(', '));
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
        // Ein schädlicher Zustand an einer Heilung oder mit Ziel „selbst“ trifft die eigene Seite:
        // das ist der Preis der Aktion, kein Effekt auf Gegner.
        const ownSide = (ctx && ctx.kind === 'heal') || sub.some((x) => x.type === 'specialTarget' && /^(self|all(y|ies))/i.test(String(x.value)));
        const list = ownSide && HARMFUL.includes(c) ? half.drawbacks : half.conditions;
        if (!list.includes(c)) list.push(c);
        const inner = walk(sub, half, { kind: 'condition', multi });
        out.push([list === half.drawbacks && ctx && ctx.kind === 'heal' ? `${COND(c)} (trifft den Geheilten)` : COND(c), ...inner].join(', '));
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

// ---------- Perks (Angriffsmodifikator-Deck) ----------
const MOD_VALUE = { minus2: -2, minus1: -1, plus0: 0, plus1: 1, plus2: 2, plus3: 3, plus4: 4 };
const signText = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '+0');
const ZAHLWORT = ['', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs'];

function modCard(am) {
  const fx = (am.effects || []).map((e) => {
    if (e.type === 'condition') return { k: e.value };
    if (e.type === 'element') return { k: 'element', e: e.value };
    if (e.type === 'refreshItem') return { k: 'refresh' };
    return { k: e.type, n: Number(e.value) || 1 };
  });
  const v = MOD_VALUE[am.type] ?? 0;
  const fxKey = fx.map((f) => (f.k === 'element' ? f.e : f.n ? `${f.k}${f.n}` : f.k)).join('+');
  const fxText = fx.map((f) => {
    if (f.k === 'element') return ELEM(f.e);
    if (f.k === 'refresh') return 'Gegenstand auffrischen';
    if (f.k === 'target') return 'zusätzlichem Ziel';
    if (f.k === 'heal') return `Heilung ${f.n} für dich`;
    if (f.k === 'shield') return `Schild ${f.n} für dich`;
    if (f.k === 'pierce') return `Durchbohren ${f.n}`;
    if (f.k === 'push') return `Schieben ${f.n}`;
    if (f.k === 'pull') return `Ziehen ${f.n}`;
    return COND(f.k);
  }).join(' und ');
  return {
    v, r: !!am.rolling, fx,
    k: `${v >= 0 ? '+' : ''}${v}${am.rolling ? 'R' : ''}${fxKey ? `:${fxKey}` : ''}`,
    label: `${am.rolling ? 'rollende ' : ''}${signText(v)}`, fxText,
  };
}
// "zwei rollende +1-Karten mit Betäubung"
const modPhrase = (entry) => {
  const c = modCard(entry.attackModifier);
  return `${ZAHLWORT[entry.count] || entry.count} ${c.label}-Karte${entry.count > 1 ? 'n' : ''}${c.fxText ? ` mit ${c.fxText}` : ''}`;
};
const modKeys = (list) => list.map((e) => `${e.count}x${modCard(e.attackModifier).k}`).join(',');
const expand = (list) => list.flatMap((e) => Array.from({ length: e.count }, () => { const { v, r, fx, k } = modCard(e.attackModifier); return { v, r, fx, k }; }));

function perkOf(p) {
  const cards = p.cards || [];
  const item = /ignoreNegativeItem/.test(p.custom || '');
  const scenario = /ignoreNegativeScenario|ignoreScenario/.test(p.custom || '');
  const removed = p.type === 'remove' ? cards : p.type === 'replace' ? cards.slice(0, 1) : [];
  const added = p.type === 'remove' ? [] : p.type === 'replace' ? cards.slice(1) : cards;
  const parts = [];
  if (item) parts.push('Ignoriere negative Effekte von Gegenständen');
  if (scenario) parts.push('Ignoriere negative Szenarioeffekte');
  if (p.type === 'remove') parts.push(`Entferne ${removed.map(modPhrase).join(' und ')}`);
  else if (p.type === 'replace') parts.push(`Ersetze ${removed.map(modPhrase).join(' und ')} durch ${added.map(modPhrase).join(' und ')}`);
  else if (added.length) parts.push(`${item || scenario ? 'füge' : 'Füge'} ${added.map(modPhrase).join(' und ')} hinzu`);
  const key = [
    item ? 'item' : '', scenario ? 'scen' : '',
    p.type === 'remove' ? `rm:${modKeys(removed)}` : p.type === 'replace' ? `re:${modKeys(removed)}>${modKeys(added)}` : added.length ? `add:${modKeys(added)}` : '',
  ].filter(Boolean).join('+');
  return { key, text: parts.join(' und '), count: p.count || 1, remove: expand(removed), add: expand(added), item, scenario };
}

// Klassensymbol aus GHS als schlankes SVG: nur Formen und ihre Geometrie, Farbe kommt aus der App.
const ICON_TAGS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline']);
const ICON_ATTRS = new Set(['d', 'transform', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points', 'fill-rule', 'clip-rule']);
function classIcon(id) {
  const file = join(ghsDir, 'src', 'assets', 'images', 'character', 'icons', `gh-${id}.svg`);
  if (!existsSync(file)) return null;
  const svg = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const box = /viewBox="([\d.\s-]+)"/.exec(svg);
  if (!box) return null;
  let body = '';
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z:]+)((?:\s+[^\s=>\/]+\s*=\s*"[^"]*")*)\s*(\/?)>/g)) {
    const [, zu, tag, attrs, leer] = m;
    if (!ICON_TAGS.has(tag)) continue;
    if (zu) { body += `</${tag}>`; continue; }
    const keep = [...attrs.matchAll(/\s+([^\s=]+)\s*=\s*"([^"]*)"/g)]
      .filter(([, name]) => ICON_ATTRS.has(name))
      .map(([, name, value]) => ` ${name}="${value.replace(/\s+/g, ' ').replace(/[<>&]/g, '')}"`).join('');
    body += `<${tag}${keep}${leer ? '/' : ''}>`;
  }
  return body.includes('<path') || body.includes('<circle') || body.includes('<polygon') ? { box: box[1].trim().replace(/\s+/g, ' '), body } : null;
}

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
    icon: classIcon(c.name),
    health: (c.stats || []).sort((a, b) => a.level - b.level).map((s) => s.health),
    perks: (c.perks || []).map(perkOf),
    cards: deck.abilities.map((a) => ({
      id: a.cardId,
      name: firstOf(['ability', a.name], [own, de]) || a.name,
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

// Angriffe einer Monsterkarte: relativ zum Grundwert (rel) oder fester Wert (abs)
function deckAttacks(actions) {
  const out = [];
  for (const a of actions || []) {
    if (a.type === 'attack') {
      const v = typeof a.value === 'number' ? a.value : parseInt(a.value, 10) || 0;
      const sub = a.subActions || [];
      const pierce = sub.find((x) => x.type === 'pierce');
      const entry = { pierce: pierce ? Number(pierce.value) || 0 : 0 };
      if (a.valueType === 'plus') entry.rel = v;
      else if (a.valueType === 'minus') entry.rel = -v;
      else entry.abs = v;
      out.push(entry);
    } else if (!['move', 'heal', 'shield', 'retaliate', 'condition', 'element', 'summon', 'loot'].includes(a.type)) {
      out.push(...deckAttacks(a.subActions));
    }
  }
  return out;
}

const decks = {};
for (const file of readDir(join(GH, 'monster', 'deck'))) {
  const d = readJson(join(GH, 'monster', 'deck', file));
  decks[d.name] = d.abilities.map((a) => {
    const half = emptyHalf();
    const text = walk(a.actions, half, null);
    return {
      initiative: a.initiative, shuffle: !!a.shuffle, text, attacks: deckAttacks(a.actions),
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

// ---------- Gegenstände ----------
const ITEM_DIRS = [[1, 14], [15, 21], [22, 28], [29, 35], [36, 42], [43, 49], [50, 56], [57, 63], [64, 70], [71, 95], [96, 133], [134, 151]];
const pad3 = (n) => String(n).padStart(3, '0');
function itemImage(id, nameEn) {
  const r = ITEM_DIRS.find(([a, b]) => id >= a && id <= b);
  if (!r) return null;
  const copy = id >= 71 && id <= 95 ? 'a' : ''; // diese Karten gibt es bei Worldhaven doppelt (a/b)
  return `${pad3(r[0])}-${pad3(r[1])}/gh-${pad3(id)}${copy}-${slug(nameEn)}.png`;
}
const itemLines = (src, id) => {
  const e = dig(src, ['items', `gh-${id}`]) || {};
  return Object.keys(e).filter((k) => k).sort((a, b) => Number(a) - Number(b)).map((k) => e[k]).filter((v) => typeof v === 'string');
};

// Grobe Einordnung der Wirkung aus dem englischen Regeltext, für die Kaufempfehlung.
function itemTags(raw, item) {
  const t = {};
  const num = (re) => { const m = raw.match(re); return m ? Number(m[1]) : 0; };
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const set = (k, v) => { if (v && (!Array.isArray(v) || v.length)) t[k] = v; };
  const shield = num(/game\.action\.shield:(\d+)/);
  set('shield', shield);
  const charges = raw.match(/next (two|three|four|five) sources of damage/);
  if (shield) t.charges = charges ? words[charges[1]] : 1;
  const baseMove = raw.match(/default bottom[^"]*"%game\.action\.move:(\d+)%/);
  set('move', baseMove ? Number(baseMove[1]) - 2 : num(/game\.action\.move\.valueSign:(\d+)/));
  set('jump', /game\.action\.(jump|fly)/.test(raw));
  const baseAttack = raw.match(/default top[^"]*"%game\.action\.attack:(\d+)%/);
  set('attack', /ally's attack/.test(raw) ? 0 : baseAttack ? Number(baseAttack[1]) - 2 : num(/game\.action\.attack\.valueSign:(\d+)/));
  set('advantage', /gain Advantage/.test(raw));
  set('attackerDisadvantage', /attacker gains Disadvantage/.test(raw));
  set('heal', /self/i.test(raw) ? num(/game\.action\.heal:(\d+)/) : 0);
  const stamina = raw.match(/up to (two|three) of your dis/);
  set('stamina', stamina ? words[stamina[1]] : 0);
  set('refresh', /Refresh/.test(raw));
  set('pierce', /ignore all Shield/.test(raw) ? 9 : num(/game\.action\.pierce:(\d+)/));
  set('range', num(/game\.action\.range\.valueSign:(\d+)/));
  set('retaliate', num(/game\.action\.retaliate:(\d+)/));
  set('noDamage', /suffer no damage instead/.test(raw) && !/summon/.test(raw));
  set('initiative', num(/initiative value by (\d+)/));
  set('cure', /remove (one|all) negative condition/.test(raw));
  const conds = (text) => [...text.matchAll(/game\.condition\.(\w+)/g)].map((m) => m[1]);
  const immune = [...new Set([
    ...[...raw.matchAll(/immune to ([^.]*)/g)].flatMap((m) => conds(m[1])),
    ...(item.effects || []).filter((e) => e.type === 'immune').map((e) => e.value),
  ])];
  set('immune', immune);
  const gained = [...raw.matchAll(/[Gg]ain %game\.condition\.(\w+)%/g)].map((m) => m[1]);
  if (/strengthen% yourself/.test(raw)) gained.push('strengthen');
  set('selfBuff', gained.filter((c) => ['invisible', 'strengthen', 'bless'].includes(c)));
  const negative = ['stun', 'poison', 'wound', 'muddle', 'immobilize', 'disarm', 'curse'];
  if (!/immune to|remove (one|all)|Whenever you gain/.test(raw)) {
    set('inflict', [...new Set(conds(raw).filter((c) => negative.includes(c) && !gained.includes(c)))]);
  }
  const el = raw.match(/create (any two elements|any element|Ice|Air|Fire|Earth|Light|Dark)/);
  if (el) t.element = el[1].startsWith('any') ? 'wild' : el[1].toLowerCase();
  set('minusOne', item.minusOne || 0);
  set('noCrit', /attackmodifier\.double/.test(raw));
  // Wirkt nur bei eigenen Fern- oder Nahkampfangriffen
  if (/ranged attack/.test(raw)) t.needs = 'ranged';
  else if (/melee attack/.test(raw)) t.needs = 'melee';
  return t;
}

// Überarbeitete Auflage (auch die deutsche Ausgabe): Die Ausdauertränke holen eine Karte weniger
// zurück, als die GHS-Daten der ersten Auflage sagen. Vom Nutzer an der gedruckten Karte bestätigt (Nr. 13).
const REVISED_ITEMS = {
  13: { stamina: 1, text: [/bis zu 2 deiner abgeworfenen Karten/, '1 deiner abgeworfenen Karten'] },
  34: { stamina: 2, text: [/bis zu 3 deiner abgeworfenen Karten/, 'bis zu 2 deiner abgeworfenen Karten'] },
};

const items = [];
if (existsSync(join(GH, 'items.json'))) {
  for (const it of readJson(join(GH, 'items.json'))) {
    const key = ['items', `gh-${it.id}`];
    const linesDe = itemLines(deSp, it.id);
    const linesEn = itemLines(enSp, it.id);
    items.push({
      id: it.id,
      name: firstOf(key, [own, deSp, de]) || it.name,
      nameEn: it.name,
      cost: it.cost || 0,
      slot: it.slot,
      prosperity: it.unlockProsperity || 0, // 0 = nicht im Laden, kommt über Belohnungen und Entwürfe
      use: it.consumed ? 'consumed' : it.spent ? 'spent' : 'passive',
      text: (linesDe.length ? linesDe : linesEn).map((l) => resolveText(l)).filter(Boolean).join(' '),
      german: linesDe.length > 0 || linesEn.length === 0,
      tags: itemTags(linesEn.join(' '), it),
      img: itemImage(it.id, it.name),
    });
    const rev = REVISED_ITEMS[it.id];
    if (rev) {
      const item = items[items.length - 1];
      item.tags.stamina = rev.stamina;
      item.text = item.text.replace(rev.text[0], rev.text[1]);
    }
  }
}

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
  itemImageBase: 'https://raw.githubusercontent.com/any2cards/worldhaven/master/images/items/gloomhaven/',
  conditionNames, elementNames,
  characters, monsters, decks, scenarios, items,
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out));
console.log(
  `gamedata geschrieben: ${characters.length} Klassen, ${characters.reduce((n, c) => n + c.cards.length, 0)} Karten, ` +
  `${Object.keys(monsters).length} Monster, ${scenarios.length} Szenarien, ${items.length} Gegenstände -> ${outFile}`,
);
