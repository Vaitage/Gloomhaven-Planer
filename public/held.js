// Charakterbildschirm: Erfahrung, Gold, Ausrüstung, Stufenaufstieg und Verbesserungen.
// Bekommt alles Nötige über "ctx" von app.js, damit hier kein eigener Zustand lebt.
import { xpProgress, XP_LEVELS, levelUpAdvice, shopAdvice, itemPrice, COIN_VALUE, prosperityLevel, PROSPERITY_STEPS, reputationPriceChange, scoreItem, attackFit, slotStickers, enhancementCost, enhancementAdvice, buildDeck, deckStats, perkAdvice, guidePerk, perksAllowed } from './logic.js';
import { GUIDES } from './tipps.js';

const SLOT_NAMEN = { head: 'Kopf', body: 'Körper', onehand: 'Eine Hand', twohand: 'Zwei Hände', legs: 'Beine', small: 'Kleiner Gegenstand' };
const SLOT_REIHE = ['head', 'body', 'onehand', 'twohand', 'legs', 'small'];
const NUTZUNG = { consumed: 'einmal pro Szenario', spent: 'nach langer Rast wieder nutzbar', passive: 'wirkt dauerhaft' };
const ZEILEN_NAMEN = {
  attack: 'Angriff', move: 'Bewegung', heal: 'Heilung', shield: 'Schild', retaliate: 'Vergeltung', range: 'Reichweite',
  target: 'Ziel', pierce: 'Durchbohren', push: 'Schieben', pull: 'Ziehen', condition: 'Zustand', area: 'Fläche', element: 'Element', loot: 'Beute',
};
const FORM_NAMEN = { square: 'Quadrat', circle: 'Kreis', diamond: 'Raute', diamond_plus: 'Raute mit Plus', hex: 'Sechseck' };
const MUENZWERT = COIN_VALUE; // Gold je Münze nach Szenariostufe
const HELD_REITER = [['uebersicht', 'Übersicht'], ['ausruestung', 'Ausrüstung'], ['aufstieg', 'Aufstieg'], ['deck', 'Angriffsdeck'], ['verbessern', 'Verbessern']];

// Ergänzt fehlende Felder bei Profilen, die vor dem Charakterbildschirm angelegt wurden.
export function heldDefaults(p) {
  if (typeof p.xp !== 'number') {
    p.xp = XP_LEVELS[Math.min(9, Math.max(1, p.level || 1)) - 1];
    p.xpGeschaetzt = (p.level || 1) > 1;
  }
  if (typeof p.gold !== 'number') p.gold = 0;
  p.items ||= [];
  p.enh ||= {};
  p.perks ||= {};
  if (typeof p.checks !== 'number') p.checks = 0;
  return p;
}

// ---------- Angriffsdeck und Perks ----------

const perkStand = (p) => ((p.perks ||= {})[p.classId] ||= []);
const perkSumme = (taken) => taken.reduce((a, b) => a + (b || 0), 0);
// −1-Karten, die getragene Rüstung ins Deck bringt
const itemMinus = (ctx, p) => p.items.filter((e) => e.worn).reduce((a, e) => a + ((itemById(ctx, e.id) || {}).tags?.minusOne || 0), 0);
const prozent = (x) => `${Math.round(x * 100)} %`;
const komma = (x) => Number(x).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function effektName(ctx, token) {
  const [kind, arg] = token.split(':');
  if (kind === 'element') return `${ctx.elemName(arg)} erzeugen`;
  const fest = { target: 'zusätzliches Ziel', heal: `Heilung ${arg}`, shield: `Schild ${arg}`, pierce: `Durchbohren ${arg}`, push: `Schieben ${arg}`, pull: `Ziehen ${arg}`, refresh: 'Gegenstand auffrischen' };
  return fest[kind] || ctx.condName(kind);
}

// Kartenschlüssel wie "+1R:stun" lesbar machen
function modName(ctx, key) {
  if (key === 'x2') return '×2';
  if (key === 'x0') return 'Fehlschlag';
  const m = key.match(/^([+-]\d+)(R?)(?::(.*))?$/);
  if (!m) return key;
  const fx = m[3] ? m[3].split('+').map((t) => {
    const n = t.match(/^(heal|shield|pierce|push|pull|target)(\d+)$/);
    if (n) return effektName(ctx, `${n[1]}:${n[2]}`);
    if (t === 'refresh') return effektName(ctx, 'refresh');
    return ctx.data.elementNames[t] ? `${ctx.elemName(t)} erzeugen` : ctx.condName(t);
  }).join(' und ') : '';
  return `${m[2] ? 'rollende ' : ''}${m[1].replace('-', '−')}${fx ? ` mit ${fx}` : ''}`;
}

// Liste aller Perks mit Zählern. "acts" nennt die Aktionen für Plus und Minus.
export function perkListeHtml(ctx, perks, taken, acts) {
  return `<ul class="perks">${perks.map((perk, i) => {
    const n = taken[i] || 0;
    return `<li class="${n ? 'an' : ''}">
      <span class="perk-text">${ctx.esc(perk.text)}</span>
      <span class="zaehler">
        <button type="button" data-act="${acts.minus}" data-i="${i}" aria-label="Einmal weniger" ${n ? '' : 'disabled'}>−</button>
        <b>${n} / ${perk.count}</b>
        <button type="button" data-act="${acts.plus}" data-i="${i}" aria-label="Einmal mehr" ${n >= perk.count ? 'disabled' : ''}>+</button>
      </span>
    </li>`;
  }).join('')}</ul>`;
}

function perkWirkung(ctx, x) {
  const teile = [`Schaden bei Angriff 3 im Schnitt ${komma(x.before.avg)} → ${komma(x.after.avg)}`];
  if (Math.abs(x.dWorse) > 0.004) teile.push(`schlechte Karte bei ${prozent(x.before.worse)} → ${prozent(x.after.worse)} der Angriffe`);
  const neu = Object.entries(x.after.effects).filter(([k, v]) => v - (x.before.effects[k] || 0) > 0.004)
    .map(([k, v]) => `${effektName(ctx, k)} bei ${prozent(v)} der Angriffe`);
  teile.push(...neu);
  if (x.perk.scenario) teile.push('hilft außerdem in Szenarien mit negativen Effekten');
  if (x.perk.item) teile.push(x.before.counts['-1'] !== x.after.counts['-1'] || itemMinusHinweis(x) ? 'hebt die −1-Karten deiner Rüstung auf' : 'lohnt vor allem mit schwerer Rüstung');
  return teile;
}
const itemMinusHinweis = (x) => x.before.size - x.after.size > 0;

function perkEmpfehlungHtml(ctx, p, c) {
  const { esc } = ctx;
  const taken = perkStand(p);
  const rat = perkAdvice(c.perks, taken, itemMinus(ctx, p));
  const guide = GUIDES[p.classId];
  const gi = guide && guide.perks ? guidePerk(c.perks, taken, guide.perks) : -1;
  const vergeben = perkSumme(taken);
  const erlaubt = perksAllowed(p.level, p.checks);
  const stand = `<p class="${vergeben < erlaubt ? 'update-neu' : 'hinweis'}">${vergeben < erlaubt
    ? `Du hast noch ${erlaubt - vergeben} ${erlaubt - vergeben === 1 ? 'Perk' : 'Perks'} zu vergeben.`
    : `Vergeben: ${vergeben} von ${erlaubt} Perks.`}</p>`;
  if (!rat.list.length) return `${stand}<p>Alle Perks dieser Klasse sind vergeben.</p>`;
  const zeile = (x, marke) => `
    <li>
      <p><b>${esc(x.perk.text)}</b></p>
      ${marke ? `<p>${marke}</p>` : ''}
      <ul class="gruende">${perkWirkung(ctx, x).map((t) => `<li class="neutral">${esc(t)}</li>`).join('')}</ul>
      <div class="knopfreihe"><button type="button" class="${marke ? 'haupt' : 'leise'}" data-act="perk+" data-i="${x.index}">Diesen Perk eintragen</button></div>
    </li>`;
  const laut = gi >= 0 ? rat.list.find((x) => x.index === gi) : null;
  const rest = rat.list.filter((x) => x !== laut).slice(0, laut ? 2 : 3);
  return `${stand}
    ${laut ? `<h3 class="zwischen">Empfehlung</h3><ol class="vorschlaege ohne-nummer">${zeile(laut, '<span class="marke gut">nächster Schritt laut Guide</span>')}</ol>` : ''}
    <h3 class="zwischen">${laut ? 'Rechnerisch am stärksten' : 'Empfehlung nach Rechnung'}</h3>
    <ol class="vorschlaege">${rest.map((x) => zeile(x, '')).join('')}</ol>
    <p class="hinweis">Die Rechnung vergleicht dein Deck vorher und nachher: mittlerer Schaden, Wert der Zusatzeffekte und wie oft eine schlechte Karte kommt.${laut ? ` Die Reihenfolge stammt aus dem ${esc(guide.quelle)}.` : ''}</p>`;
}

function deckHtml(ctx, p, c) {
  const taken = perkStand(p);
  const minus = itemMinus(ctx, p);
  const deck = buildDeck(c.perks, taken, minus);
  const st = deckStats(deck);
  const reihe = ['x2', '+4', '+3', '+2', '+1', '+0', '-1', '-2', 'x0'];
  const keys = Object.keys(st.counts).sort((a, b) => {
    const ra = reihe.indexOf(a), rb = reihe.indexOf(b);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.localeCompare(b);
  });
  const fx = Object.entries(st.effects).sort((a, b) => b[1] - a[1]);
  return `
    <section>
      <h2>Dein Angriffsdeck</h2>
      <div class="kennzahlen vier">
        <div><b>${komma(st.avg)}</b><span>Schaden bei Angriff 3</span></div>
        <div><b>${prozent(st.miss)}</b><span>Fehlschlag</span></div>
        <div><b>${prozent(st.worse)}</b><span>schlechter als +0</span></div>
        <div><b>${prozent(st.better)}</b><span>besser als +0</span></div>
      </div>
      <ul class="deckkarten">${keys.map((k) => `<li><b>${st.counts[k]}×</b> ${ctx.esc(modName(ctx, k))}</li>`).join('')}</ul>
      <p class="hinweis">${st.size} Karten, davon ${st.rolling} rollend.${minus && !deck.ignoreItem ? ` Deine Rüstung bringt ${minus}× −1 ins Deck.` : ''}${minus && deck.ignoreItem ? ' Die −1-Karten deiner Rüstung zählen dank Perk nicht.' : ''}${deck.ignoreScenario ? ' Negative Szenarioeffekte ignorierst du.' : ''}</p>
      ${fx.length ? `<p class="hinweis">Zusatzeffekte je Angriff: ${fx.map(([k, v]) => `${ctx.esc(effektName(ctx, k))} ${prozent(v)}`).join(', ')}.</p>` : ''}
    </section>
    <section>
      <h2>Nächster Perk</h2>
      ${perkEmpfehlungHtml(ctx, p, c)}
    </section>
    <section>
      <h2>Deine Perks</h2>
      <p class="hinweis">Trag ein, was auf deinem Charakterbogen angekreuzt ist.</p>
      ${perkListeHtml(ctx, c.perks, taken, { plus: 'perk+', minus: 'perk-' })}
      <div class="haken-zeile">
        <span>Kampfziel-Haken</span>
        <span class="zaehler">
          <button type="button" data-act="haken-" aria-label="Ein Haken weniger" ${p.checks ? '' : 'disabled'}>−</button>
          <b>${p.checks} / 18</b>
          <button type="button" data-act="haken+" aria-label="Ein Haken mehr" ${p.checks >= 18 ? 'disabled' : ''}>+</button>
        </span>
      </div>
      <p class="hinweis">Jeder Stufenaufstieg gibt einen Perk, je drei Kampfziel-Haken einen weiteren. Auf Stufe ${p.level} mit ${p.checks} Haken sind das ${perksAllowed(p.level, p.checks)}.</p>
    </section>`;
}

const itemById = (ctx, id) => ctx.data.items.find((i) => i.id === id);
const seiteName = (side) => (side === 'top' ? 'oben' : 'unten');

export function stickerName(ctx, sticker, on) {
  if (sticker === 'plus1') return `+1 ${ZEILEN_NAMEN[on] || on}`;
  if (sticker === 'jump') return 'Springen';
  if (sticker === 'hex') return 'zusätzliches Feld';
  if (sticker === 'el:wild') return 'beliebiges Element erzeugen';
  if (sticker.startsWith('el:')) return `${ctx.elemName(sticker.slice(3))} erzeugen`;
  return ctx.condName(sticker);
}

// ---------- Übersicht ----------

function epBalken(ctx, p) {
  const pr = xpProgress(p.xp, p.level);
  const pct = Math.round(pr.ratio * 100);
  const start = ctx.local.epAlt ?? pct;
  const text = pr.to == null ? `${p.xp} EP` : `${p.xp} / ${pr.to} EP`;
  const unter = pr.to == null ? 'Höchststufe erreicht.' : pr.ready ? 'Genug Erfahrung für den Aufstieg.' : `Noch ${pr.missing} EP bis Stufe ${p.level + 1}.`;
  return `
    <div class="ep ${pr.ready ? 'bereit' : ''}">
      <div class="ep-stufen"><span>Stufe ${p.level}</span>${pr.to == null ? '' : `<span>Stufe ${p.level + 1}</span>`}</div>
      <div class="ep-rahmen" role="progressbar" aria-label="Erfahrung" aria-valuemin="${pr.from}" aria-valuemax="${pr.to ?? p.xp}" aria-valuenow="${Math.min(p.xp, pr.to ?? p.xp)}" aria-valuetext="${text}">
        <div class="ep-fuellung" id="epFuellung" style="width:${start}%" data-ziel="${pct}"></div>
        <div class="ep-teiler" aria-hidden="true"></div>
        <span class="ep-text">${text}</span>
      </div>
      <p class="ep-unter">${unter}</p>
    </div>`;
}

function rechner(id, label, plus, minus) {
  return `
    <div class="rechner">
      <label class="sr" for="${id}">${label}</label>
      <input id="${id}" type="number" inputmode="numeric" enterkeyhint="done" min="0" max="9999" placeholder="${label}">
      <button type="button" class="haupt" data-act="${plus}">Dazurechnen</button>
      <button type="button" class="leise" data-act="${minus}">Abziehen</button>
    </div>`;
}

function slotWarnungen(p, getragen) {
  const n = (slot) => getragen.filter((i) => i.slot === slot).length;
  const klein = Math.ceil(p.level / 2);
  const w = [];
  if (n('head') > 1) w.push('Du trägst mehr als einen Gegenstand am Kopf.');
  if (n('body') > 1) w.push('Du trägst mehr als eine Rüstung.');
  if (n('legs') > 1) w.push('Du trägst mehr als ein Paar Schuhe.');
  if (n('twohand') * 2 + n('onehand') > 2) w.push('Du hast mehr in den Händen, als zwei Hände halten können.');
  if (n('small') > klein) w.push(`Auf Stufe ${p.level} darfst du ${klein} kleine Gegenstände tragen, gewählt sind ${n('small')}.`);
  return w;
}

function uebersichtHtml(ctx, p, c) {
  const { esc, state } = ctx;
  const lvl = state.shared.level;
  const bonus = 4 + 2 * lvl;
  const pr = xpProgress(p.xp, p.level);
  const getragen = p.items.filter((e) => e.worn).map((e) => itemById(ctx, e.id)).filter(Boolean);
  const warn = slotWarnungen(p, getragen);
  const slots = SLOT_REIHE.map((slot) => {
    const list = getragen.filter((i) => i.slot === slot);
    return list.length ? `<li><span class="slot-name">${SLOT_NAMEN[slot]}</span><span>${list.map((i) => esc(i.name)).join(', ')}</span></li>` : '';
  }).join('');
  return `
    <section>
      <h2>Erfahrung</h2>
      ${epBalken(ctx, p)}
      ${pr.ready ? `<div class="aufstieg-ruf"><b>Stufenaufstieg möglich</b><button type="button" class="haupt" data-held="aufstieg">Karte wählen</button></div>` : ''}
      ${p.xpGeschaetzt ? '<p class="hinweis">Dein EP-Stand ist noch nicht eingetragen. Gib ihn ein und tippe auf „Als Gesamtstand setzen“.</p>' : ''}
      ${rechner('epWert', 'EP', 'ep-plus', 'ep-minus')}
      <div class="knopfreihe">
        <button type="button" class="leise" data-act="ep-bonus" data-wert="${bonus}">Szenario geschafft: +${bonus} EP</button>
        <button type="button" class="leise" data-act="ep-setzen">Als Gesamtstand setzen</button>
      </div>
      <p class="hinweis">Der Szenario-Bonus gilt für Szenariostufe ${lvl}. Die EP von deinen Karten kommen dazu.</p>
    </section>
    <section>
      <h2>Gold</h2>
      <p class="gold"><span class="muenze" aria-hidden="true"></span><b>${p.gold}</b> Gold</p>
      ${rechner('goldWert', 'Gold', 'gold-plus', 'gold-minus')}
      <div class="knopfreihe">
        <button type="button" class="leise" data-act="gold-setzen">Als Gesamtstand setzen</button>
      </div>
      <p class="hinweis">Bei Szenariostufe ${lvl} ist jede eingesammelte Münze ${MUENZWERT[lvl] ?? 2} Gold wert.</p>
    </section>
    <section>
      <h2>${esc(c.name)}</h2>
      <div class="kennzahlen drei">
        <div><b>${c.health[p.level - 1] ?? '?'}</b><span>Leben</span></div>
        <div><b>${c.handSize}</b><span>Handkarten</span></div>
        <div><b>${Math.ceil(p.level / 2)}</b><span>kleine Gegenstände</span></div>
      </div>
      ${slots ? `<ul class="slots">${slots}</ul>` : '<p class="leer">Noch keine Ausrüstung eingetragen.</p>'}
      ${warn.length ? `<ul class="einschaetzung">${warn.map((x) => `<li class="warn">${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="knopfreihe">
        <button type="button" class="leise" data-held="ausruestung">Ausrüstung bearbeiten</button>
        <button type="button" class="leise" data-held="deck">Angriffsdeck und Perks</button>

      </div>
    </section>`;
}

// ---------- Ausrüstung ----------

function gegenstandHtml(ctx, item, knoepfe, zusatz = '') {
  const { esc, data } = ctx;
  const bild = item.img && data.itemImageBase
    ? `<img class="g-bild" src="${esc(data.itemImageBase + item.img)}" alt="" loading="lazy" width="72" height="101" onerror="this.hidden=true">` : '';
  return `
    <article class="gegenstand">
      ${bild}
      <div class="g-inhalt">
        <h3>${esc(item.name)} <small>Nr. ${item.id}</small></h3>
        <p class="g-meta">${SLOT_NAMEN[item.slot] || item.slot}, ${preisText(ctx, item)}, ${NUTZUNG[item.use]}</p>
        ${item.text ? `<p class="g-text">${esc(item.text)}</p>` : ''}
        ${zusatz}
        <footer>${knoepfe}</footer>
      </div>
    </article>`;
}

function grundeHtml(why) {
  return why.length ? `<ul class="gruende">${why.map((w) => `<li class="neutral">${w}</li>`).join('')}</ul>` : '';
}

const ruf = (ctx) => ctx.state.shared.reputation || 0;
// Wohlstand in Punkten. Alte Stände kennen nur die Stufe, dann zählt deren erster Punkt.
function wohlstand(ctx) {
  const sh = ctx.state.shared;
  return prosperityLevel(sh.prosperityPoints != null ? sh.prosperityPoints : PROSPERITY_STEPS[(sh.prosperity || 1) - 1]);
}
function wohlstandSetzen(ctx, punkte) {
  const w = prosperityLevel(punkte);
  ctx.state.shared.prosperityPoints = w.points;
  ctx.state.shared.prosperity = w.level;
}
// Preis mit Ansehen, der aufgedruckte Preis steht dabei, wenn er abweicht
function preisText(ctx, item) {
  const preis = itemPrice(item, ruf(ctx));
  return preis === item.cost ? `${item.cost} Gold` : `${preis} Gold (aufgedruckt ${item.cost})`;
}

function kaufKnoepfe(ctx, p, item) {
  const preis = itemPrice(item, ruf(ctx));
  const fehlt = preis - p.gold;
  return `${fehlt > 0
    ? `<span class="g-fehlt">Dir fehlen ${fehlt} Gold</span>`
    : `<button type="button" class="haupt" data-act="item-kauf" data-id="${item.id}">Kaufen für ${preis} Gold</button>`}
    <button type="button" class="leise" data-act="item-hab" data-id="${item.id}">Habe ich schon</button>`;
}

export function sucheHtml(ctx, q) {
  const { esc, data } = ctx;
  const p = ctx.profile();
  const text = String(q || '').trim().toLowerCase();
  if (!text) return '<p class="hinweis">Tippe einen Namen oder die Nummer von der Karte ein.</p>';
  const have = new Set(p.items.map((e) => e.id));
  const num = /^\d+$/.test(text) ? Number(text) : null;
  const hits = data.items.filter((i) => (num != null ? i.id === num : i.name.toLowerCase().includes(text) || i.nameEn.toLowerCase().includes(text))).slice(0, 8);
  if (!hits.length) return `<p class="leer">Kein Gegenstand gefunden für „${esc(q)}“. Die Nummer steht unten auf der Karte.</p>`;
  return hits.map((i) => gegenstandHtml(ctx, i, have.has(i.id) ? '<span class="g-fehlt">Hast du schon</span>' : kaufKnoepfe(ctx, p, i))).join('');
}

function rufText(r) {
  const d = reputationPriceChange(r);
  const naechste = Math.abs(r) < 3 ? 3 : Math.abs(r) >= 19 ? null : Math.floor((Math.abs(r) - 3) / 4) * 4 + 7;
  const jetzt = d < 0 ? `Jeder Gegenstand kostet ${-d} Gold weniger.` : d > 0 ? `Jeder Gegenstand kostet ${d} Gold mehr.` : 'Bei diesem Ansehen gelten die aufgedruckten Preise.';
  const dann = naechste == null ? '' : r >= 0 ? ` Ab Ansehen +${naechste} wird es ${d < 0 ? 'noch ' : ''}1 Gold billiger.` : ` Ab Ansehen −${naechste} wird es ${d > 0 ? 'noch ' : ''}1 Gold teurer.`;
  return `${jetzt}${dann} Verkauft wird immer zum halben aufgedruckten Preis.`;
}

function ausruestungHtml(ctx, p) {
  const { esc, state } = ctx;
  const profil = ctx.currentProfile();
  const fit = attackFit(ctx.pool());
  const eigene = p.items.map((e) => ({ e, item: itemById(ctx, e.id) })).filter((x) => x.item)
    .sort((a, b) => SLOT_REIHE.indexOf(a.item.slot) - SLOT_REIHE.indexOf(b.item.slot));
  const warn = slotWarnungen(p, eigene.filter((x) => x.e.worn).map((x) => x.item));
  const liste = eigene.map(({ e, item }) => {
    const s = scoreItem(item, profil, ctx.condName, fit);
    const zusatz = `<p class="g-wert">Nutzen in Szenario ${ctx.local.scenario}: <b>${s.score.toFixed(1)}</b></p>${grundeHtml(s.why.map(esc))}`;
    return gegenstandHtml(ctx, item, `
      <button type="button" class="leise" data-act="item-trage" data-id="${item.id}" aria-pressed="${!!e.worn}">${e.worn ? 'Trage ich' : 'Im Lager'}</button>
      <button type="button" class="leise" data-act="item-verkauf" data-id="${item.id}">Verkaufen für ${Math.floor(item.cost / 2)} Gold</button>
      <button type="button" class="leise" data-act="item-weg" data-id="${item.id}">Entfernen</button>`, zusatz);
  }).join('');

  const wohl = wohlstand(ctx);
  const prosp = wohl.level;
  const laden = shopAdvice(ctx.data, profil, { gold: p.gold, prosperity: prosp, reputation: ruf(ctx), owned: p.items.map((e) => e.id), cn: ctx.condName, cards: ctx.pool() });
  const leistbar = laden.filter((x) => x.affordable).slice(0, 4);
  const sparen = laden.filter((x) => !x.affordable).slice(0, 3);
  const zeile = (x) => gegenstandHtml(ctx, x.item, kaufKnoepfe(ctx, p, x.item),
    `<p class="g-wert">Nutzen in Szenario ${ctx.local.scenario}: <b>${x.score.toFixed(1)}</b></p>${grundeHtml(x.why.map(esc))}`);
  const guide = GUIDES[p.classId];
  const guideListe = guide && guide.gegenstaende
    ? guide.gegenstaende.map((n) => ctx.data.items.find((i) => i.nameEn === n)).filter(Boolean) : [];

  return `
    <section>
      <h2>Deine Ausrüstung</h2>
      <p class="gold klein"><span class="muenze" aria-hidden="true"></span><b>${p.gold}</b> Gold</p>
      ${warn.length ? `<ul class="einschaetzung">${warn.map((x) => `<li class="warn">${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="g-liste">${liste || '<p class="leer">Noch nichts eingetragen. Such unten nach deinen Gegenständen und füge sie hinzu.</p>'}</div>
    </section>
    <section>
      <h2>Gegenstand suchen</h2>
      <label class="sr" for="itemSuche">Name oder Nummer</label>
      <input id="itemSuche" class="suche" type="search" autocomplete="off" enterkeyhint="search" autocapitalize="none" placeholder="Name oder Nummer, z. B. Stiefel oder 13" value="${esc(ctx.local.itemSuche || '')}">
      <div id="itemTreffer" class="g-liste">${sucheHtml(ctx, ctx.local.itemSuche)}</div>
      <p class="hinweis">Die Suche kennt alle 150 Gegenstände, auch solche, die ihr noch nicht freigeschaltet habt. Die Nummer verrät nichts.</p>
    </section>
    <section>
      <h2>Was sich im Laden lohnt</h2>
      <div class="gruppe">
        <div>
          <label class="feldname" for="wohlstandPunkte">Wohlstand der Stadt</label>
          <div class="zaehler">
            <button type="button" class="leise" data-act="wohlstand-minus" aria-label="Wohlstand um 1 senken" ${wohl.points <= 0 ? 'disabled' : ''}>−</button>
            <input id="wohlstandPunkte" type="number" inputmode="numeric" enterkeyhint="done" min="0" max="64" value="${wohl.points}">
            <button type="button" class="leise" data-act="wohlstand-plus" aria-label="Wohlstand um 1 erhöhen" ${wohl.points >= 64 ? 'disabled' : ''}>+</button>
          </div>
          <p class="hinweis"><b>Stufe ${wohl.level}.</b> ${wohl.missing ? `Noch ${wohl.missing === 1 ? '1 Punkt' : `${wohl.missing} Punkte`} bis Stufe ${wohl.level + 1}.` : 'Höchste Stufe.'} Die Stufe bestimmt, welche Gegenstände es im Laden gibt.</p>
        </div>
        <div>
          <label class="feldname" for="ansehenWert">Ansehen eurer Gruppe</label>
          <div class="zaehler">
            <button type="button" class="leise" data-act="ruf-minus" aria-label="Ansehen um 1 senken" ${ruf(ctx) <= -20 ? 'disabled' : ''}>−</button>
            <input id="ansehenWert" type="number" inputmode="numeric" enterkeyhint="done" min="-20" max="20" value="${ruf(ctx)}">
            <button type="button" class="leise" data-act="ruf-plus" aria-label="Ansehen um 1 erhöhen" ${ruf(ctx) >= 20 ? 'disabled' : ''}>+</button>
          </div>
          <p class="hinweis">${rufText(ruf(ctx))}</p>
        </div>
      </div>
      <p class="hinweis">Beide Werte stehen auf eurem Gruppenbogen und gelten für alle Helden.</p>
      <p class="hinweis">Bewertet für Szenario ${ctx.local.scenario} und deine Karten. Die Einordnung stammt aus dem Regeltext der Gegenstände und ist grob.</p>
      <h3 class="zwischen">Mit deinen ${p.gold} Gold bezahlbar</h3>
      <div class="g-liste">${leistbar.map(zeile).join('') || `<p class="leer">${p.gold ? 'Dafür reicht dein Gold gerade nicht.' : 'Trag unter „Übersicht“ dein Gold ein, dann siehst du hier, was du dir leisten kannst.'}</p>`}</div>
      ${sparen.length ? `<h3 class="zwischen">Darauf lohnt es sich zu sparen</h3><div class="g-liste">${sparen.map(zeile).join('')}</div>` : ''}
      ${guideListe.length ? `<p class="hinweis">Reihenfolge laut ${esc(guide.quelle)}: ${guideListe.map((i) => esc(i.name)).join(', ')}.</p>` : ''}
    </section>`;
}

// ---------- Stufenaufstieg ----------

let aufstiegMerker = { key: '', rat: null };

function aufstiegHtml(ctx, p, c) {
  const { esc, state } = ctx;
  if (p.level >= 9) return '<section><h2>Stufenaufstieg</h2><p>Du hast die Höchststufe erreicht.</p></section>';
  const owned = ctx.owned();
  const key = `${p.classId}|${p.level}|${[...owned].sort().join(',')}|${state.shared.players}`;
  if (aufstiegMerker.key !== key) aufstiegMerker = { key, rat: levelUpAdvice(ctx.data, c, p.level, owned, state.shared.players, ctx.condName) };
  const rat = aufstiegMerker.rat;
  const pr = xpProgress(p.xp, p.level);
  const guide = GUIDES[p.classId];
  const roh = guide && guide.aufstieg ? guide.aufstieg[rat.next] : null;
  // Kartennamen im Guide-Text deutsch und mit Initiative zeigen
  const klassenKarten = ctx.data.characters.find((x) => x.id === p.classId).cards;
  const tipp = roh ? { ...roh, grund: mitInitiative(roh.grund || '', klassenKarten), alt: roh.alt ? mitInitiative(roh.alt, klassenKarten) : roh.alt } : null;
  const guideWahl = tipp ? rat.candidates.find((x) => x.card.nameEn === tipp.karte) : null;
  const rechnung = rat.best;
  const empfohlen = guideWahl || rechnung;

  let urteil = '';
  if (!empfohlen) urteil = '<p>Für diese Stufe sind keine Karten hinterlegt.</p>';
  else if (guideWahl && rechnung.card.id === guideWahl.card.id) {
    urteil = `<p><b>Empfehlung: ${esc(guideWahl.card.name)}.</b> ${esc(tipp.grund)} Guide und Rechnung kommen zum selben Ergebnis.</p>`;
  } else if (guideWahl) {
    urteil = `<p><b>Empfehlung: ${esc(guideWahl.card.name)}.</b> ${esc(tipp.grund)}</p>
      <p class="hinweis">Rein rechnerisch liegt ${esc(rechnung.card.name)} vorn. Die Rechnung sieht vor allem Schaden und Zahlenwerte. Lichterzeugung, Unterstützung für Mitspieler und Sondertexte wiegt der Guide besser ab, deshalb folgt die Empfehlung ihm.</p>`;
  } else {
    urteil = `<p><b>Empfehlung: ${esc(rechnung.card.name)}.</b> Für diese Klasse ist kein Guide hinterlegt. Die Empfehlung kommt aus dem Vergleich über ${rat.scenarios} Szenarien.</p>`;
  }

  const karte = (x) => {
    const marken = [
      guideWahl && x.card.id === guideWahl.card.id ? '<span class="marke gut">Guide-Wahl</span>' : '',
      x.card.id === rechnung.card.id ? '<span class="marke">rechnerisch vorn</span>' : '',
      x.isNew ? '' : `<span class="marke">liegen gelassen auf Stufe ${x.card.level}</span>`,
    ].join(' ');
    return `
      <article class="karte ${empfohlen && x.card.id === empfohlen.card.id ? 'in-hand' : ''}">
        <header>
          <span class="ini" title="Initiative">${String(x.card.initiative).padStart(2, '0')}</span>
          <div class="titel"><h3>${esc(x.card.name)}</h3><small>Stufe ${x.card.level}, Karte ${x.card.id}</small></div>
        </header>
        <p>${marken}</p>
        ${ctx.halfHtml(x.card.top, 'oben')}
        ${ctx.halfHtml(x.card.bottom, 'unten')}
        <p class="g-wert">In ${Math.round(x.rate * 100)} % der Szenarien in deiner besten Hand, verbessert sie im Schnitt um <b>${x.delta.toFixed(1)}</b> Punkte.</p>
        ${grundeHtml(x.reasons.map((r) => `${esc(r.text)} (in ${Math.round(r.share * 100)} % der Szenarien)`))}
        <footer><button type="button" class="${empfohlen && x.card.id === empfohlen.card.id ? 'haupt' : 'leise'}" data-act="aufstieg" data-id="${x.card.id}">Mit dieser Karte auf Stufe ${rat.next}</button></footer>
      </article>`;
  };
  const neu = rat.candidates.filter((x) => x.isNew);
  const alt = rat.candidates.filter((x) => !x.isNew).slice(0, 3);
  return `
    <section>
      <h2>Aufstieg auf Stufe ${rat.next}</h2>
      ${epBalken(ctx, p)}
      <p class="hinweis">${pr.ready ? 'Du hast genug Erfahrung.' : `Stufe ${rat.next} gibt es ab ${rat.xpNeeded} EP. Falls ihr schon aufgestiegen seid, kannst du die Karte trotzdem eintragen.`}</p>
      ${urteil}
      ${tipp ? `<p class="hinweis">Guide: ${esc(guide.quelle)}.</p>` : ''}
    </section>
    <section>
      <h2>Neue Karten zur Wahl</h2>
      <div class="kartenliste">${neu.map(karte).join('') || '<p class="leer">Keine neuen Karten hinterlegt.</p>'}</div>
    </section>
    ${alt.length ? `<section><h2>Oder eine frühere Karte nachholen</h2>
      <p class="hinweis">Beim Aufstieg darfst du auch eine Karte niedrigerer Stufe nehmen, die du bisher ausgelassen hast.</p>
      <div class="kartenliste">${alt.map(karte).join('')}</div></section>` : ''}
    <section>
      <h2>Perk zum Aufstieg</h2>
      <p class="hinweis">Mit jedem Stufenaufstieg wählst du auch einen Perk für dein Angriffsdeck.</p>
      ${perkEmpfehlungHtml(ctx, p, c)}
    </section>`;
}

// ---------- Verbesserungen ----------

// Ersetzt in einem Guide-Text jeden Kartennamen durch den deutschen Namen mit Initiative, z. B. „Hammerschlag (55)“
export function mitInitiative(text, cards) {
  const namen = new Map();
  for (const c of cards) for (const n of [c.name, c.nameEn]) if (n) namen.set(n, c);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const muster = [...namen.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
  return muster ? text.replace(new RegExp(`(${muster})(?! \\()`, 'g'), (n) => `${namen.get(n).name} (${namen.get(n).initiative})`) : text;
}

function verbessernHtml(ctx, p) {
  const { esc, state } = ctx;
  const list = (p.enh[p.classId] ||= []);
  const cards = ctx.pool();
  const prosp = wohlstand(ctx).level;
  const verbesserteKarten = new Set(list.map((e) => e.card)).size;

  // je Karte nur der beste Vorschlag, sonst füllt eine Karte die ganze Liste,
  // und jeder Aufkleber höchstens einmal, damit verschiedene Möglichkeiten sichtbar werden
  const seen = new Set();
  const top = enhancementAdvice(cards, list, p.gold).filter((x) => {
    const art = `${x.sticker}|${x.sticker === 'plus1' ? x.slot.on : ''}`;
    if (seen.has(x.card.id) || seen.has(art)) return false;
    seen.add(x.card.id); seen.add(art);
    return true;
  }).slice(0, 5);
  const topHtml = top.map((x) => `
    <li>
      <p><b>${esc(stickerName(ctx, x.sticker, x.slot.on))}</b> ${seiteName(x.side)} auf ${esc(x.card.name)} (${x.card.initiative})</p>
      <p class="g-meta">${x.cost} Gold, ${x.affordable ? 'kannst du dir leisten' : `dir fehlen ${x.cost - p.gold} Gold`}</p>
      <div class="knopfreihe">
        ${x.affordable ? `<button type="button" class="haupt" data-act="enh-kauf" data-card="${x.card.id}" data-side="${x.side}" data-slot="${x.index}" data-sticker="${x.sticker}">Kaufen</button>` : ''}
        <button type="button" class="leise" data-act="enh-hab" data-card="${x.card.id}" data-side="${x.side}" data-slot="${x.index}" data-sticker="${x.sticker}">Habe ich schon</button>
      </div>
    </li>`).join('');

  const mitFeld = cards.filter((c) => c.top.slots.length + c.bottom.slots.length > 0);
  const wahl = mitFeld.find((c) => c.id === ctx.local.enhCard) || mitFeld[0];
  let felder = '';
  if (wahl) {
    for (const side of ['top', 'bottom']) {
      const half = wahl[side];
      const previous = list.filter((e) => e.card === wahl.id && e.side === side).length;
      half.slots.forEach((slot, index) => {
        const done = list.find((e) => e.card === wahl.id && e.side === side && e.slot === index);
        const kopf = `<p><b>${seiteName(side)}, ${ZEILEN_NAMEN[slot.on] || slot.on}</b> <span class="g-meta">Feld: ${FORM_NAMEN[slot.shape]}${slot.multi ? ', mehrere Ziele (doppelter Grundpreis)' : ''}</span></p>`;
        if (done) {
          felder += `<li>${kopf}<p class="gut-text">Verbessert: ${esc(stickerName(ctx, done.sticker, slot.on))}</p>
            <div class="knopfreihe"><button type="button" class="leise" data-act="enh-weg" data-card="${wahl.id}" data-side="${side}" data-slot="${index}">Entfernen</button></div></li>`;
          return;
        }
        const options = slotStickers(slot, half).map((s) => `<option value="${s}">${esc(stickerName(ctx, s, slot.on))}: ${enhancementCost(s, slot, wahl, previous)} Gold</option>`).join('');
        felder += `<li>${kopf}
          <label class="sr" for="enh-${side}-${index}">Aufkleber</label>
          <select id="enh-${side}-${index}" class="auswahl">${options}</select>
          <div class="knopfreihe">
            <button type="button" class="haupt" data-act="enh-kauf" data-card="${wahl.id}" data-side="${side}" data-slot="${index}" data-wahl="enh-${side}-${index}">Kaufen</button>
            <button type="button" class="leise" data-act="enh-hab" data-card="${wahl.id}" data-side="${side}" data-slot="${index}" data-wahl="enh-${side}-${index}">Habe ich schon</button>
          </div></li>`;
      });
    }
  }
  const guide = GUIDES[p.classId];
  const alleKarten = ctx.data.characters.find((c) => c.id === p.classId).cards;
  return `
    <section>
      <h2>Was sich am meisten lohnt</h2>
      <p class="gold klein"><span class="muenze" aria-hidden="true"></span><b>${p.gold}</b> Gold</p>
      <ol class="vorschlaege">${topHtml || '<li>Keine freien Verbesserungsfelder in deinem Kartenvorrat.</li>'}</ol>
      <p class="hinweis">Die Zahl in Klammern ist die Initiative der Karte, daran findest du sie im Stapel. Faustregel: Nutzen pro Einsatz mal Einsätze pro Szenario, geteilt durch die Kosten. Dauerhafte Effekte zählen vielfach, Verlustaktionen einmal.</p>
      ${guide && guide.verbesserungen ? `<h3 class="zwischen">Laut Guides</h3><ul class="aenderungen">${guide.verbesserungen.map((t) => `<li>${esc(mitInitiative(t, alleKarten))}</li>`).join('')}</ul><p class="hinweis">Quelle: ${esc(guide.verbesserungenQuelle || guide.quelle)}.</p>` : ''}
    </section>
    <section>
      <h2>Kosten für eine Karte nachsehen</h2>
      <label class="sr" for="enhKarte">Karte</label>
      <select id="enhKarte" class="auswahl">${mitFeld.map((c) => `<option value="${c.id}" ${wahl && c.id === wahl.id ? 'selected' : ''}>${esc(c.name)} (${c.initiative}), Stufe ${c.level}</option>`).join('')}</select>
      <ul class="felder">${felder || '<li>Diese Karte hat keine Verbesserungsfelder.</li>'}</ul>
      <p class="hinweis">Kosten nach Regelheft: Grundpreis, doppelt bei mehreren Zielen, plus 25 Gold je Kartenstufe über 1, plus 75 Gold je Verbesserung, die schon auf derselben Aktion klebt. Felder von Beschwörungen fehlen noch.</p>
      <p class="hinweis">Verbesserte Karten: ${verbesserteKarten}. Erlaubt sind so viele verbesserte Karten wie eure Wohlstandsstufe (${prosp}).</p>
    </section>`;
}

// ---------- Darstellung ----------

export function renderHeld(ctx) {
  const p = heldDefaults(ctx.profile());
  const c = ctx.character();
  const tab = HELD_REITER.some(([k]) => k === ctx.local.heldTab) ? ctx.local.heldTab : 'uebersicht';
  const body = tab === 'ausruestung' ? ausruestungHtml(ctx, p)
    : tab === 'aufstieg' ? aufstiegHtml(ctx, p, c)
      : tab === 'deck' ? deckHtml(ctx, p, c)
        : tab === 'verbessern' ? verbessernHtml(ctx, p) : uebersichtHtml(ctx, p, c);
  ctx.view.innerHTML = `
    <section class="held-kopf">
      <div class="held-zeile">
        <div>
          <h1>${ctx.esc(c.name)}</h1>
          <p class="hinweis">${ctx.esc(ctx.local.profile)}, Stufe ${p.level}</p>
        </div>
        <button type="button" class="leise" data-act="held">Wechseln</button>
      </div>
      <div class="seg unterreiter" role="group" aria-label="Bereiche des Helden">
        ${HELD_REITER.map(([k, label]) => `<button type="button" data-held="${k}" aria-pressed="${k === tab}">${label}</button>`).join('')}
      </div>
    </section>
    ${body}`;
  // Balken von der alten auf die neue Füllung laufen lassen
  const bar = ctx.view.querySelector('#epFuellung');
  if (bar) {
    const ziel = bar.dataset.ziel;
    ctx.local.epAlt = Number(ziel);
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = `${ziel}%`; }));
  }
}

// ---------- Ereignisse ----------

function zahl(ctx, id) {
  const el = ctx.view.querySelector(`#${id}`);
  const n = el ? Math.round(Number(el.value)) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Liefert true, wenn der Klick hier verarbeitet wurde.
export function heldClick(ctx, b) {
  const p = ctx.profile();
  if (!p) return false;
  heldDefaults(p);
  const fertig = () => { ctx.saveProfile(); ctx.render(); return true; };
  if (b.dataset.held) { ctx.local.heldTab = b.dataset.held; ctx.render(); window.scrollTo(0, 0); return true; }
  const act = b.dataset.act;
  if (!act) return false;

  if (act === 'ep-plus' || act === 'ep-minus' || act === 'ep-setzen') {
    const n = zahl(ctx, 'epWert');
    if (n == null || (n === 0 && act !== 'ep-setzen')) { ctx.setStatus('Bitte erst eine Zahl eintragen.', true); return true; }
    p.xp = act === 'ep-plus' ? p.xp + n : act === 'ep-minus' ? Math.max(0, p.xp - n) : n;
    p.xpGeschaetzt = false;
    return fertig();
  }
  if (act === 'ep-bonus') { p.xp += Number(b.dataset.wert) || 0; p.xpGeschaetzt = false; return fertig(); }
  if (act === 'wohlstand-plus' || act === 'wohlstand-minus') {
    wohlstandSetzen(ctx, wohlstand(ctx).points + (act === 'wohlstand-plus' ? 1 : -1));
    ctx.saveShared();
    ctx.render();
    return true;
  }
  if (act === 'ruf-plus' || act === 'ruf-minus') {
    ctx.state.shared.reputation = Math.max(-20, Math.min(20, ruf(ctx) + (act === 'ruf-plus' ? 1 : -1)));
    ctx.saveShared();
    ctx.render();
    return true;
  }
  if (act === 'gold-plus' || act === 'gold-minus' || act === 'gold-setzen') {
    const n = zahl(ctx, 'goldWert');
    if (n == null || (n === 0 && act !== 'gold-setzen')) { ctx.setStatus('Bitte erst eine Zahl eintragen.', true); return true; }
    p.gold = act === 'gold-plus' ? p.gold + n : act === 'gold-minus' ? Math.max(0, p.gold - n) : n;
    return fertig();
  }

  if (act.startsWith('item-')) {
    const id = Number(b.dataset.id);
    const item = itemById(ctx, id);
    if (!item) return true;
    const i = p.items.findIndex((e) => e.id === id);
    if (act === 'item-kauf' || act === 'item-hab') {
      if (i >= 0) return true;
      if (act === 'item-kauf') {
        const preis = itemPrice(item, ruf(ctx));
        if (p.gold < preis) { ctx.setStatus('Dafür reicht dein Gold nicht.', true); return true; }
        p.gold -= preis;
      }
      p.items.push({ id, worn: true });
    } else if (i >= 0) {
      if (act === 'item-trage') p.items[i].worn = !p.items[i].worn;
      if (act === 'item-verkauf') { p.gold += Math.floor(item.cost / 2); p.items.splice(i, 1); }
      if (act === 'item-weg') p.items.splice(i, 1);
    }
    return fertig();
  }

  if (act === 'perk+' || act === 'perk-') {
    const taken = perkStand(p);
    const i = Number(b.dataset.i);
    const perk = ctx.character().perks[i];
    if (!perk) return true;
    taken[i] = Math.max(0, Math.min(perk.count, (taken[i] || 0) + (act === 'perk+' ? 1 : -1)));
    for (let j = 0; j < taken.length; j++) taken[j] ||= 0; // keine Lücken, die beim Speichern zu null würden
    return fertig();
  }
  if (act === 'haken+' || act === 'haken-') {
    p.checks = Math.max(0, Math.min(18, p.checks + (act === 'haken+' ? 1 : -1)));
    return fertig();
  }

  if (act === 'aufstieg') {
    const id = Number(b.dataset.id);
    const owned = ctx.owned();
    if (!owned.includes(id)) owned.push(id);
    p.level = Math.min(9, p.level + 1);
    ctx.local.heldTab = 'deck'; // als Nächstes steht der Perk an
    window.scrollTo(0, 0);
    return fertig();
  }

  if (act === 'enh-kauf' || act === 'enh-hab' || act === 'enh-weg') {
    const list = (p.enh[p.classId] ||= []);
    const card = Number(b.dataset.card);
    const side = b.dataset.side;
    const slotIndex = Number(b.dataset.slot);
    const at = list.findIndex((e) => e.card === card && e.side === side && e.slot === slotIndex);
    if (act === 'enh-weg') { if (at >= 0) list.splice(at, 1); return fertig(); }
    if (at >= 0) return true;
    const wahl = b.dataset.wahl ? ctx.view.querySelector(`#${b.dataset.wahl}`) : null;
    const sticker = b.dataset.sticker || (wahl && wahl.value);
    const karte = ctx.pool().find((c) => c.id === card);
    const slot = karte && karte[side] && karte[side].slots[slotIndex];
    if (!sticker || !slot) return true;
    if (act === 'enh-kauf') {
      const cost = enhancementCost(sticker, slot, karte, list.filter((e) => e.card === card && e.side === side).length);
      if (p.gold < cost) { ctx.setStatus(`Dafür fehlen dir ${cost - p.gold} Gold.`, true); return true; }
      p.gold -= cost;
    }
    list.push({ card, side, slot: slotIndex, sticker });
    ctx.local.enhCard = card;
    return fertig();
  }
  return false;
}

export function heldInput(ctx, target) {
  if (target.id !== 'itemSuche') return false;
  ctx.local.itemSuche = target.value;
  const box = ctx.view.querySelector('#itemTreffer');
  if (box) box.innerHTML = sucheHtml(ctx, target.value);
  return true;
}

export function heldChange(ctx, target) {
  if (target.id === 'wohlstandPunkte' || target.id === 'ansehenWert') {
    if (target.id === 'wohlstandPunkte') wohlstandSetzen(ctx, target.value);
    else ctx.state.shared.reputation = Math.max(-20, Math.min(20, Math.round(Number(target.value) || 0)));
    ctx.saveShared();
    ctx.render();
    return true;
  }
  if (target.id !== 'enhKarte') return false;
  ctx.local.enhCard = Number(target.value);
  ctx.render();
  return true;
}
