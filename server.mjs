// Kleiner Server ohne externe Pakete: liefert die Web-App, die Spieldaten und
// speichert Profile, Hände und Notizen als JSON-Datei im Datenordner.
import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanState, cleanShared, cleanProfile, validName, MAX_PROFILE } from './public/stand.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8090);
const DATA_DIR = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
const GAMEDATA = process.env.GAMEDATA || join(ROOT, 'data', 'gamedata.json');
const STATE_FILE = join(DATA_DIR, 'state.json');
const MAX_BODY = 512 * 1024;

// Updates aus der App (nur mit UPDATES_IN_APP=1). Der Container kann am Pi nichts
// ändern. Er legt nur ein Wort in <data>/update/anfrage ab, das der Update-Dienst
// auf dem Pi (tools/pi/selbst-aktualisieren.sh, per Cron) abholt. Der Dienst
// schreibt seinen Stand nach <data>/update/status.json.
const UPDATES_AN = /^(1|true|ja|yes)$/i.test((process.env.UPDATES_IN_APP || '').trim());
const UPDATE_DIR = join(DATA_DIR, 'update');
const UPDATE_AKTIONEN = ['pruefen', 'aktualisieren'];
const DIENST_STILL_SEKUNDEN = 15 * 60;

async function updateAntwort() {
  let status = null;
  try {
    const d = JSON.parse(await readFile(join(UPDATE_DIR, 'status.json'), 'utf8'));
    if (d && typeof d === 'object' && !Array.isArray(d)) status = d;
  } catch { /* noch kein Status */ }
  let anfrage = null;
  try {
    const wort = (await readFile(join(UPDATE_DIR, 'anfrage'), 'utf8')).trim();
    if (UPDATE_AKTIONEN.includes(wort)) anfrage = wort;
  } catch { /* keine offene Anfrage */ }
  const dienst_aktiv = status && typeof status.lebenszeichen === 'number'
    ? Date.now() / 1000 - status.lebenszeichen < DIENST_STILL_SEKUNDEN : null;
  return { status, anfrage, dienst_aktiv };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

const defaultState = () => ({ shared: { players: 4, level: 1, notes: {} }, profiles: {} });
let state = defaultState();
if (existsSync(STATE_FILE)) {
  try { state = cleanState({ ...defaultState(), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }); }
  catch (e) { console.error('state.json ist nicht lesbar, starte mit leerem Stand:', e.message); }
}

let saving = Promise.resolve();
function save() {
  saving = saving.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, STATE_FILE);
  }).catch((e) => console.error('Speichern fehlgeschlagen:', e.message));
  return saving;
}

// Schutz im Browser: Inhalte nicht umdeuten, nicht in fremde Seiten einbetten, nur eigene Skripte
const SCHUTZ = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://raw.githubusercontent.com; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SCHUTZ, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { fail(new Error('zu groß')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch (e) { fail(e); } });
    req.on('error', fail);
  });
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Schreibende Anfragen nur von der App selbst: als JSON und nicht von einer fremden Webseite aus.
// Ohne diese Prüfung könnte eine beliebige Seite, die jemand im Heimnetz öffnet, hier Daten ändern.
function fremdeAnfrage(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '') && req.method !== 'DELETE') return 'Nur JSON';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'Fremde Herkunft';
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return 'Fremde Herkunft'; } catch { return 'Fremde Herkunft'; }
  }
  return null;
}

async function api(req, res, path) {
  if (path === '/api/health') return send(res, 200, { ok: true });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const grund = fremdeAnfrage(req);
    if (grund) return send(res, 403, { error: grund });
  }
  if (path === '/api/data' && req.method === 'GET') {
    if (!existsSync(GAMEDATA)) return send(res, 503, { error: 'Spieldaten fehlen. Bitte "npm run import -- <pfad-zu-ghs>" ausführen.' });
    return send(res, 200, await readFile(GAMEDATA));
  }
  if (path === '/api/updates') {
    if (!UPDATES_AN) return send(res, 404, { error: 'Updates aus der App sind nicht eingerichtet' });
    if (req.method === 'GET') return send(res, 200, await updateAntwort());
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!isObject(body) || !UPDATE_AKTIONEN.includes(body.aktion)) return send(res, 400, { error: 'Ungültige Aktion' });
      await mkdir(UPDATE_DIR, { recursive: true });
      const tmp = join(UPDATE_DIR, 'anfrage.tmp');
      await writeFile(tmp, body.aktion + '\n');
      await rename(tmp, join(UPDATE_DIR, 'anfrage')); // nie halb geschrieben
      return send(res, 200, await updateAntwort());
    }
  }
  if (path === '/api/state' && req.method === 'GET') return send(res, 200, state);
  if (path === '/api/state/shared' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!isObject(body)) return send(res, 400, { error: 'Ungültige Daten' });
    state.shared = cleanShared({ ...defaultState().shared, ...body });
    await save();
    return send(res, 200, state.shared);
  }
  const m = path.match(/^\/api\/state\/profiles\/([^/]+)$/);
  if (m) {
    const name = decodeURIComponent(m[1]);
    if (!validName(name)) return send(res, 400, { error: 'Ungültiger Name' });
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!isObject(body)) return send(res, 400, { error: 'Ungültige Daten' });
      if (!(name in state.profiles) && Object.keys(state.profiles).length >= MAX_PROFILE) return send(res, 400, { error: 'Zu viele Profile' });
      state.profiles[name] = cleanProfile(body);
      await save();
      return send(res, 200, state.profiles[name]);
    }
    if (req.method === 'DELETE') {
      delete state.profiles[name];
      await save();
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'Nicht gefunden' });
}

async function staticFile(res, path) {
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^([/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Verboten', 'text/plain');
  try {
    const body = await readFile(file);
    send(res, 200, body, MIME[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
  }
}

export const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/api/')) await api(req, res, path);
    else await staticFile(res, path);
  } catch (e) {
    send(res, 400, { error: 'Anfrage fehlgeschlagen' });
  }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Gloomhaven-Planer läuft auf Port ${PORT}`));
}
