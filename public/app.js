import { scenarioProfile, cardPool, scoreCard, suggestHand, handStats, stamina, autoPlan, itemPlan, scenarioReward, perksAllowed, estimateRounds, calibration, incomingDamage, xpProgress, applyEnhancements } from './logic.js';
import { renderHeld, heldClick, heldInput, heldChange, heldDefaults, stickerName } from './held.js';
import { renderSetup, setupStart, setupClick, setupInput, setupFarbe } from './setup.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#ansicht');

// Symbolnamen der freischaltbaren Klassen, damit die Auswahl nichts verrät
const SYMBOL = {
  sun: 'Sonne', 'three-spears': 'Drei Speere', circles: 'Kreise', eclipse: 'Finsternis', squidface: 'Tentakelgesicht',
  lightning: 'Blitze', 'music-note': 'Musiknote', 'angry-face': 'Wütendes Gesicht', saw: 'Säge', triangles: 'Dreiecke', 'two-mini': 'Zwei Minis',
};

let data = null;
let state = { shared: { players: 4, level: 1, notes: {} }, profiles: {} };
const local = {
  tab: 'szenario',
  profile: localStorage.getItem('gp.profil') || '',
  scenario: Number(localStorage.getItem('gp.szenario')) || 1,
  showRooms: false,
  poolFilter: 'vorrat',
  losses: 2,
  planEvents: [],
  planOffen: null,
  longRest: false,
  heldTab: 'uebersicht',
  itemSuche: '',
  enhCard: null,
  epAlt: null,
  targets: {}, // von Hand gesetzte Szenariolänge je Szenario
  setup: null, // Entwurf beim Anlegen oder Bearbeiten eines Charakters
};

// ---------- Laden und Speichern ----------

const statusEl = $('#speicherStatus');
function setStatus(text, bad = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('fehler', bad);
}

// Zwei Betriebsarten: Mit Server (Raspberry Pi) liegt der Stand auf dem Server.
// Die Geräte-Variante (GitHub Pages, als App installierbar) hat keinen Server und
// merkt sich alles im Speicher des Geräts. scripts/build-statisch.mjs stellt sie ein.
const OHNE_SERVER = document.querySelector('meta[name="planer-modus"]')?.content === 'statisch';
const GERAET_KEY = 'gp.stand';

function geraetStand() {
  try { return JSON.parse(localStorage.getItem(GERAET_KEY)) || {}; } catch { return {}; }
}

async function request(path, options) {
  if (OHNE_SERVER) {
    if (path === 'api/data') {
      const res = await fetch('gamedata.json');
      if (!res.ok) throw new Error('Die Spieldaten konnten nicht geladen werden. Beim ersten Start braucht die App Internet.');
      return res.json();
    }
    if (path === 'api/state') return geraetStand();
    if (path === 'api/updates') throw new Error('gibt es nur mit Server');
    // Speichern: den ganzen Stand auf dem Gerät ablegen
    try { localStorage.setItem(GERAET_KEY, JSON.stringify(state)); } catch { throw new Error('Der Gerätespeicher ist voll oder gesperrt.'); }
    return {};
  }
  const res = await fetch(path, options);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Fehler ${res.status}`);
  return res.json();
}

const timers = {};
function saveLater(key, path, getBody) {
  clearTimeout(timers[key]);
  // Geräte-Variante: sofort ablegen, damit nichts verloren geht, wenn die App gleich geschlossen wird
  if (OHNE_SERVER) {
    try { localStorage.setItem(GERAET_KEY, JSON.stringify(state)); setStatus('Auf dem Gerät gespeichert'); }
    catch { setStatus('Nicht gespeichert. Gerätespeicher prüfen.', true); }
    return;
  }
  setStatus('Speichert …');
  timers[key] = setTimeout(async () => {
    try {
      await request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getBody()) });
      setStatus(OHNE_SERVER ? 'Auf dem Gerät gespeichert' : 'Gespeichert');
    } catch (e) {
      setStatus(OHNE_SERVER ? 'Nicht gespeichert. Gerätespeicher prüfen.' : 'Nicht gespeichert. Verbindung zum Server prüfen.', true);
    }
  }, 500);
}
const saveShared = () => saveLater('shared', 'api/state/shared', () => state.shared);
const saveProfile = () => {
  const name = local.profile;
  if (name) saveLater('p:' + name, 'api/state/profiles/' + encodeURIComponent(name), () => state.profiles[name]);
};

// ---------- Abgeleitete Werte ----------

const profile = () => state.profiles[local.profile] || null;
const character = () => { const p = profile(); return p ? data.characters.find((c) => c.id === p.classId) : null; };
const scenario = () => data.scenarios.find((s) => s.id === local.scenario) || data.scenarios[0];
const condName = (c) => data.conditionNames[c] || c;
const elemName = (e) => data.elementNames[e] || e;
const handKey = () => `${profile().classId}|${local.scenario}`;
const owned = () => (profile().owned[profile().classId] ||= []);
const currentHand = () => (profile().hands[handKey()] ||= []);
const currentProfile = () => scenarioProfile(data, scenario(), state.shared.players, state.shared.level);
const enhList = () => ((profile().enh ||= {})[profile().classId] ||= []);
// Kartenvorrat mit eingerechneten Verbesserungen
const pool = () => cardPool(character(), profile().level, owned()).map((c) => applyEnhancements(c, enhList()));
const kommazahl = (n) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function classLabel(c, reveal) {
  if (!c.locked) return c.name;
  return reveal ? `${c.name} (${SYMBOL[c.id] || c.id})` : `Symbol: ${SYMBOL[c.id] || c.id}`;
}

// ---------- Farbschema nach Klasse ----------

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: Math.round((h * 60 + 360) % 360), s: s * 100, l: l * 100 };
}

const THEMA = ['--klasse', '--messing', '--tinte', '--schiefer', '--schiefer-hell', '--tiefe', '--pergament-leise'];
let themaFarbe = null;

// Färbt die App nach der Klasse: Hintergrund und Flächen bekommen nur einen Hauch
// des Farbtons, Rahmen etwas mehr, Knöpfe und Akzente die Klassenfarbe selbst (bei dunklen
// Klassenfarben aufgehellt, damit dunkle Schrift darauf lesbar bleibt).
function applyTheme(hex) {
  if (hex === themaFarbe) return;
  themaFarbe = hex;
  const root = document.documentElement.style;
  const c = hexToHsl(hex);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!c) {
    THEMA.forEach((p) => root.removeProperty(p));
    if (meta) meta.content = '#18222b';
    return;
  }
  const farbe = (s, l) => `hsl(${c.h}, ${Math.round(Math.min(c.s, s))}%, ${l}%)`;
  const akzent = `hsl(${c.h}, ${Math.round(c.s)}%, ${Math.round(Math.max(c.l, 64))}%)`;
  root.setProperty('--klasse', akzent);
  root.setProperty('--messing', akzent);
  root.setProperty('--tinte', farbe(10, 10));
  root.setProperty('--schiefer', farbe(11, 16));
  root.setProperty('--schiefer-hell', farbe(24, 27));
  root.setProperty('--tiefe', farbe(10, 6));
  root.setProperty('--pergament-leise', farbe(16, 70));
  if (meta) meta.content = farbe(10, 10);
}

// ---------- Kopf ----------

// Klassensymbol als SVG in der Klassenfarbe, ohne Symbol die schlichte Raute
function classIconHtml(c) {
  return c && c.icon ? `<svg viewBox="${esc(c.icon.box)}" fill="currentColor" aria-hidden="true" focusable="false">${c.icon.body}</svg>` : '<span class="held-farbe"></span>';
}

function renderHeader() {
  const p = profile();
  const c = character();
  const imSetup = local.tab === 'setup' && local.setup;
  applyTheme(imSetup ? setupFarbe(heldCtx) : c ? c.color : null);
  $('#heldName').textContent = c ? c.name : imSetup ? 'Neuer Charakter' : Object.keys(state.profiles).length ? 'Held wählen' : 'Held anlegen';
  if (p) heldDefaults(p);
  const zeichen = $('#heldZeichen');
  const iconId = c ? c.id : imSetup ? local.setup.classId : '';
  if (zeichen.dataset.klasse !== iconId) { zeichen.dataset.klasse = iconId; zeichen.innerHTML = classIconHtml(data.characters.find((x) => x.id === iconId)); }
  $('#heldSub').textContent = p && c ? `Stufe ${p.level}, ${p.gold} Gold` : imSetup ? 'Einrichtung' : 'Tippen zum Einrichten';
  $('#heldBtn').classList.toggle('aktiv', local.tab === 'held');
  const mini = $('#miniEp');
  mini.parentElement.hidden = !(p && c);
  if (p && c) mini.style.width = `${Math.round(xpProgress(p.xp, p.level).ratio * 100)}%`;
  const neu = !!(updates && updates.status && updates.status.verfuegbar);
  document.querySelectorAll('.reiter button').forEach((b) => {
    if (b.dataset.tab === 'notizen') b.innerHTML = neu ? 'Notizen <span class="punkt" title="Neue Version verfügbar"></span><span class="sr">, neue Version verfügbar</span>' : 'Notizen';
    if (b.dataset.tab === local.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

// ---------- Held-Dialog ----------

const heldDialog = $('#heldDialog');
function selectProfile(name) {
  local.profile = name;
  localStorage.setItem('gp.profil', name);
  local.epAlt = null;
}

function startSetup(name = null) {
  setupStart(heldCtx, name);
  render();
  window.scrollTo(0, 0);
}

// Charakter wechseln, bearbeiten oder einen neuen anlegen
function openHeld() {
  const names = Object.keys(state.profiles).sort();
  if (!names.length) return startSetup();
  const zeile = (n) => {
    const q = state.profiles[n];
    const c = data.characters.find((x) => x.id === q.classId);
    return `<option value="${esc(n)}" ${n === local.profile ? 'selected' : ''}>${esc(n)}: ${esc(c ? c.name : q.classId)}, Stufe ${q.level}</option>`;
  };
  heldDialog.innerHTML = `
    <form method="dialog" class="dialog-inhalt">
      <h2 id="heldDialogTitel">Wer plant?</h2>
      <label for="profilWahl">Charakter
        <select id="profilWahl" name="profil">${names.map(zeile).join('')}</select>
      </label>
      <div class="dialog-knoepfe spalte">
        <button type="submit" class="haupt">Diesen Charakter spielen</button>
        <button type="button" class="leise" data-act="bearbeiten">Diesen Charakter bearbeiten</button>
        <button type="button" class="leise" data-act="neu">Neuen Charakter anlegen</button>
        <button type="button" class="leise" data-act="abbrechen">Abbrechen</button>
      </div>
    </form>`;
  const form = $('form', heldDialog);
  form.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    heldDialog.close();
    if (act === 'bearbeiten') startSetup(form.profil.value);
    if (act === 'neu') startSetup();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    selectProfile(form.profil.value);
    heldDialog.close();
    render();
  });
  heldDialog.showModal();
}
// Mit Held führt der Kopf zum Charakterbildschirm, ohne Held zum Einrichten
$('#heldBtn').addEventListener('click', () => {
  if (!profile()) return openHeld();
  local.tab = 'held';
  render();
  window.scrollTo(0, 0);
});

// ---------- Bausteine ----------

function seg(name, options, value, label) {
  return `<div class="seg" role="group" aria-label="${esc(label)}">${options.map((o) =>
    `<button type="button" data-set="${name}" data-val="${o}" aria-pressed="${o === value}">${o}</button>`).join('')}</div>`;
}

function scenarioBar() {
  const s = scenario();
  return `
    <section class="szenario-kopf">
      <div class="nummer">
        <button type="button" data-act="szen-" aria-label="Vorheriges Szenario">‹</button>
        <label><span class="sr">Szenarionummer</span><input id="szenNr" type="number" inputmode="numeric" enterkeyhint="done" min="1" max="95" value="${s.id}"></label>
        <button type="button" data-act="szen+" aria-label="Nächstes Szenario">›</button>
      </div>
      <h1>${esc(s.name)}</h1>
    </section>`;
}

function halfHtml(h, label) {
  const text = h.text.length ? h.text.map(esc).join(' · ') : 'keine Angabe';
  const tags = [
    h.lost ? '<span class="marke verlust">Verlust</span>' : '', h.persistent ? '<span class="marke">dauerhaft</span>' : '', h.round ? '<span class="marke">diese Runde</span>' : '',
    ...(h.enh || []).map((e) => `<span class="marke gut">verbessert: ${esc(stickerName(heldCtx, e.sticker, e.on))}</span>`),
  ].join(' ');
  return `<p class="haelfte"><span class="haelfte-name">${label}</span><span>${text} ${tags}</span></p>`;
}

function cardHtml(card, s, opts = {}) {
  const inHand = currentHand().includes(card.id);
  const c = character();
  const lvl = card.level === 'X' ? 'X' : card.level;
  const needsOwn = card.level !== 'X' && card.level > 1;
  const isOwned = !needsOwn || owned().includes(card.id);
  const why = s ? s.why.slice(0, 4).map((w) => `<li class="${w.good ? 'gut' : 'schlecht'}">${esc(w.text)} <span class="wo">(${w.half})</span></li>`).join('') : '';
  return `
    <article class="karte ${inHand ? 'in-hand' : ''} ${isOwned ? '' : 'fremd'}">
      <header>
        <span class="ini" title="Initiative">${String(card.initiative).padStart(2, '0')}</span>
        <div class="titel">
          <h3>${esc(card.name)}</h3>
          <small>Stufe ${lvl}, Karte ${card.id}</small>
        </div>
        ${s ? `<span class="wert" title="Bewertung für dieses Szenario">${s.score.toFixed(1)}</span>` : ''}
      </header>
      ${halfHtml(card.top, 'oben')}
      ${halfHtml(card.bottom, 'unten')}
      ${why ? `<ul class="gruende">${why}</ul>` : ''}
      <footer>
        ${card.img ? `<button type="button" class="leise" data-act="bild" data-img="${esc(card.img)}" data-name="${esc(card.name)}">Karte ansehen</button>` : ''}
        ${needsOwn ? `<button type="button" class="leise" data-act="besitz" data-id="${card.id}" aria-pressed="${isOwned}">${isOwned ? 'Im Vorrat' : 'Zum Vorrat'}</button>` : ''}
        ${isOwned && !opts.noHand ? `<button type="button" class="${inHand ? 'leise' : 'haupt'}" data-act="hand" data-id="${card.id}" aria-pressed="${inHand}">${inHand ? 'Aus der Hand' : 'In die Hand'}</button>` : ''}
      </footer>
    </article>`;
}

// ---------- Reiter: Szenario ----------

function statLine(t) {
  const s = t.stats;
  const parts = [`${s.hp} Leben`, `Bewegung ${s.move}`, `Angriff ${s.attackText}`];
  if (s.range) parts.push(`Reichweite ${s.rangeText}`);
  if (s.targets > 1) parts.push(`${s.targets} Ziele`);
  if (s.shield) parts.push(`<b>Schild ${s.shield}</b>`);
  if (s.retaliate) parts.push(`<b>Vergeltung ${s.retaliate}${s.retaliateRange ? ` (Reichweite ${s.retaliateRange})` : ''}</b>`);
  if (s.pierce) parts.push(`<b>Durchbohren ${s.pierce}</b>`);
  for (const c of s.conditions) parts.push(`<b>${esc(condName(c))}</b>`);
  if (s.advantage) parts.push('Vorteil');
  if (s.disadvantage) parts.push('Angreifer haben Nachteil');
  return parts.join(', ');
}

function renderScenario() {
  const s = scenario();
  const p = currentProfile();
  const typeName = { normal: 'normal', elite: 'Elite', boss: 'Boss' };
  const groups = p.groups.map((g) => {
    const d = p.deckTraits[g.id];
    const extras = [];
    if (g.flying) extras.push('fliegt');
    if (g.immunities.length) extras.push(`immun gegen ${g.immunities.map(condName).join(', ')}`);
    if (d) {
      extras.push(`Initiative ${d.initMin} bis ${d.initMax}`);
      const can = [d.shield ? 'Schild' : '', d.heal ? 'Heilung' : '', d.retaliate ? 'Vergeltung' : '', ...d.conditions.map(condName)].filter(Boolean);
      if (can.length) extras.push(`Karten im Monsterdeck bringen ${can.join(', ')}`);
    }
    return `
      <article class="monster">
        <h3>${esc(g.name)}</h3>
        ${g.types.map((t) => `<p class="mwerte ${t.type}"><span class="anzahl">${t.count}× ${typeName[t.type]}</span><span>${statLine(t)}</span></p>`).join('')}
        ${extras.length ? `<p class="mzusatz">${esc(extras.join('. '))}.</p>` : ''}
      </article>`;
  }).join('');

  const rooms = local.showRooms ? s.rooms.map((r) => {
    const list = Object.entries(r.counts[p.players] || {}).map(([id, c]) => {
      const m = data.monsters[id];
      const bits = [c.normal ? `${c.normal} normal` : '', c.elite ? `${c.elite} Elite` : '', c.boss ? `${c.boss} Boss` : ''].filter(Boolean).join(', ');
      return `<li>${esc(m ? m.name : id)}: ${bits}${s.allies.includes(id) ? ' (Verbündete)' : ''}</li>`;
    }).join('');
    return `<article class="raum"><h3>Raum ${r.n}${r.ref ? ` (${esc(r.ref)})` : ''}${r.initial ? ', Start' : ''}</h3>${list ? `<ul>${list}</ul>` : '<p>Keine Monster zu Beginn.</p>'}</article>`;
  }).join('') : '';

  const inc = incomingDamage(data, p);
  const typKurz = { normal: 'normal', elite: 'Elite', boss: 'Boss' };
  const anteil = (i) => (inc.total[0] > 0 ? Math.round((inc.total[i] / inc.total[0]) * 100) : 0);
  const schaden = inc.rows.length ? `
    <section>
      <h2>Was bei dir ankommt</h2>
      <div class="tabelle-rahmen">
        <table class="schaden">
          <thead><tr><th scope="col">Schaden je Angriff bei</th>${inc.shields.map((x) => `<th scope="col">Schild ${x}</th>`).join('')}</tr></thead>
          <tbody>${inc.rows.map((r) => `<tr><th scope="row">${esc(r.name)} <small>${r.count}× ${typKurz[r.type]}${r.pierce ? `, Durchbohren ${r.pierce}` : ''}</small></th>${r.per.map((v) => `<td>${kommazahl(v)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      <p>Mit Schild 1 kommen noch ${anteil(1)} % des Schadens durch, mit Schild 2 noch ${anteil(2)} %, mit Schild 3 noch ${anteil(3)} %.</p>
      <p class="hinweis">Mittelwert über alle Karten des jeweiligen Monsterdecks, ohne Angriffsmodifikatoren. Der stärkste einzelne Treffer liegt bei ${Math.max(...inc.rows.map((r) => r.max))}.</p>
    </section>` : '';

  view.innerHTML = `
    ${scenarioBar()}
    <section class="einstellungen">
      <div><span class="feldname">Spieler</span>${seg('players', [2, 3, 4], state.shared.players, 'Spielerzahl')}</div>
      <div><span class="feldname">Szenariostufe</span>${seg('level', [0, 1, 2, 3, 4, 5, 6, 7], state.shared.level, 'Szenariostufe')}</div>
    </section>
    <section>
      <h2>Worauf es ankommt</h2>
      <ul class="einschaetzung">${p.notes.map((n) => `<li class="${n.kind}">${esc(n.text)}</li>`).join('')}</ul>
      <p class="zahlen">${p.enemies} Gegner, davon ${p.elites} Elite${p.bosses ? ` und ${p.bosses} Boss` : ''}. Zusammen ${p.hpTotal} Lebenspunkte.</p>
    </section>
    <section>
      <h2>Gegner bei ${p.players} Spielern, Stufe ${p.level}</h2>
      ${groups || '<p class="leer">Keine Gegner hinterlegt.</p>'}
    </section>
    ${schaden}
    <section>
      <button type="button" class="leise breit" data-act="raeume" aria-expanded="${local.showRooms}">${local.showRooms ? 'Raumaufteilung ausblenden' : 'Raumaufteilung zeigen (verrät spätere Räume)'}</button>
      ${rooms}
    </section>
    ${profile() ? '<button type="button" class="haupt breit" data-go="karten">Passende Karten ansehen</button>' : '<button type="button" class="haupt breit" data-act="held">Held einrichten, um Karten zu planen</button>'}`;
}

// ---------- Reiter: Karten ----------

function needProfile(what) {
  view.innerHTML = `<section class="leer-seite"><h1>Noch kein Held</h1><p>Richte deinen Helden ein, dann ${what}.</p><button type="button" class="haupt" data-act="held">Held einrichten</button></section>`;
}

function renderCards() {
  if (!profile()) return needProfile('zeigt dir der Planer, welche Karten zum Szenario passen');
  const c = character();
  const p = currentProfile();
  const lvl = profile().level;
  const all = local.poolFilter === 'alle';
  const cards = all ? c.cards.filter((x) => x.level === 'X' || x.level <= lvl).map((x) => applyEnhancements(x, enhList())) : pool();
  const scored = cards.map((card) => ({ card, s: scoreCard(card, p, condName) })).sort((a, b) => b.s.score - a.s.score);
  const extra = Math.max(0, lvl - 1);
  const have = owned().filter((id) => c.cards.some((x) => x.id === id && x.level !== 'X' && x.level <= lvl)).length;
  view.innerHTML = `
    ${scenarioBar()}
    <section class="einstellungen">
      <div class="seg" role="group" aria-label="Kartenauswahl">
        <button type="button" data-set="poolFilter" data-val="vorrat" aria-pressed="${!all}">Mein Vorrat (${pool().length})</button>
        <button type="button" data-set="poolFilter" data-val="alle" aria-pressed="${all}">Alle bis Stufe ${lvl}</button>
      </div>
      ${extra ? `<p class="hinweis">Ab Stufe 2 wählst du pro Stufenaufstieg eine Karte. Markiert sind ${have} von ${extra}. Unter „Alle bis Stufe ${lvl}“ legst du fest, welche du besitzt.</p>` : ''}
    </section>
    <p class="hinweis">Sortiert nach Nutzen für dieses Szenario. Die Zahl ist eine Faustregel, die Gründe stehen jeweils darunter.</p>
    <section class="kartenliste">${scored.map((x) => cardHtml(x.card, x.s)).join('')}</section>`;
}

// ---------- Reiter: Hand ----------

function rulerHtml(cards) {
  const marks = cards.map((c) => {
    const loss = c.top.lost || c.bottom.lost;
    return `<span class="strich ${loss ? 'verlust' : ''}" style="left:${c.initiative}%" title="${esc(c.name)}: ${c.initiative}"><i>${c.initiative}</i></span>`;
  }).join('');
  return `<div class="lineal" role="img" aria-label="Initiativen der Handkarten: ${cards.map((c) => c.initiative).sort((a, b) => a - b).join(', ')}">
    <span class="skala">${[1, 25, 50, 75, 99].map((n) => `<b style="left:${n}%">${n}</b>`).join('')}</span>${marks}</div>`;
}

function renderHand() {
  if (!profile()) return needProfile('kannst du deine Hand zusammenstellen');
  const c = character();
  const p = currentProfile();
  const all = pool();
  const ids = currentHand().filter((id) => all.some((x) => x.id === id));
  const cards = all.filter((x) => ids.includes(x.id)).sort((a, b) => a.initiative - b.initiative);
  const st = handStats(cards, c.handSize, elemName);
  const sta = stamina(Math.min(cards.length || c.handSize, c.handSize), local.losses, local.longRest);
  const best = stamina(c.handSize, 0, false);
  const elems = [...new Set([...Object.keys(st.gen), ...Object.keys(st.use)])];
  view.innerHTML = `
    ${scenarioBar()}
    <section>
      <h2>Deine Hand: ${cards.length} von ${c.handSize} Karten</h2>
      ${rulerHtml(cards)}
      <p class="hinweis">Jeder Strich ist die Initiative einer Karte, links schnell, rechts langsam. Rot markiert sind Karten mit Verlustaktion.</p>
      <div class="kennzahlen">
        <div><b>${st.moveCards}</b><span>mit Bewegung</span></div>
        <div><b>${st.attackCards}</b><span>mit Angriff</span></div>
        <div><b>${st.healCards}</b><span>mit Heilung</span></div>
        <div><b>${st.shieldCards}</b><span>mit Schild</span></div>
        <div><b>${st.lossCards}</b><span>mit Verlust</span></div>
      </div>
      ${elems.length ? `<p class="elemente">${elems.map((e) => `<span>${esc(elemName(e))}: ${st.gen[e] || 0} erzeugen, ${st.use[e] || 0} verbrauchen</span>`).join('')}</p>` : ''}
      ${st.warnings.length ? `<ul class="einschaetzung">${st.warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join('')}</ul>` : (cards.length ? '<p class="gut-text">Die Hand ist ausgewogen.</p>' : '')}
      <div class="knopfreihe">
        <button type="button" class="haupt" data-act="vorschlag">Vorschlag für dieses Szenario übernehmen</button>
        ${cards.length ? '<button type="button" class="leise" data-act="leeren">Hand leeren</button>' : ''}
      </div>
    </section>
    <section>
      <h2>Ausdauer</h2>
      <p class="ausdauer"><b>${sta.rounds}</b> Runden bis zur Erschöpfung${local.longRest ? `, mit ${sta.rests} langen Rasten sind es ${sta.total} Runden am Tisch` : ''}.</p>
      <p class="hinweis">Ohne Verlustkarten wären es höchstens ${best.rounds}. Runden pro Rastzyklus: ${sta.cycles.join(', ')}.</p>
      <label class="regler">Gespielte Verlustaktionen: <output>${local.losses}</output>
        <input type="range" min="0" max="6" value="${local.losses}" data-range="losses">
      </label>
      <label class="haken"><input type="checkbox" data-check="longRest" ${local.longRest ? 'checked' : ''}> Ich mache lange Rasten</label>
    </section>
    <section>
      <h2>Karten in der Hand</h2>
      <div class="kartenliste">${cards.length ? cards.map((x) => cardHtml(x, scoreCard(x, p, condName))).join('') : '<p class="leer">Noch keine Karte gewählt. Übernimm den Vorschlag oder wähle unter „Karten“ aus.</p>'}</div>
    </section>`;
}

// ---------- Reiter: Plan ----------

function actionHtml(x, where) {
  const h = x.card[x.side];
  const text = x.basic
    ? (x.side === 'top' ? 'als Standardangriff: Angriff 2' : 'als Standardbewegung: Bewegung 2')
    : (h.text.length ? h.text.map(esc).join(' · ') : 'Aktion der Karte');
  const loss = !x.basic && h.lost ? ' <span class="marke verlust">Verlust</span>' : '';
  return `<p class="zug"><span class="haelfte-name">${where}</span><span><b>${esc(x.card.name)}</b> <span class="zug-ini">${x.card.initiative}</span><br>${text}${loss}</span></p>`;
}

function stepHtml(s, einsatz = []) {
  if (s.type === 'item') {
    return `<li class="rast trank ${s.reserve ? 'reserve' : ''}"><p><b>${esc(s.item.name)}</b> trinken: hol <b>${s.cards.map((c) => esc(c.name)).join('</b> und <b>')}</b> zurück auf die Hand.</p><p class="hinweis">Das bringt eine Runde mehr, bevor du rasten musst.</p></li>`;
  }
  if (s.type === 'event') {
    const text = s.kind === 'lose'
      ? `Nach Runde ${s.n}: <b>${esc(s.card.name)}</b> (${s.card.initiative}) verloren. Der Plan ab hier rechnet ohne diese Karte.`
      : `Nach Runde ${s.n} ${s.elements.length === 1 ? 'liegt' : 'liegen'} <b>${s.elements.map((e) => esc(elemName(e))).join('</b> und <b>')}</b> aus. Der Plan nutzt das in der nächsten Runde, wenn eine Karte es braucht.`;
    return `<li class="rast gewaehlt ${s.reserve ? 'reserve' : ''}"><p>${text}</p><button type="button" class="text-knopf" data-act="tisch-weg" data-i="${s.index}">Eingabe entfernen</button></li>`;
  }
  if (s.type === 'rest') {
    const frueh = s.early != null ? `<p><b>Vorgezogene Rast</b>, von dir eingetragen. <button type="button" class="text-knopf" data-act="tisch-weg" data-i="${s.early}">Eingabe entfernen</button></p>` : '';
    const what = s.chosen
      ? `${s.long ? `Lange Rast${s.n ? ` in Runde ${s.n}` : ''}` : 'Kurze Rast'}: verloren ist <b>${esc(s.lose.name)}</b>. Der Plan ab hier rechnet ohne diese Karte.`
      : s.long
        ? `Lange Rast${s.n ? ` in Runde ${s.n}` : ''}: gib <b>${esc(s.lose.name)}</b> ab, heile 2 und frische Gegenstände auf.`
        : `Kurze Rast: die verlorene Karte ist Zufall. Am wenigsten weh tut <b>${esc(s.lose.name)}</b>. Trifft es eine wichtige Karte, lohnt sich oft 1 Schaden für einen neuen Zufall.`;
    const wahl = [...s.options].sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map((c) => `<option value="${c.id}" ${c.id === s.lose.id ? 'selected' : ''}>${esc(c.name)} (${c.initiative})${c.id === s.suggest.id ? ', Vorschlag' : ''}</option>`).join('');
    return `<li class="rast ${s.reserve ? 'reserve' : ''} ${s.chosen || s.early != null ? 'gewaehlt' : ''}">${frueh}<p>${what}</p>
      <label class="rast-wahl" for="rast-${s.index}">${s.long ? 'Andere Karte abgegeben?' : 'Welche Karte hat es getroffen?'}
        <select id="rast-${s.index}" class="auswahl" data-rast="${s.index}">${wahl}</select></label>
      <p class="hinweis">Danach ${s.handAfter} Karten auf der Hand.${s.chosen ? '' : ' Wählst du eine andere Karte, wird der Plan ab hier neu gerechnet.'}</p></li>`;
  }
  const notes = [...s.notes];
  if (s.fed.length) notes.push(`Nutzt ${s.fed.map(elemName).join(', ')} aus der Vorrunde.`);
  if (s.hungry.length) notes.push(`Der Bonus braucht ${s.hungry.map(elemName).join(', ')} von einem Mitspieler.`);
  if (s.lost.length) notes.push(s.finale ? 'Letzte Runde: Verlustaktionen kosten jetzt nichts mehr.' : 'Verlustaktion eingeplant. Nur spielen, wenn sie hier wirklich viel bewirkt.');
  const odds = s.odds.slice(0, 3).map((o) => `${esc(o.name)} in ${o.before} von ${o.of} Fällen`).join(', ');
  return `
    <li class="runde ${s.reserve ? 'reserve' : ''}" data-runde="${s.n}">
      <div class="runde-kopf"><span class="runde-nr">Runde ${s.n}</span><span class="runde-ini">Initiative ${s.lead}</span></div>
      ${actionHtml(s.top, 'oben')}
      ${actionHtml(s.bottom, 'unten')}
      <p class="hinweis">Führe mit der ${s.lead}: ${esc(s.leadWhy)}.${s.other !== s.lead ? ` Alternative: ${s.other}.` : ''}</p>
      ${odds ? `<p class="quote">Damit bist du dran vor: ${odds}.</p>` : ''}
      ${notes.length ? `<ul class="gruende">${notes.map((n) => `<li class="neutral">${esc(n)}</li>`).join('')}</ul>` : ''}
      ${einsatz.map((x) => `<p class="einsatz"><span class="marke gut">Gegenstand</span> <b>${esc(x.item.name)}</b>: ${esc(x.why)}</p>`).join('')}
      ${Object.entries(s.basicBy || {}).map(([side, i]) => `<p class="einsatz"><span class="marke gut">Eingetragen</span> Von <b>${esc(s[side].card.name)}</b> nur die Standardaktion gespielt, die Karte bleibt im Spiel. <button type="button" class="text-knopf" data-act="tisch-weg" data-i="${i}">Eingabe entfernen</button></p>`).join('')}
      <button type="button" class="text-knopf" data-act="tisch-offen" data-n="${s.n}" aria-expanded="${local.planOffen === s.n}">${local.planOffen === s.n ? 'Schließen' : 'Nach dieser Runde ist etwas passiert'}</button>
      ${local.planOffen === s.n ? tischHtml(s) : ''}
    </li>`;
}

// Eingaben vom Tisch nach einer Runde: Karte verloren, früher rasten, Element liegt aus
const ELEMENTE = ['fire', 'ice', 'air', 'earth', 'light', 'dark'];
function tischHtml(s) {
  const karten = [...s.pool].sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((c) => `<option value="${c.id}">${esc(c.name)} (${c.initiative})</option>`).join('');
  const liegt = new Set((local.planEvents || []).filter((e) => e.type === 'elements' && e.after === s.n).flatMap((e) => e.elements));
  const verlust = [['top', s.top], ['bottom', s.bottom]].filter(([, x]) => !x.basic && x.card[x.side].lost);
  const basis = verlust.length ? `<span class="feldname">In dieser Runde: Verlustaktion nicht genutzt</span>
      <div class="knopfreihe">${verlust.map(([side, x]) => `<button type="button" class="leise" data-act="tisch-basis" data-n="${s.n}" data-side="${side}">${esc(x.card.name)} nur als ${side === 'top' ? 'Angriff 2' : 'Bewegung 2'} gespielt</button>`).join('')}</div>` : '';
  return `<div class="tisch">
      ${basis}
      ${verlust.length ? '<span class="feldname">Nach dieser Runde</span>' : ''}
      <label class="rast-wahl" for="tisch-karte">Karte verloren, zum Beispiel um Schaden abzuwehren
        <select id="tisch-karte" class="auswahl">${karten}</select></label>
      <div class="knopfreihe">
        <button type="button" class="leise" data-act="tisch-karte" data-n="${s.n}" ${karten ? '' : 'disabled'}>Karte als verloren eintragen</button>
        <button type="button" class="leise" data-act="tisch-rast" data-n="${s.n}" ${s.canRest ? '' : 'disabled'}>Jetzt schon rasten</button>
      </div>
      <span class="feldname">Element liegt aus, zum Beispiel durch eine Angriffskarte</span>
      <div class="elemente">${ELEMENTE.map((e) => `<button type="button" class="leise" data-act="tisch-element" data-n="${s.n}" data-el="${e}" aria-pressed="${liegt.has(e)}">${esc(elemName(e))}</button>`).join('')}</div>
      <p class="hinweis">Die Runden bis hier bleiben stehen, alles danach wird neu gerechnet.</p>
    </div>`;
}

// Eine neue Eingabe nach Runde n: alles, was später eingetragen war, hängt davon ab und verfällt
function planSchnitt(n) {
  local.planEvents = local.planEvents.filter((e) => e.after <= n);
  const steps = local.planLetzter ? local.planLetzter.steps : [];
  const at = steps.findIndex((s) => s.type === 'round' && s.n === n);
  const rasten = steps.slice(0, at + 1).filter((s) => s.type === 'rest').length;
  local.rastVerlust = (local.rastVerlust || []).slice(0, rasten);
}

// Neu zeichnen, ohne dass die Stelle unter dem Finger wegspringt
function renderKeep(selector) {
  const li = (el) => (el ? el.closest('li') || el : null);
  const alt = selector ? li(view.querySelector(selector)) : null;
  const oben = alt ? alt.getBoundingClientRect().top : null;
  render();
  const neu = selector ? li(view.querySelector(selector)) : null;
  if (neu && oben != null) window.scrollBy(0, neu.getBoundingClientRect().top - oben);
}

function renderPlan() {
  if (!profile()) return needProfile('bekommst du einen Rundenplan für deine Hand');
  const c = character();
  const p = currentProfile();
  const sz = scenario();
  const all = pool();
  const cards = all.filter((x) => currentHand().includes(x.id));
  if (cards.length !== c.handSize) {
    view.innerHTML = `${scenarioBar()}<section class="leer-seite"><h2>Erst die Hand festlegen</h2><p>Der Plan braucht genau ${c.handSize} Handkarten, gewählt sind ${cards.length}.</p>
      <div class="knopfreihe"><button type="button" class="haupt" data-act="vorschlag-plan">Handvorschlag übernehmen und planen</button><button type="button" class="leise" data-go="hand">Hand selbst wählen</button></div></section>`;
    return;
  }
  const cal = calibration(state.shared.results);
  const est = estimateRounds(p, sz, cal.factor);
  const eigen = local.targets[sz.id] != null;
  const target = eigen ? local.targets[sz.id] : est.rounds;
  const getragen = (profile().items || []).filter((e) => e.worn).map((e) => data.items.find((i) => i.id === e.id)).filter(Boolean);
  const traenke = getragen.filter((i) => i.tags && i.tags.stamina && i.use === 'consumed').map((i) => ({ id: i.id, name: i.name, n: i.tags.stamina }));
  // Tatsächlich verlorene Karten gelten nur für genau diese Hand in diesem Szenario
  const rastKey = `${local.profile}|${local.scenario}|${local.longRest}|${cards.map((c) => c.id).sort().join(',')}`;
  if (local.rastKey !== rastKey) { local.rastKey = rastKey; local.rastVerlust = []; local.planEvents = []; local.planOffen = null; }
  const plan = autoPlan(cards, p, { target, longRest: local.longRest, tank: !!profile().tank, conditionName: condName, staminaItems: traenke, restLosses: local.rastVerlust, events: local.planEvents });
  local.planLetzter = plan;
  const rastGewaehlt = plan.steps.some((s) => s.type === 'rest' && s.chosen) || local.planEvents.length > 0;
  const gespart = plan.beforeLosses != null ? plan.beforeLosses - plan.lossesPlanned : 0;
  const kosten = plan.before == null ? '' : ` Deine Hand hält damit ${plan.before === plan.totalRounds ? `weiter ${plan.totalRounds}` : `${plan.totalRounds} statt ${plan.before}`} Runden${gespart > 0 ? `, weil der Plan dafür ${gespart === 1 ? 'eine Verlustaktion' : `${gespart} Verlustaktionen`} weniger einplant` : ''}.`;
  const einsatz = itemPlan(plan, getragen, p, { elementName: elemName, longRest: local.longRest });
  // In der Rundenliste stehen Gegenstände, die an eine bestimmte Karte gebunden sind. Tränke haben ihren eigenen Schritt.
  const jeRunde = (n) => einsatz.filter((x) => x.round === n && !(x.item.tags || {}).stamina && /^Runde \d+/.test(x.when));
  const typ = { normal: 'normal', elite: 'Elite', boss: 'Boss' };
  const urteil = !plan.enough
    ? `Deine Hand reicht auch ohne Verlustaktionen nur für ${plan.totalRounds} Runden. Für ${target} Runden brauchst du einen Ausdauertrank oder die Mitspieler müssen das Ende tragen.`
    : `Eingeplant ${plan.lossesPlanned === 1 ? 'ist 1 Verlustaktion' : `sind ${plan.lossesPlanned} Verlustaktionen`}${plan.itemsUsed ? ` und ${plan.itemsUsed === 1 ? 'dein Ausdauertrank' : `${plan.itemsUsed} Ausdauertränke`}` : ''}. Damit hält deine Hand ${plan.totalRounds} Runden, das ${plan.spare === 1 ? 'ist 1 Runde' : `sind ${plan.spare} Runden`} Reserve.`;
  let trenner = false;
  const schritte = plan.steps.map((s) => {
    const first = s.reserve && !trenner;
    if (first) trenner = true;
    return (first ? '<li class="trenner">Ab hier Reserve, falls das Szenario länger dauert als geschätzt.</li>' : '') + stepHtml(s, s.type === 'round' ? jeRunde(s.n) : []);
  }).join('');
  const inits = p.groups.map((g) => {
    const d = p.deckTraits[g.id];
    return d && d.inits ? `<li><b>${esc(g.name)}</b><span class="zahlenreihe">${d.inits.join(', ')}</span></li>` : '';
  }).join('');
  view.innerHTML = `
    ${scenarioBar()}
    <section>
      <h2>Dein Plan für dieses Szenario</h2>
      <div class="kennzahlen vier">
        <div><b>${plan.totalRounds}</b><span>Runden laut Plan</span></div>
        <div><b>${plan.damage}</b><span>Schaden</span></div>
        <div><b>${plan.share}</b><span>Gegnerleben je Spieler</span></div>
        <div><b>${plan.xp}</b><span>EP aus Karten</span></div>
      </div>
      <p>${p.enemies === 0 ? 'Für dieses Szenario sind keine Gegner hinterlegt.' : urteil}</p>
      <label class="regler">Das Szenario dauert etwa <output>${target}</output> Runden
        <input type="range" min="6" max="30" value="${target}" data-range="target">
      </label>
      <p class="hinweis">Schätzung der App: ${est.rounds} Runden${cal.n ? `, angepasst an ${cal.n} eingetragene Partien` : ''}. Je kürzer das Szenario, desto mehr Verlustaktionen plant sie früh ein. Unter „Notizen“ trägst du nach dem Abend die echte Rundenzahl ein.</p>
      ${eigen ? '<div class="knopfreihe"><button type="button" class="leise" data-act="ziel-reset">Zurück zur Schätzung</button></div>' : ''}
      <label class="haken"><input type="checkbox" data-check="longRest" ${local.longRest ? 'checked' : ''}> Ich mache lange Rasten</label>
      <label class="haken"><input type="checkbox" data-check="tank" ${profile().tank ? 'checked' : ''}> Ich will die Angriffe auf mich ziehen</label>
      <p class="hinweis">Der Plan kennt weder Positionen noch die gezogenen Monsterkarten. Nimm ihn als Reihenfolge-Vorschlag und weiche ab, wenn die Lage es verlangt.</p>
    </section>
    ${plan.killOrder.length ? `<section>
      <h2>Wen zuerst angreifen</h2>
      <ol class="ziele">${plan.killOrder.map((k) => `<li><b>${esc(k.name)}</b> (${k.count}× ${typ[k.type]})<br><span class="hinweis">${esc(k.why.join(', '))}</span></li>`).join('')}</ol>
    </section>` : ''}
    ${inits ? `<section>
      <h2>Wann die Gegner dran sind</h2>
      <ul class="initiativen">${inits}</ul>
      <p class="hinweis">Das sind die Initiativen der acht Karten je Monsterdeck. Bei Gleichstand bist du vor dem Monster dran.</p>
      <p class="hinweis">Fokus-Regel: Ein Monster greift an, wen es mit der wenigsten Bewegung erreicht. Bei Gleichstand den Näheren, danach den mit der früheren Initiative. Wer Angriffe auf sich ziehen will, steht vorn und geht früh.</p>
    </section>` : ''}
    <section>
      <h2>Deine Gegenstände im Plan</h2>
      ${einsatz.length ? `<ul class="einsaetze">${einsatz.map((x) => `<li><b>${esc(x.item.name)}</b><span class="wann">${esc(x.when)}</span><span class="hinweis">${esc(x.why)}</span></li>`).join('')}</ul>`
    : '<p class="leer">Du trägst keine Gegenstände. Trag sie im Charakterbildschirm unter „Ausrüstung“ ein, dann plant die App sie mit ein.</p>'}
      <p class="hinweis">Gerechnet wird mit den Gegenständen, die du unter „Ausrüstung“ als getragen markiert hast.</p>
    </section>
    <section>
      <h2>Runde für Runde</h2>
      ${rastGewaehlt ? `<p class="hinweis">Der Plan rechnet mit dem, was du vom Tisch eingetragen hast.${kosten} <button type="button" class="text-knopf" data-act="rast-zurueck">Zurück zum Vorschlag</button></p>` : ''}
      <ol class="plan">${schritte}</ol>
      <div class="knopfreihe"><button type="button" class="leise" data-go="notizen">Szenario abschließen</button></div>
    </section>`;
}

// ---------- Reiter: Notizen ----------

const perksGenommen = (p) => (((p.perks || {})[p.classId]) || []).reduce((n, x) => n + (x || 0), 0);

function renderNotes() {
  const s = scenario();
  const notes = state.shared.notes || {};
  const others = Object.entries(notes).filter(([id, t]) => t && Number(id) !== s.id).sort((a, b) => a[0] - b[0]);
  const res = (state.shared.results || {})[s.id];
  const cal = calibration(state.shared.results);
  const pr = profile();
  if (pr) heldDefaults(pr);
  const lvl = state.shared.level;
  const meins = res && pr ? (res.rewards || {})[local.profile] : null;
  view.innerHTML = `
    ${scenarioBar()}
    <section>
      <h2>Szenario abschließen</h2>
      ${pr ? `<p class="hinweis">Für ${esc(local.profile)}, Szenariostufe ${lvl}: ein Sieg bringt ${4 + 2 * lvl} EP Bonus, jede Münze ist ${scenarioReward({ level: lvl }).coinValue} Gold wert.</p>` : ''}
      <div class="abschluss">
        <label for="ergRunden">Gespielte Runden
          <input id="ergRunden" type="number" inputmode="numeric" enterkeyhint="done" min="1" max="60" placeholder="z. B. 14" value="${res ? res.rounds : ''}"></label>
        ${pr ? `<label for="ergEp">EP von deinen Karten
          <input id="ergEp" type="number" inputmode="numeric" enterkeyhint="done" min="0" max="99" placeholder="0" value="${meins ? meins.cardXp : ''}"></label>
        <label for="ergMuenzen">Eingesammelte Münzen
          <input id="ergMuenzen" type="number" inputmode="numeric" enterkeyhint="done" min="0" max="99" placeholder="0" value="${meins ? meins.coins : ''}"></label>
        <label for="ergZiel">Kampfziel
          <select id="ergZiel" class="auswahl">
            <option value="0" ${!meins || !meins.goal ? 'selected' : ''}>nicht geschafft</option>
            <option value="1" ${meins && meins.goal === 1 ? 'selected' : ''}>geschafft: 1 Haken</option>
            <option value="2" ${meins && meins.goal === 2 ? 'selected' : ''}>geschafft: 2 Haken</option>
          </select></label>` : ''}
      </div>
      <div class="knopfreihe">
        <button type="button" class="haupt" data-act="erg" data-won="1">${meins ? 'Als Sieg neu eintragen' : 'Sieg eintragen'}</button>
        <button type="button" class="leise" data-act="erg" data-won="0">${meins ? 'Als Niederlage neu eintragen' : 'Niederlage eintragen'}</button>
        ${res ? '<button type="button" class="leise" data-act="erg-weg">Eintrag löschen</button>' : ''}
      </div>
      ${res ? `<p class="gut-text">Eingetragen: ${res.rounds} Runden, ${res.won ? 'gewonnen' : 'verloren'}.${meins ? ` ${esc(local.profile)} hat dafür ${meins.xp} EP, ${meins.gold} Gold und ${meins.checks === 1 ? '1 Haken' : `${meins.checks} Haken`} bekommen.` : ''}</p>` : ''}
      ${meins && pr ? `<div class="knopfreihe">
        ${xpProgress(pr.xp, pr.level).ready ? '<button type="button" class="haupt" data-act="zum-held" data-held="aufstieg">Stufenaufstieg: Karte wählen</button>' : ''}
        ${perksAllowed(pr.level, pr.checks) > perksGenommen(pr) ? '<button type="button" class="leise" data-act="zum-held" data-held="deck">Ein Perk ist frei</button>' : ''}
      </div>` : ''}
      <p class="hinweis">${pr ? 'EP und Gold behältst du auch bei einer Niederlage, den Bonus und die Haken gibt es nur beim Sieg. Trägst du neu ein, wird der alte Eintrag vorher zurückgerechnet. ' : ''}Aus gewonnenen Partien lernt die App, wie lange eure Szenarien wirklich dauern, und plant die Verlustkarten danach.${cal.n ? ` Bisher ${cal.n} Partien: ihr braucht ${Math.round(cal.factor * 100)} % der geschätzten Runden.` : ''}</p>
    </section>
    <section>
      <h2>Notiz zu diesem Szenario</h2>
      <label><span class="sr">Notiz</span>
        <textarea id="notiz" rows="8" placeholder="Was hat funktioniert, was nicht? Beim nächsten Versuch seht ihr es hier wieder.">${esc(notes[s.id] || '')}</textarea>
      </label>
      <p class="hinweis">${OHNE_SERVER ? 'Notizen bleiben auf diesem Gerät.' : 'Notizen gelten für die ganze Gruppe und liegen auf eurem Server.'}</p>
    </section>
    ${others.length ? `<section><h2>Weitere Notizen</h2>${others.map(([id, t]) => `<article class="notiz"><button type="button" class="leise" data-act="szen" data-id="${id}">Szenario ${id}</button><p>${esc(t)}</p></article>`).join('')}</section>` : ''}
    ${updatesHtml()}`;
}

// ---------- Updates aus der App ----------

let updates = null; // Antwort von /api/updates, null = nicht eingerichtet
let updatesPoll = null;
const datum = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const ERGEBNIS = {
  aktualisiert: 'Update eingespielt.', aktuell: 'Die App ist bereits auf dem neuesten Stand.',
  zurueckgenommen: 'Der neue Stand ließ sich nicht starten. Die App läuft weiter mit dem vorherigen Stand.',
  kein_ff: 'Der Stand auf GitHub passt nicht zur installierten Version. Bitte von Hand prüfen.',
  offline: 'GitHub war nicht erreichbar. Internetverbindung des Pi prüfen.',
};

async function loadUpdates() {
  try { updates = await request('api/updates'); } catch { /* während des Neustarts oder nicht eingerichtet */ }
  return updates;
}

function updatesHtml() {
  if (!updates) return '';
  const s = updates.status;
  let body;
  if (!s) {
    body = '<p class="hinweis">Der Update-Dienst auf dem Pi hat sich noch nicht gemeldet. Nach dem Einrichten dauert das bis zu einer Minute.</p>';
  } else {
    const busy = s.laeuft || updates.anfrage;
    const inst = s.installiert ? `<p>Installiert: <b>${esc(s.installiert.titel)}</b><br><span class="hinweis">Stand ${esc(s.installiert.commit)} vom ${datum(s.installiert.datum)}</span></p>` : '';
    const neu = s.verfuegbar ? `
      <p class="update-neu">Neue Version verfügbar</p>
      <ul class="aenderungen">${(s.aenderungen || []).map((a) => `<li>${esc(a.titel)}</li>`).join('')}</ul>` : '<p class="gut-text">Die App ist auf dem neuesten Stand.</p>';
    const last = s.letztes && ERGEBNIS[s.letztes.ergebnis] ? `<p class="hinweis">Letzter Vorgang (${datum(s.letztes.zeit)}): ${ERGEBNIS[s.letztes.ergebnis]}${s.letztes.details ? ' ' + esc(s.letztes.details) : ''}</p>` : '';
    const still = updates.dienst_aktiv === false ? '<p class="fehlertext">Der Update-Dienst auf dem Pi meldet sich nicht mehr. Cron-Eintrag prüfen (crontab -l).</p>' : '';
    const state = s.laeuft ? 'Update wird eingespielt, das dauert ein paar Minuten …' : updates.anfrage === 'aktualisieren' ? 'Update angefordert, startet innerhalb einer Minute …' : updates.anfrage === 'pruefen' ? 'Prüfung angefordert, dauert bis zu einer Minute …' : '';
    body = `${inst}${busy ? '' : neu}${state ? `<p class="update-laeuft" role="status">${state}</p>` : ''}${still}${last}
      <div class="knopfreihe">
        ${s.verfuegbar && !busy ? '<button type="button" class="haupt" data-act="upd-aktualisieren">Jetzt aktualisieren</button>' : ''}
        ${busy ? '' : '<button type="button" class="leise" data-act="upd-pruefen">Nach Updates suchen</button>'}
      </div>
      ${s.geprueft ? `<p class="hinweis">Zuletzt bei GitHub nachgesehen: ${datum(s.geprueft * 1000)}</p>` : ''}`;
  }
  return `<section id="updates"><h2>App aktualisieren</h2>${body}</section>`;
}

function watchUpdates() {
  clearInterval(updatesPoll);
  const before = updates?.status?.installiert?.commit;
  let ticks = 0;
  updatesPoll = setInterval(async () => {
    ticks++;
    await loadUpdates();
    const s = updates?.status;
    const done = s && !s.laeuft && !updates.anfrage;
    if (done || ticks > 120) {
      clearInterval(updatesPoll);
      // Neuer Stand eingespielt: Seite neu laden, damit die neue Oberfläche kommt
      if (done && s.installiert && before && s.installiert.commit !== before) return location.reload();
    }
    renderHeader();
    if (local.tab === 'notizen' && document.activeElement?.id !== 'notiz') render();
  }, 5000);
}

async function askUpdate(aktion) {
  try {
    updates = await request('api/updates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aktion }) });
    watchUpdates();
  } catch (e) {
    setStatus('Update-Anfrage fehlgeschlagen.', true);
  }
  render();
}

// ---------- Darstellung und Ereignisse ----------

function render() {
  // Solange noch kein Held angelegt ist, führt jeder Weg ins Erst-Setup
  const erststart = !Object.keys(state.profiles).length;
  if (erststart) { if (!local.setup) setupStart(heldCtx); local.tab = 'setup'; }
  document.body.classList.toggle('erststart', erststart);
  renderHeader();
  if (local.tab === 'setup' && !local.setup) local.tab = profile() ? 'held' : 'szenario';
  if (local.tab === 'setup') { renderHeader(); return renderSetup(heldCtx); }
  if (local.tab === 'held' && !profile()) local.tab = 'szenario';
  if (local.tab === 'held') return renderHeld(heldCtx);
  ({ szenario: renderScenario, karten: renderCards, hand: renderHand, plan: renderPlan, notizen: renderNotes })[local.tab]();
}

// Was der Charakterbildschirm (held.js) von hier braucht
const heldCtx = {
  get data() { return data; },
  get state() { return state; },
  local, view, esc, seg, classIconHtml, halfHtml, condName, elemName, setStatus,
  profile, character, owned, pool, currentProfile, saveProfile, saveShared, render, classLabel, selectProfile,
};

function setScenario(id) {
  const ids = data.scenarios.map((s) => s.id);
  const max = ids[ids.length - 1];
  local.scenario = Math.max(1, Math.min(max, Math.round(Number(id)) || 1));
  localStorage.setItem('gp.szenario', local.scenario);
  local.showRooms = false;
  render();
}

document.querySelector('.reiter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  local.tab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
});

view.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.go) { local.tab = b.dataset.go; render(); window.scrollTo(0, 0); return; }
  if (local.tab === 'setup' && setupClick(heldCtx, b)) return;
  if (local.tab === 'held' && heldClick(heldCtx, b)) return;
  if (b.dataset.set) {
    const val = b.dataset.val;
    if (b.dataset.set === 'poolFilter') local.poolFilter = val;
    else { state.shared[b.dataset.set] = Number(val); saveShared(); }
    render();
    return;
  }
  const act = b.dataset.act;
  if (act === 'held') return openHeld();
  if (act === 'upd-pruefen') return askUpdate('pruefen');
  if (act === 'upd-aktualisieren') return askUpdate('aktualisieren');
  if (act === 'szen-') return setScenario(local.scenario - 1);
  if (act === 'szen+') return setScenario(local.scenario + 1);
  if (act === 'szen') return setScenario(b.dataset.id);
  if (act === 'raeume') { local.showRooms = !local.showRooms; return render(); }
  if (act === 'bild') {
    const d = $('#bildDialog');
    d.innerHTML = `<form method="dialog" class="dialog-inhalt"><img src="${esc(data.imageBase + b.dataset.img)}" alt="Karte ${esc(b.dataset.name)}"><p class="hinweis">Bild aus dem Worldhaven-Projekt, englische Ausgabe. Braucht Internet.</p><button class="haupt">Schließen</button></form>`;
    return d.showModal();
  }
  if (act === 'besitz') {
    const id = Number(b.dataset.id);
    const list = owned();
    const i = list.indexOf(id);
    if (i >= 0) {
      list.splice(i, 1);
      const h = currentHand();
      if (h.includes(id)) h.splice(h.indexOf(id), 1);
    } else list.push(id);
    saveProfile();
    return render();
  }
  if (act === 'hand') {
    const id = Number(b.dataset.id);
    const h = currentHand();
    const i = h.indexOf(id);
    if (i >= 0) h.splice(i, 1); else h.push(id);
    saveProfile();
    return render();
  }
  if (act === 'vorschlag') {
    const res = suggestHand(pool(), currentProfile(), character().handSize, { conditionName: condName });
    profile().hands[handKey()] = res.hand;
    saveProfile();
    return render();
  }
  if (act === 'vorschlag-plan') {
    profile().hands[handKey()] = suggestHand(pool(), currentProfile(), character().handSize, { conditionName: condName }).hand;
    saveProfile();
    return render();
  }
  if (act === 'leeren') { profile().hands[handKey()] = []; saveProfile(); return render(); }
  if (act === 'ziel-reset') { delete local.targets[local.scenario]; return render(); }
  if (act === 'rast-zurueck') { local.rastVerlust = []; local.planEvents = []; local.planOffen = null; return render(); }
  if (act === 'tisch-offen') { const n = Number(b.dataset.n); local.planOffen = local.planOffen === n ? null : n; return renderKeep(`[data-runde="${n}"]`); }
  if (act === 'tisch-basis') {
    const n = Number(b.dataset.n);
    // gilt für die Runde selbst: Eingaben nach dieser Runde verfallen, die davor bleiben
    planSchnitt(n);
    local.planEvents = local.planEvents.filter((e) => e.after < n || (e.type === 'basic' && e.side !== b.dataset.side));
    local.planEvents.push({ after: n, type: 'basic', side: b.dataset.side });
    local.planOffen = null;
    return renderKeep(`[data-runde="${n}"]`);
  }
  if (act === 'tisch-karte' || act === 'tisch-rast' || act === 'tisch-element') {
    const n = Number(b.dataset.n);
    if (act === 'tisch-element') {
      // Element an- oder abwählen, spätere Eingaben bleiben nur bei gleicher Runde erhalten
      const el = b.dataset.el;
      const da = local.planEvents.find((e) => e.type === 'elements' && e.after === n);
      planSchnitt(n);
      if (da) {
        da.elements = da.elements.includes(el) ? da.elements.filter((x) => x !== el) : [...da.elements, el];
        if (!da.elements.length) local.planEvents = local.planEvents.filter((e) => e !== da);
      } else local.planEvents.push({ after: n, type: 'elements', elements: [el] });
    } else {
      planSchnitt(n);
      if (act === 'tisch-karte') local.planEvents.push({ after: n, type: 'lose', card: Number($('#tisch-karte').value) });
      else local.planEvents.push({ after: n, type: 'rest' });
      local.planOffen = null;
    }
    return renderKeep(`[data-runde="${n}"]`);
  }
  if (act === 'tisch-weg') {
    const e = local.planEvents[Number(b.dataset.i)];
    if (e) { planSchnitt(e.after); local.planEvents = local.planEvents.filter((x) => x !== e); }
    return renderKeep(e ? `[data-runde="${e.after}"]` : null);
  }
  if (act === 'zum-held') { local.tab = 'held'; local.heldTab = b.dataset.held; render(); return window.scrollTo(0, 0); }
  if (act === 'erg' || act === 'erg-weg') {
    const results = (state.shared.results ||= {});
    const alt = results[local.scenario];
    const pr = profile();
    if (pr) heldDefaults(pr);
    // Einen früheren Eintrag dieses Helden zurückrechnen, damit nichts doppelt gutgeschrieben wird
    const zurueck = () => {
      const r = alt && pr ? (alt.rewards || {})[local.profile] : null;
      if (!r) return;
      pr.xp = Math.max(0, pr.xp - r.xp);
      pr.gold = Math.max(0, pr.gold - r.gold);
      pr.checks = Math.max(0, pr.checks - r.checks);
    };
    if (act === 'erg-weg') { zurueck(); delete results[local.scenario]; }
    else {
      const rounds = Math.round(Number($('#ergRunden').value));
      if (!(rounds > 0)) return setStatus('Bitte erst die Rundenzahl eintragen.', true);
      const p = currentProfile();
      const won = b.dataset.won === '1';
      const rewards = { ...((alt && alt.rewards) || {}) };
      if (pr) {
        zurueck();
        const cardXp = Math.max(0, Math.round(Number($('#ergEp').value) || 0));
        const coins = Math.max(0, Math.round(Number($('#ergMuenzen').value) || 0));
        const goal = Number($('#ergZiel').value) || 0;
        const r = scenarioReward({ level: state.shared.level, won, cardXp, coins, goal });
        const checks = Math.min(18, pr.checks + r.checks) - pr.checks;
        pr.xp += r.xp; pr.gold += r.gold; pr.checks += checks;
        local.epAlt = null;
        rewards[local.profile] = { xp: r.xp, gold: r.gold, checks, cardXp, coins, goal: won ? goal : 0 };
        setStatus(`${r.xp} EP und ${r.gold} Gold gutgeschrieben.`);
      }
      results[local.scenario] = { rounds, won, est: estimateRounds(p, scenario()).base, players: p.players, level: p.level, rewards };
    }
    if (pr) saveProfile();
    saveShared();
    return render();
  }
});

view.addEventListener('change', (e) => {
  if (e.target.id === 'szenNr') setScenario(e.target.value);
  if (local.tab === 'setup' && setupInput(heldCtx, e.target, true)) return;
  if (local.tab === 'held' && heldChange(heldCtx, e.target)) return;
  if (e.target.dataset.check === 'longRest') { local.longRest = e.target.checked; render(); }
  if (e.target.dataset.check === 'tank') { profile().tank = e.target.checked; saveProfile(); render(); }
  if (e.target.dataset.range === 'target') { local.targets[local.scenario] = Number(e.target.value); render(); }
  if (e.target.dataset.range === 'losses') { local.losses = Number(e.target.value); render(); }
  if (e.target.dataset.rast != null) {
    // Spätere Rasten hängen von dieser ab, ihre Auswahl verfällt
    const i = Number(e.target.dataset.rast);
    const wert = Number(e.target.value);
    const steps = local.planLetzter ? local.planLetzter.steps : [];
    const at = steps.findIndex((s) => s.type === 'rest' && s.index === i);
    const davor = steps.slice(0, Math.max(0, at)).filter((s) => s.type === 'round').length;
    local.planEvents = local.planEvents.filter((x) => x.after <= davor);
    local.rastVerlust = (local.rastVerlust || []).slice(0, i);
    local.rastVerlust[i] = wert;
    renderKeep(`#rast-${i}`);
  }
});
view.addEventListener('input', (e) => {
  if (local.tab === 'setup' && setupInput(heldCtx, e.target, false)) return;
  if (local.tab === 'held' && heldInput(heldCtx, e.target)) return;
  if (e.target.dataset.range === 'target') e.target.previousElementSibling.textContent = e.target.value;
  if (e.target.id === 'notiz') {
    (state.shared.notes ||= {})[local.scenario] = e.target.value;
    saveShared();
  }
  if (e.target.dataset.range === 'losses') e.target.previousElementSibling.textContent = e.target.value;
});

// ---------- Start ----------

async function start() {
  try {
    [data, state] = await Promise.all([request('api/data'), request('api/state')]);
  } catch (e) {
    view.innerHTML = `<section class="leer-seite"><h1>Daten nicht geladen</h1><p>${esc(e.message)}</p><button type="button" class="haupt" onclick="location.reload()">Neu laden</button></section>`;
    return;
  }
  state.shared ||= { players: 4, level: 1, notes: {} };
  state.profiles ||= {};
  if (!state.profiles[local.profile]) local.profile = Object.keys(state.profiles).length === 1 ? Object.keys(state.profiles)[0] : '';
  if (!data.scenarios.some((s) => s.id === local.scenario)) local.scenario = data.scenarios[0].id;
  // Beim allerersten Start direkt ins Anlegen des Charakters, sonst zur Auswahl
  if (!Object.keys(state.profiles).length) setupStart(heldCtx);
  render();
  if (!local.profile && Object.keys(state.profiles).length) openHeld();
  // Geräte-Variante: offline nutzbar machen. Neue Versionen kommen beim nächsten Öffnen mit Internet.
  if (OHNE_SERVER && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (OHNE_SERVER) return;
  loadUpdates().then((u) => {
    if (!u) return;
    render();
    if (u.anfrage || u.status?.laeuft) watchUpdates();
  });
}
start();
