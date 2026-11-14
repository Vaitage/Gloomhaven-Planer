import { scenarioProfile, cardPool, scoreCard, suggestHand, handStats, stamina } from './logic.js';

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
  losses: 1,
  longRest: false,
};

// ---------- Laden und Speichern ----------

const statusEl = $('#speicherStatus');
function setStatus(text, bad = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('fehler', bad);
}

async function request(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Fehler ${res.status}`);
  return res.json();
}

const timers = {};
function saveLater(key, path, getBody) {
  clearTimeout(timers[key]);
  setStatus('Speichert …');
  timers[key] = setTimeout(async () => {
    try {
      await request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getBody()) });
      setStatus('Gespeichert');
    } catch (e) {
      setStatus('Nicht gespeichert. Verbindung zum Server prüfen.', true);
    }
  }, 500);
}
const saveShared = () => saveLater('shared', '/api/state/shared', () => state.shared);
const saveProfile = () => {
  const name = local.profile;
  if (name) saveLater('p:' + name, '/api/state/profiles/' + encodeURIComponent(name), () => state.profiles[name]);
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
const pool = () => cardPool(character(), profile().level, owned());

function classLabel(c, reveal) {
  if (!c.locked) return c.name;
  return reveal ? `${c.name} (${SYMBOL[c.id] || c.id})` : `Symbol: ${SYMBOL[c.id] || c.id}`;
}

// ---------- Kopf ----------

function renderHeader() {
  const p = profile();
  const c = character();
  $('#heldName').textContent = c ? c.name : 'Held wählen';
  $('#heldSub').textContent = p && c ? `Stufe ${p.level}, ${local.profile}` : 'Tippen zum Einrichten';
  document.documentElement.style.setProperty('--klasse', c ? c.color : '#c9a24a');
  document.querySelectorAll('.reiter button').forEach((b) => {
    if (b.dataset.tab === local.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

// ---------- Held-Dialog ----------

const heldDialog = $('#heldDialog');
function openHeld() {
  const p = profile();
  const names = Object.keys(state.profiles).sort();
  heldDialog.innerHTML = `
    <form method="dialog" class="dialog-inhalt">
      <h2 id="heldDialogTitel">Wer plant?</h2>
      ${names.length ? `
        <label>Spieler
          <select name="profil">${names.map((n) => `<option ${n === local.profile ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="">Neuer Spieler …</option></select>
        </label>` : ''}
      <label class="neu-name" ${names.length ? 'hidden' : ''}>Dein Name
        <input name="name" maxlength="30" autocomplete="off" placeholder="z. B. Robert">
      </label>
      <label>Klasse
        <select name="klasse">${data.characters.map((c) => `<option value="${c.id}" ${p && p.classId === c.id ? 'selected' : ''}>${esc(classLabel(c, p && p.classId === c.id))}</option>`).join('')}</select>
      </label>
      <label>Stufe deines Helden
        <select name="stufe">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<option ${p && p.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <p class="hinweis">Freischaltbare Klassen stehen mit ihrem Symbol in der Liste, damit nichts verraten wird.</p>
      <p class="fehlertext" role="alert" hidden></p>
      <div class="dialog-knoepfe">
        ${p ? '<button type="button" class="leise" data-act="abbrechen">Abbrechen</button>' : ''}
        <button type="submit" class="haupt">Übernehmen</button>
      </div>
    </form>`;
  const form = $('form', heldDialog);
  const fill = (name) => {
    const q = state.profiles[name];
    form.klasse.value = q ? q.classId : form.klasse.value;
    form.stufe.value = q ? q.level : 1;
    $('.neu-name', form).hidden = !!name;
  };
  if (form.profil) form.profil.addEventListener('change', () => fill(form.profil.value));
  form.addEventListener('click', (e) => { if (e.target.dataset.act === 'abbrechen') heldDialog.close(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const existing = form.profil ? form.profil.value : '';
    const name = existing || form.name.value.trim();
    const err = $('.fehlertext', form);
    if (!/^[\p{L}\p{N} _.-]{1,30}$/u.test(name)) {
      err.textContent = 'Bitte einen Namen aus Buchstaben und Ziffern eingeben (höchstens 30 Zeichen).';
      err.hidden = false;
      return;
    }
    const q = (state.profiles[name] ||= { classId: form.klasse.value, level: 1, owned: {}, hands: {} });
    q.classId = form.klasse.value;
    q.level = Number(form.stufe.value);
    q.owned ||= {}; q.hands ||= {};
    local.profile = name;
    localStorage.setItem('gp.profil', name);
    saveProfile();
    heldDialog.close();
    render();
  });
  heldDialog.showModal();
}
$('#heldBtn').addEventListener('click', openHeld);

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
        <label><span class="sr">Szenarionummer</span><input id="szenNr" type="number" inputmode="numeric" min="1" max="95" value="${s.id}"></label>
        <button type="button" data-act="szen+" aria-label="Nächstes Szenario">›</button>
      </div>
      <h1>${esc(s.name)}</h1>
    </section>`;
}

function halfHtml(h, label) {
  const text = h.text.length ? h.text.map(esc).join(' · ') : 'keine Angabe';
  const tags = [h.lost ? '<span class="marke verlust">Verlust</span>' : '', h.persistent ? '<span class="marke">dauerhaft</span>' : '', h.round ? '<span class="marke">diese Runde</span>' : ''].join('');
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
  const cards = all ? c.cards.filter((x) => x.level === 'X' || x.level <= lvl) : pool();
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

// ---------- Reiter: Notizen ----------

function renderNotes() {
  const s = scenario();
  const notes = state.shared.notes || {};
  const others = Object.entries(notes).filter(([id, t]) => t && Number(id) !== s.id).sort((a, b) => a[0] - b[0]);
  view.innerHTML = `
    ${scenarioBar()}
    <section>
      <h2>Notiz zu diesem Szenario</h2>
      <label><span class="sr">Notiz</span>
        <textarea id="notiz" rows="8" placeholder="Was hat funktioniert, was nicht? Beim nächsten Versuch seht ihr es hier wieder.">${esc(notes[s.id] || '')}</textarea>
      </label>
      <p class="hinweis">Notizen gelten für die ganze Gruppe und liegen auf eurem Server.</p>
    </section>
    ${others.length ? `<section><h2>Weitere Notizen</h2>${others.map(([id, t]) => `<article class="notiz"><button type="button" class="leise" data-act="szen" data-id="${id}">Szenario ${id}</button><p>${esc(t)}</p></article>`).join('')}</section>` : ''}`;
}

// ---------- Darstellung und Ereignisse ----------

function render() {
  renderHeader();
  ({ szenario: renderScenario, karten: renderCards, hand: renderHand, notizen: renderNotes })[local.tab]();
}

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
  if (b.dataset.set) {
    const val = b.dataset.val;
    if (b.dataset.set === 'poolFilter') local.poolFilter = val;
    else { state.shared[b.dataset.set] = Number(val); saveShared(); }
    render();
    return;
  }
  const act = b.dataset.act;
  if (act === 'held') return openHeld();
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
  if (act === 'leeren') { profile().hands[handKey()] = []; saveProfile(); return render(); }
});

view.addEventListener('change', (e) => {
  if (e.target.id === 'szenNr') setScenario(e.target.value);
  if (e.target.dataset.check === 'longRest') { local.longRest = e.target.checked; render(); }
  if (e.target.dataset.range === 'losses') { local.losses = Number(e.target.value); render(); }
});
view.addEventListener('input', (e) => {
  if (e.target.id === 'notiz') {
    (state.shared.notes ||= {})[local.scenario] = e.target.value;
    saveShared();
  }
  if (e.target.dataset.range === 'losses') e.target.previousElementSibling.textContent = e.target.value;
});

// ---------- Start ----------

async function start() {
  try {
    [data, state] = await Promise.all([request('/api/data'), request('/api/state')]);
  } catch (e) {
    view.innerHTML = `<section class="leer-seite"><h1>Daten nicht geladen</h1><p>${esc(e.message)}</p><button type="button" class="haupt" onclick="location.reload()">Neu laden</button></section>`;
    return;
  }
  state.shared ||= { players: 4, level: 1, notes: {} };
  state.profiles ||= {};
  if (!state.profiles[local.profile]) local.profile = Object.keys(state.profiles).length === 1 ? Object.keys(state.profiles)[0] : '';
  if (!data.scenarios.some((s) => s.id === local.scenario)) local.scenario = data.scenarios[0].id;
  render();
  if (!local.profile) openHeld();
}
start();
