#!/usr/bin/env node
// Baut die Geräte-Variante ohne Server (für GitHub Pages, in Chrome als App installierbar).
// Aufruf: node scripts/build-statisch.mjs <gamedata.json> <zielordner> [version]
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [gamedata, out, version = String(Date.now())] = process.argv.slice(2);
if (!gamedata || !out || !existsSync(gamedata)) {
  console.error('Aufruf: node scripts/build-statisch.mjs <gamedata.json> <zielordner> [version]');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'public'), out, { recursive: true });
cpSync(gamedata, join(out, 'gamedata.json'));

const ersetze = (file, von, zu) => {
  const p = join(out, file);
  const text = readFileSync(p, 'utf8');
  if (!text.includes(von)) throw new Error(`${file}: „${von}“ nicht gefunden`);
  writeFileSync(p, text.replace(von, zu));
};
ersetze('index.html', '<meta name="planer-modus" content="server">', '<meta name="planer-modus" content="statisch">');
ersetze('sw.js', "const VERSION = 'dev';", `const VERSION = ${JSON.stringify(version.slice(0, 12))};`);
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Geräte-Variante gebaut: ${out} (Version ${version.slice(0, 12)})`);
