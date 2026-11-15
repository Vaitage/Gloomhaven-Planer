// Erst-Setup: legt einen Charakter Schritt für Schritt an, auch einen, der schon
// länger gespielt wird (Stufe, Erfahrung, Gold, gewählte Karten, Perks, Ausrüstung).
// Der Entwurf liegt in ctx.local.setup und wird erst am Ende ins Profil geschrieben.
import { XP_LEVELS, perksAllowed, buildDeck, deckStats } from './logic.js';
import { perkListeHtml } from './held.js';

const SETUP_SLOTS = { head: 'Kopf', body: 'Körper', onehand: 'Eine Hand', twohand: 'Zwei Hände', legs: 'Beine', small: 'Klein' };
const NAME_OK = /^[\p{L}\p{N} _.-]{1,30}$/u;

// Neuer Entwurf. Mit "name" wird ein bestehender Charakter zum Bearbeiten geladen.
export function setupStart(ctx, name = null) {
  const alt = name ? ctx.state.profiles[name] : null;
  const classId = alt ? alt.classId : ctx.data.characters[0].id;
  ctx.local.setup = {
    step: 0, edit: alt ? name : null, fehler: '',
    name: alt ? name : '', classId,
    level: alt ? alt.level : 1,
    xp: alt && typeof alt.xp === 'number' ? String(alt.xp) : '',
    gold: alt && typeof alt.gold === 'number' ? String(alt.gold) : '',
    owned: alt ? [...((alt.owned || {})[classId] || [])] : [],
    perks: alt ? [...(((alt.perks || {})[classId]) || [])].map((n) => n || 0) : [],
    checks: alt ? alt.checks || 0 : 0,
    items: alt ? (alt.items || []).map((e) => e.id) : [],
    suche: '',
  };
  ctx.local.tab = 'setup';
}

const klasse = (ctx, d) => ctx.data.characters.find((c) => c.id === d.classId);
const schritte = (d) => ['wer', 'stand', ...(d.level > 1 ? ['karten'] : []), 'perks', 'ausruestung', 'fertig'];
const zahlOder = (text, fallback) => { const n = Math.round(Number(text)); return text !== '' && Number.isFinite(n) && n >= 0 ? n : fallback; };

// Farbe der gewählten Klasse, damit die App schon beim Anlegen umfärbt
export const setupFarbe = (ctx) => (ctx.local.setup ? (klasse(ctx, ctx.local.setup) || {}).color : null);

function werHtml(ctx, d) {
  const { esc } = ctx;
  return `
    <label class="feld" for="setupName">Name des Spielers
      <input id="setupName" data-setup="name" maxlength="30" autocomplete="off" placeholder="z. B. Robert" value="${esc(d.name)}" ${d.edit ? 'readonly' : ''}>
    </label>
    <label class="feld" for="setupKlasse">Klasse
      <select id="setupKlasse" class="auswahl" data-setup="classId">${ctx.data.characters.map((c) => `<option value="${c.id}" ${c.id === d.classId ? 'selected' : ''}>${esc(ctx.classLabel(c, c.id === d.classId))}</option>`).join('')}</select>
    </label>
    <p class="hinweis">Freischaltbare Klassen stehen mit ihrem Symbol in der Liste, damit nichts verraten wird. Die App färbt sich nach der gewählten Klasse.</p>
    <span class="feldname">Stufe des Charakters</span>
    <div class="seg" role="group" aria-label="Stufe">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<button type="button" data-act="setup-stufe" data-val="${l}" aria-pressed="${l === d.level}">${l}</button>`).join('')}</div>
    <p class="hinweis">Ein neuer Charakter beginnt auf Stufe 1. Spielst du ihn schon länger, wähle seine aktuelle Stufe.</p>`;
}

function standHtml(ctx, d) {
  const von = XP_LEVELS[d.level - 1];
  const bis = d.level < 9 ? XP_LEVELS[d.level] - 1 : null;
  return `
    <label class="feld" for="setupXp">Erfahrungspunkte
      <input id="setupXp" data-setup="xp" type="number" inputmode="numeric" enterkeyhint="done" min="0" max="999" placeholder="${von}" value="${ctx.esc(d.xp)}">
    </label>
    <p class="hinweis">Auf Stufe ${d.level} liegt der Stand ${bis == null ? `bei ${von} oder mehr` : `zwischen ${von} und ${bis}`}. Lässt du das Feld leer, trägt die App ${von} ein.</p>
    <label class="feld" for="setupGold">Gold
      <input id="setupGold" data-setup="gold" type="number" inputmode="numeric" enterkeyhint="done" min="0" max="9999" placeholder="0" value="${ctx.esc(d.gold)}">
    </label>
    <div class="haken-zeile">
      <span>Kampfziel-Haken</span>
      <span class="zaehler">
        <button type="button" data-act="setup-haken-" aria-label="Ein Haken weniger" ${d.checks ? '' : 'disabled'}>−</button>
        <b>${d.checks} / 18</b>
        <button type="button" data-act="setup-haken+" aria-label="Ein Haken mehr" ${d.checks >= 18 ? 'disabled' : ''}>+</button>
      </span>
    </div>
    <p class="hinweis">Die Haken stehen auf deinem Charakterbogen. Je drei geben einen zusätzlichen Perk.</p>`;
}

function kartenHtml(ctx, d) {
  const c = klasse(ctx, d);
  const soll = d.level - 1;
  const cards = c.cards.filter((x) => x.level !== 'X' && x.level >= 2 && x.level <= d.level);
  const gewaehlt = d.owned.filter((id) => cards.some((x) => x.id === id)).length;
  const karte = (x) => {
    const an = d.owned.includes(x.id);
    return `
      <article class="karte ${an ? 'in-hand' : ''}">
        <header>
          <span class="ini" title="Initiative">${String(x.initiative).padStart(2, '0')}</span>
          <div class="titel"><h3>${ctx.esc(x.name)}</h3><small>Stufe ${x.level}, Karte ${x.id}</small></div>
        </header>
        ${ctx.halfHtml(x.top, 'oben')}
        ${ctx.halfHtml(x.bottom, 'unten')}
        <footer><button type="button" class="${an ? 'haupt' : 'leise'}" data-act="setup-karte" data-id="${x.id}" aria-pressed="${an}">${an ? 'Besitze ich' : 'Habe ich nicht'}</button></footer>
      </article>`;
  };
  return `
    <p>Bei ${soll === 1 ? 'deinem Stufenaufstieg' : `deinen ${soll} Stufenaufstiegen`} hast du je eine Karte gewählt. Markiere, welche du besitzt.</p>
    <p class="${gewaehlt === soll ? 'gut-text' : 'update-neu'}">Markiert: ${gewaehlt} von ${soll}.</p>
    <p class="hinweis">Die Karten der Stufe 1 und die X-Karten gehören dir ohnehin. Initiative und Kartennummer findest du auf der gedruckten Karte.</p>
    <div class="kartenliste">${cards.map(karte).join('')}</div>`;
}

function perksHtml(ctx, d) {
  const c = klasse(ctx, d);
  const vergeben = d.perks.reduce((a, b) => a + (b || 0), 0);
  const erlaubt = perksAllowed(d.level, d.checks);
  const st = deckStats(buildDeck(c.perks, d.perks));
  return `
    <p>Trag ein, welche Perks auf deinem Charakterbogen angekreuzt sind.</p>
    <p class="${vergeben === erlaubt ? 'gut-text' : 'update-neu'}">Eingetragen: ${vergeben}. Auf Stufe ${d.level} mit ${d.checks} Kampfziel-Haken stehen dir ${erlaubt} zu.</p>
    ${perkListeHtml(ctx, c.perks, d.perks, { plus: 'setup-perk+', minus: 'setup-perk-' })}
    <p class="hinweis">Dein Angriffsdeck hat damit ${st.size} Karten. Hat ein früherer Charakter von dir den Ruhestand erreicht, kann es ein Perk mehr sein.</p>`;
}

function itemZeile(ctx, item, an) {
  return `
    <li class="${an ? 'an' : ''}">
      <span class="perk-text"><b>${ctx.esc(item.name)}</b> <small>Nr. ${item.id}, ${SETUP_SLOTS[item.slot] || item.slot}, ${item.cost} Gold</small>${item.text ? `<br><span class="hinweis">${ctx.esc(item.text)}</span>` : ''}</span>
      <button type="button" class="${an ? 'leise' : 'haupt'}" data-act="setup-item" data-id="${item.id}" aria-pressed="${an}">${an ? 'Entfernen' : 'Habe ich'}</button>
    </li>`;
}

export function setupTrefferHtml(ctx, d) {
  const text = String(d.suche || '').trim().toLowerCase();
  if (!text) return '<p class="hinweis">Tippe einen Namen oder die Nummer von der Karte ein.</p>';
  const num = /^\d+$/.test(text) ? Number(text) : null;
  const hits = ctx.data.items.filter((i) => (num != null ? i.id === num : i.name.toLowerCase().includes(text) || i.nameEn.toLowerCase().includes(text))).slice(0, 8);
  if (!hits.length) return '<p class="leer">Kein Gegenstand gefunden. Die Nummer steht unten auf der Karte.</p>';
  return `<ul class="perks">${hits.map((i) => itemZeile(ctx, i, d.items.includes(i.id))).join('')}</ul>`;
}

function setupAusruestungHtml(ctx, d) {
  const eigene = d.items.map((id) => ctx.data.items.find((i) => i.id === id)).filter(Boolean);
  return `
    <p>Welche Gegenstände besitzt dein Charakter schon? Du kannst das auch später im Charakterbildschirm nachtragen.</p>
    <label class="sr" for="setupSuche">Name oder Nummer</label>
    <input id="setupSuche" class="suche" type="search" data-setup="suche" autocomplete="off" enterkeyhint="search" autocapitalize="none" placeholder="Name oder Nummer, z. B. Stiefel oder 13" value="${ctx.esc(d.suche)}">
    <div id="setupTreffer">${setupTrefferHtml(ctx, d)}</div>
    <h3 class="zwischen">Eingetragen: ${eigene.length}</h3>
    ${eigene.length ? `<ul class="perks">${eigene.map((i) => itemZeile(ctx, i, true)).join('')}</ul>` : '<p class="leer">Noch nichts eingetragen.</p>'}`;
}

function fertigHtml(ctx, d) {
  const c = klasse(ctx, d);
  const xp = zahlOder(d.xp, XP_LEVELS[d.level - 1]);
  const gold = zahlOder(d.gold, 0);
  const karten = d.owned.filter((id) => c.cards.some((x) => x.id === id && x.level !== 'X' && x.level >= 2 && x.level <= d.level)).length;
  const perks = d.perks.reduce((a, b) => a + (b || 0), 0);
  return `
    <ul class="slots">
      <li><span class="slot-name">Spieler</span><span>${ctx.esc(d.name)}</span></li>
      <li><span class="slot-name">Klasse</span><span>${ctx.esc(c.name)}</span></li>
      <li><span class="slot-name">Stufe</span><span>${d.level}</span></li>
      <li><span class="slot-name">Erfahrung</span><span>${xp} EP</span></li>
      <li><span class="slot-name">Gold</span><span>${gold}</span></li>
      <li><span class="slot-name">Gewählte Karten</span><span>${karten} von ${d.level - 1}</span></li>
      <li><span class="slot-name">Perks</span><span>${perks} von ${perksAllowed(d.level, d.checks)}</span></li>
      <li><span class="slot-name">Gegenstände</span><span>${d.items.length}</span></li>
    </ul>
    <p class="hinweis">Alles lässt sich später im Charakterbildschirm ändern.</p>`;
}

const TITEL = {
  wer: 'Wer spielt welche Klasse?', stand: 'Erfahrung und Gold', karten: 'Deine Karten aus den Stufenaufstiegen',
  perks: 'Deine Perks', ausruestung: 'Deine Ausrüstung', fertig: 'Passt alles?',
};

export function renderSetup(ctx) {
  const d = ctx.local.setup;
  const liste = schritte(d);
  d.step = Math.max(0, Math.min(liste.length - 1, d.step));
  const art = liste[d.step];
  const body = { wer: werHtml, stand: standHtml, karten: kartenHtml, perks: perksHtml, ausruestung: setupAusruestungHtml, fertig: fertigHtml }[art](ctx, d);
  const letzter = d.step === liste.length - 1;
  const gibtProfile = Object.keys(ctx.state.profiles).length > 0;
  ctx.view.innerHTML = `
    <section class="setup">
      <p class="setup-schritt">${d.edit ? 'Charakter bearbeiten' : 'Charakter anlegen'}, Schritt ${d.step + 1} von ${liste.length}</p>
      <div class="setup-balken" aria-hidden="true"><i style="width:${Math.round(((d.step + 1) / liste.length) * 100)}%"></i></div>
      <h1>${TITEL[art]}</h1>
      ${body}
      ${d.fehler ? `<p class="fehlertext" role="alert">${ctx.esc(d.fehler)}</p>` : ''}
      <div class="setup-knoepfe">
        ${d.step > 0 ? '<button type="button" class="leise" data-act="setup-zurueck">Zurück</button>' : gibtProfile ? '<button type="button" class="leise" data-act="setup-abbrechen">Abbrechen</button>' : '<span></span>'}
        <button type="button" class="haupt" data-act="${letzter ? 'setup-fertig' : 'setup-weiter'}">${letzter ? (d.edit ? 'Änderungen speichern' : 'Charakter anlegen') : 'Weiter'}</button>
      </div>
    </section>`;
}

function abschliessen(ctx, d) {
  const c = klasse(ctx, d);
  const alt = d.edit ? ctx.state.profiles[d.edit] : null;
  const p = alt || { owned: {}, hands: {}, enh: {}, perks: {} };
  const getragen = new Map((p.items || []).map((e) => [e.id, e.worn]));
  p.classId = d.classId;
  p.level = d.level;
  p.xp = zahlOder(d.xp, XP_LEVELS[d.level - 1]);
  p.xpGeschaetzt = d.xp === '' && d.level > 1;
  p.gold = zahlOder(d.gold, 0);
  p.checks = d.checks;
  (p.owned ||= {})[d.classId] = d.owned.filter((id) => c.cards.some((x) => x.id === id));
  (p.perks ||= {})[d.classId] = c.perks.map((perk, i) => Math.min(perk.count, d.perks[i] || 0));
  p.items = d.items.map((id) => ({ id, worn: getragen.has(id) ? getragen.get(id) : true }));
  p.hands ||= {};
  p.enh ||= {};
  ctx.state.profiles[d.name] = p;
  ctx.selectProfile(d.name);
  ctx.local.setup = null;
  ctx.local.tab = 'held';
  ctx.local.heldTab = 'uebersicht';
  ctx.local.epAlt = null;
  ctx.saveProfile();
}

// Liefert true, wenn der Klick zum Setup gehörte.
export function setupClick(ctx, b) {
  const d = ctx.local.setup;
  const act = b.dataset.act || '';
  if (!d || !act.startsWith('setup-')) return false;
  d.fehler = '';
  const neu = () => { ctx.render(); return true; };
  const oben = () => { ctx.render(); window.scrollTo(0, 0); return true; };

  if (act === 'setup-abbrechen') { ctx.local.setup = null; ctx.local.tab = 'szenario'; return oben(); }
  if (act === 'setup-zurueck') { d.step--; return oben(); }
  if (act === 'setup-weiter') {
    if (schritte(d)[d.step] === 'wer') {
      d.name = d.name.trim();
      if (!NAME_OK.test(d.name)) { d.fehler = 'Bitte einen Namen aus Buchstaben und Ziffern eingeben (höchstens 30 Zeichen).'; return neu(); }
      if (!d.edit && ctx.state.profiles[d.name]) { d.fehler = `„${d.name}“ gibt es schon. Wähle einen anderen Namen oder bearbeite den bestehenden Charakter.`; return neu(); }
    }
    d.step++;
    return oben();
  }
  if (act === 'setup-fertig') { abschliessen(ctx, d); return oben(); }
  if (act === 'setup-stufe') { d.level = Number(b.dataset.val); return neu(); }
  if (act === 'setup-haken+' || act === 'setup-haken-') { d.checks = Math.max(0, Math.min(18, d.checks + (act.endsWith('+') ? 1 : -1))); return neu(); }
  if (act === 'setup-karte') {
    const id = Number(b.dataset.id);
    const at = d.owned.indexOf(id);
    if (at >= 0) d.owned.splice(at, 1); else d.owned.push(id);
    return neu();
  }
  if (act === 'setup-perk+' || act === 'setup-perk-') {
    const i = Number(b.dataset.i);
    const perk = klasse(ctx, d).perks[i];
    if (perk) d.perks[i] = Math.max(0, Math.min(perk.count, (d.perks[i] || 0) + (act.endsWith('+') ? 1 : -1)));
    for (let j = 0; j < d.perks.length; j++) d.perks[j] ||= 0;
    return neu();
  }
  if (act === 'setup-item') {
    const id = Number(b.dataset.id);
    const at = d.items.indexOf(id);
    if (at >= 0) d.items.splice(at, 1); else d.items.push(id);
    return neu();
  }
  return false;
}

// Eingaben in den Entwurf übernehmen. Liefert true, wenn das Feld zum Setup gehörte.
export function setupInput(ctx, target, fertig) {
  const d = ctx.local.setup;
  const feld = target.dataset.setup;
  if (!d || !feld) return false;
  if (feld === 'classId') {
    if (!fertig) return true;
    // Karten und Perks gehören zur Klasse, bei einem Wechsel beginnen sie leer
    d.classId = target.value;
    d.owned = [];
    d.perks = [];
    ctx.render();
    return true;
  }
  d[feld] = target.value;
  // Nur beim Tippen neu aufbauen. Beim Verlassen des Feldes (change) würde die Liste
  // sonst genau in dem Moment ersetzt, in dem jemand auf einen Treffer tippt.
  if (feld === 'suche' && !fertig) {
    const box = ctx.view.querySelector('#setupTreffer');
    if (box) box.innerHTML = setupTrefferHtml(ctx, d);
  }
  return true;
}
