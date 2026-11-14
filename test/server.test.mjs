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
