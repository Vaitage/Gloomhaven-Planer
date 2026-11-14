// Kleiner Server ohne externe Pakete: liefert die Web-App, die Spieldaten und
// speichert Profile, Hände und Notizen als JSON-Datei im Datenordner.
import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8090);
const DATA_DIR = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
const GAMEDATA = process.env.GAMEDATA || join(ROOT, 'data', 'gamedata.json');
const STATE_FILE = join(DATA_DIR, 'state.json');
const MAX_BODY = 512 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

const defaultState = () => ({ shared: { players: 4, level: 1, notes: {} }, profiles: {} });
let state = defaultState();
if (existsSync(STATE_FILE)) {
  try { state = { ...defaultState(), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; }
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

const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
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

const validName = (n) => typeof n === 'string' && /^[\p{L}\p{N} _.-]{1,30}$/u.test(n) && !['__proto__', 'constructor', 'prototype'].includes(n);
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

async function api(req, res, path) {
  if (path === '/api/health') return send(res, 200, { ok: true });
  if (path === '/api/data' && req.method === 'GET') {
    if (!existsSync(GAMEDATA)) return send(res, 503, { error: 'Spieldaten fehlen. Bitte "npm run import -- <pfad-zu-ghs>" ausführen.' });
    return send(res, 200, await readFile(GAMEDATA));
  }
  if (path === '/api/state' && req.method === 'GET') return send(res, 200, state);
  if (path === '/api/state/shared' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!isObject(body)) return send(res, 400, { error: 'Ungültige Daten' });
    state.shared = { ...defaultState().shared, ...body };
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
      state.profiles[name] = body;
      await save();
      return send(res, 200, body);
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
