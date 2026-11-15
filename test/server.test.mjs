import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'planer-'));
process.env.DATA_DIR = dir;
process.env.UPDATES_IN_APP = '1';
const { server } = await import('../server.mjs');
let base;
before(async () => { await new Promise((ok) => server.listen(0, ok)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const json = (path, method, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

test('Profil speichern und wieder lesen', async () => {
  const p = { classId: 'sun', level: 3, owned: {}, hands: {} };
  assert.equal((await json('/api/state/profiles/Robert', 'PUT', p)).status, 200);
  const state = await (await fetch(base + '/api/state')).json();
  assert.deepEqual(state.profiles.Robert, p);
  assert.equal((await json('/api/state/profiles/__proto__', 'PUT', p)).status, 400);
});

test('Update-Anfrage legt genau ein erlaubtes Wort ab', async () => {
  let r = await (await fetch(base + '/api/updates')).json();
  assert.deepEqual(r, { status: null, anfrage: null, dienst_aktiv: null });
  assert.equal((await json('/api/updates', 'POST', { aktion: 'rm -rf /' })).status, 400);
  r = await (await json('/api/updates', 'POST', { aktion: 'aktualisieren' })).json();
  assert.equal(r.anfrage, 'aktualisieren');
  assert.equal(readFileSync(join(dir, 'update', 'anfrage'), 'utf8'), 'aktualisieren\n');
});

test('Status des Update-Dienstes wird durchgereicht', async () => {
  mkdirSync(join(dir, 'update'), { recursive: true });
  const status = { lebenszeichen: Math.floor(Date.now() / 1000), installiert: { commit: 'abc1234', datum: '2026-11-14T12:00:00+01:00', titel: 'Test' }, verfuegbar: null, aenderungen: [], laeuft: false };
  writeFileSync(join(dir, 'update', 'status.json'), JSON.stringify(status));
  const r = await (await fetch(base + '/api/updates')).json();
  assert.equal(r.dienst_aktiv, true);
  assert.equal(r.status.installiert.commit, 'abc1234');
  writeFileSync(join(dir, 'update', 'status.json'), JSON.stringify({ ...status, lebenszeichen: 1 }));
  assert.equal((await (await fetch(base + '/api/updates')).json()).dienst_aktiv, false);
});

test('Dateien außerhalb von public werden nicht ausgeliefert', async () => {
  assert.equal((await fetch(base + '/%2e%2e/server.mjs')).status, 404);
});

test('Schreiben geht nur als JSON und nicht von einer fremden Webseite aus', async () => {
  const p = JSON.stringify({ classId: 'sun', level: 2 });
  // so käme eine Anfrage von einer fremden Seite ohne Vorabprüfung: als einfacher Text
  assert.equal((await fetch(base + '/api/updates', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ aktion: 'aktualisieren' }) })).status, 403);
  assert.equal((await fetch(base + '/api/state/profiles/Fremd', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://boese.example' }, body: p })).status, 403);
  assert.equal((await fetch(base + '/api/state/profiles/Fremd', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: p })).status, 403);
  assert.equal((await fetch(base + '/api/state/profiles/Robert', { method: 'DELETE', headers: { Origin: 'https://boese.example' } })).status, 403);
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.profiles.Fremd, undefined);
  assert.ok(state.profiles.Robert);
  // die App selbst: gleiche Herkunft
  assert.equal((await fetch(base + '/api/state/profiles/Eigen', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base, 'Sec-Fetch-Site': 'same-origin' }, body: p })).status, 200);
});

test('Gespeicherte Daten werden bereinigt: kein HTML in Zahlen oder Bezeichnern', async () => {
  const boese = '"><img src=x onerror=alert(1)>';
  const r = await json('/api/state/profiles/Test', 'PUT', { classId: boese, level: boese, gold: boese, xp: '12', items: [{ id: boese, worn: 'ja' }, { id: 13, worn: true }], perks: { sun: [boese, 2] }, frei: boese, harmlos: 'sun|4' });
  assert.equal(r.status, 200);
  const p = (await (await fetch(base + '/api/state')).json()).profiles.Test;
  assert.deepEqual(p, { classId: '', level: 1, xp: 12, items: [{ id: 13, worn: true }], perks: { sun: [2] }, harmlos: 'sun|4' });
  await json('/api/state/shared', 'PUT', { players: boese, level: 3, reputation: boese, notes: { 1: boese, x: 'weg' }, results: { 1: { rounds: boese, won: true, rewards: { Test: { xp: boese } } } }, [boese]: 1 });
  const s = (await (await fetch(base + '/api/state')).json()).shared;
  assert.equal(s.players, 4);
  assert.equal(s.level, 3);
  assert.equal(s.reputation ?? 0, 0);
  assert.deepEqual(s.notes, { 1: boese }); // Notizen dürfen alles enthalten, die App maskiert sie beim Anzeigen
  assert.equal(s.results[1].rounds, 1);
  assert.equal(s.results[1].rewards.Test.xp, 0);
  assert.equal(JSON.stringify(s).includes('onerror=alert(1)>":'), false);
});

test('Antworten tragen Schutz-Kopfzeilen', async () => {
  for (const pfad of ['/', '/api/state', '/app.js']) {
    const h = (await fetch(base + pfad)).headers;
    assert.equal(h.get('x-content-type-options'), 'nosniff', pfad);
    assert.equal(h.get('x-frame-options'), 'DENY', pfad);
    assert.match(h.get('content-security-policy'), /script-src 'self'/, pfad);
  }
});
