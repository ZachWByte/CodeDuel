// Copies the Pyodide runtime into public/pyodide so it is served from our own
// origin (required for cross-origin isolation and offline use).
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pyodide');
const dest = join(root, 'public', 'pyodide');

if (!existsSync(src)) {
  console.warn('[copy-pyodide] node_modules/pyodide not found; skipping.');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
let n = 0;
for (const name of readdirSync(src)) {
  if (/\.(js|mjs|wasm|zip|json|map)$/.test(name) && name !== 'package.json') {
    cpSync(join(src, name), join(dest, name));
    n++;
  }
}
console.log(`[copy-pyodide] copied ${n} files to public/pyodide`);
