// Production server (Render, or `npm start` locally after `npm run build`):
// serves the built app from dist/ with the isolation headers, plus the duel rooms.
import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachDuel } from './duel.js';
import { isolationHeaders } from './isolation.js';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set(isolationHeaders);
  next();
});
app.get('/healthz', (req, res) => res.send('ok'));
app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(dist));
// Any other GET (e.g. /?room=ABCD) gets the app.
app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(join(dist, 'index.html')) : next()));

const server = createServer(app);
const duel = attachDuel(server);

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Code Duel on http://localhost:${port}`));

// Render sends SIGTERM before a redeploy or restart. Rooms live in memory, so tell
// the players, give the message a moment to arrive, then stop.
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: closing`);
    duel.announce('⚠ The server is restarting, so this room will close. Sorry! Create a new room in a minute.');
    setTimeout(() => {
      duel.close();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    }, 1000);
  });
}
