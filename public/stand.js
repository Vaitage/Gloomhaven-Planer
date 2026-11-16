// Prüft und bereinigt den gespeicherten Stand. Läuft im Browser nach dem Laden und auf dem
// Server vor dem Speichern. Damit kann über gespeicherte Daten kein fremder Code in die Seite
// gelangen: Text ist nur in Notizen frei, alles andere sind Zahlen, Wahrheitswerte oder
// kurze Bezeichner ohne Sonderzeichen.

const BEZEICHNER = /^[\p{L}\p{N} _.:|+-]{0,60}$/u;
const NAME = /^[\p{L}\p{N} _.-]{1,30}$/u;
const VERBOTEN = ['__proto__', 'constructor', 'prototype'];
const MAX_EINTRAEGE = 400;
const MAX_NOTIZ = 4000;
export const MAX_PROFILE = 40;

export const validName = (n) => typeof n === 'string' && NAME.test(n) && !VERBOTEN.includes(n);
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const ganz = (v, min, max, sonst) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : sonst;
};

// Allgemeine Reinigung: unbekannte Felder bleiben erhalten, aber nur mit harmlosen Werten
function sauber(v, tiefe = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'string') return BEZEICHNER.test(v) ? v : undefined;
  if (tiefe > 6) return undefined;
  if (Array.isArray(v)) return v.slice(0, MAX_EINTRAEGE).map((x) => sauber(x, tiefe + 1)).filter((x) => x !== undefined);
  if (isObject(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, MAX_EINTRAEGE)) {
      if (!BEZEICHNER.test(k) || VERBOTEN.includes(k)) continue;
      const y = sauber(x, tiefe + 1);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  return undefined;
}

const zahlenListe = (v) => (Array.isArray(v) ? v.slice(0, MAX_EINTRAEGE).map((x) => ganz(x, 0, 99999, null)).filter((x) => x !== null) : []);
function listenJeSchluessel(v) {
  const out = {};
  if (isObject(v)) for (const [k, x] of Object.entries(sauber(v))) out[k] = zahlenListe(x);
  return out;
}

// Bereinigt nur vorhandene Felder. Fehlende ergänzt die App selbst (heldDefaults).
export function cleanProfile(roh) {
  const p = sauber(isObject(roh) ? roh : {});
  p.classId = typeof p.classId === 'string' && /^[a-z0-9-]{1,30}$/.test(p.classId) ? p.classId : '';
  p.level = ganz(p.level, 1, 9, 1);
  if ('xp' in p) p.xp = ganz(p.xp, 0, 9999, 0);
  if ('gold' in p) p.gold = ganz(p.gold, 0, 9999, 0);
  if ('checks' in p) p.checks = ganz(p.checks, 0, 18, 0);
  if ('tank' in p) p.tank = p.tank === true;
  if ('xpGeschaetzt' in p) p.xpGeschaetzt = p.xpGeschaetzt === true;
  for (const k of ['owned', 'hands', 'perks']) if (k in p) p[k] = listenJeSchluessel(p[k]);
  if ('items' in p) {
    p.items = (Array.isArray(p.items) ? p.items : []).filter(isObject)
      .map((e) => ({ id: ganz(e.id, 0, 9999, null), worn: e.worn === true })).filter((e) => e.id !== null).slice(0, 200);
  }
  if ('quest' in p) {
    const id = isObject(p.quest) ? ganz(p.quest.id, 1, 9999, null) : null;
    if (id === null) delete p.quest;
    else p.quest = { id, done: (Array.isArray(p.quest.done) ? p.quest.done : []).slice(0, 12).map((x) => ganz(x, 0, 999, 0)) };
  }
  if ('enh' in p) {
    const enh = {};
    if (isObject(p.enh)) {
      for (const [k, liste] of Object.entries(p.enh)) {
        enh[k] = (Array.isArray(liste) ? liste : []).filter(isObject).map((e) => ({
          card: ganz(e.card, 0, 99999, null), side: e.side === 'bottom' ? 'bottom' : 'top', slot: ganz(e.slot, 0, 20, 0),
          sticker: typeof e.sticker === 'string' && /^[a-z0-9:_-]{1,24}$/.test(e.sticker) ? e.sticker : null,
        })).filter((e) => e.card !== null && e.sticker);
      }
    }
    p.enh = enh;
  }
  return p;
}

export function cleanShared(roh) {
  const quelle = isObject(roh) ? roh : {};
  const s = sauber({ ...quelle, notes: undefined, results: undefined });
  s.players = ganz(s.players, 2, 4, 4);
  s.level = ganz(s.level, 0, 7, 1);
  if ('prosperity' in s) s.prosperity = ganz(s.prosperity, 1, 9, 1);
  if ('prosperityPoints' in s) s.prosperityPoints = ganz(s.prosperityPoints, 0, 64, 0);
  if ('reputation' in s) s.reputation = ganz(s.reputation, -20, 20, 0);
  // Notizen: freier Text je Szenario, wird in der App immer maskiert ausgegeben
  s.notes = {};
  if (isObject(quelle.notes)) {
    for (const [k, text] of Object.entries(quelle.notes).slice(0, MAX_EINTRAEGE)) {
      if (/^\d{1,4}$/.test(k) && typeof text === 'string') s.notes[k] = text.slice(0, MAX_NOTIZ);
    }
  }
  s.results = {};
  if (isObject(quelle.results)) {
    for (const [k, r] of Object.entries(quelle.results).slice(0, MAX_EINTRAEGE)) {
      if (!/^\d{1,4}$/.test(k) || !isObject(r)) continue;
      const rewards = {};
      if (isObject(r.rewards)) {
        for (const [name, g] of Object.entries(r.rewards).slice(0, MAX_PROFILE)) {
          if (!validName(name) || !isObject(g)) continue;
          rewards[name] = { xp: ganz(g.xp, 0, 999, 0), gold: ganz(g.gold, 0, 999, 0), checks: ganz(g.checks, 0, 2, 0), cardXp: ganz(g.cardXp, 0, 99, 0), coins: ganz(g.coins, 0, 99, 0), goal: ganz(g.goal, 0, 2, 0) };
        }
      }
      s.results[k] = { rounds: ganz(r.rounds, 1, 99, 1), won: r.won !== false, est: Number.isFinite(Number(r.est)) ? Math.max(0, Math.min(99, Number(r.est))) : 0, players: ganz(r.players, 2, 4, 4), level: ganz(r.level, 0, 7, 1), rewards };
    }
  }
  return s;
}

export function cleanState(roh) {
  const quelle = isObject(roh) ? roh : {};
  const profiles = {};
  if (isObject(quelle.profiles)) {
    for (const [name, p] of Object.entries(quelle.profiles)) {
      if (Object.keys(profiles).length >= MAX_PROFILE) break;
      if (validName(name) && isObject(p)) profiles[name] = cleanProfile(p);
    }
  }
  return { shared: cleanShared(quelle.shared), profiles };
}
