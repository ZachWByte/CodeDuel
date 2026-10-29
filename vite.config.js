import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { isolationHeaders } from './server/isolation.js';
import { attachDuel } from './server/duel.js';

// Runs the duel rooms inside `npm run dev` and `npm run preview`, so multiplayer
// works on localhost without a second process.
// Vite restarts its server when this config or server/duel.js changes; the rooms
// live in memory, so they reset then.
function attach(httpServer) {
  if (!httpServer) return;
  const duel = attachDuel(httpServer);
  httpServer.once('close', () => duel.close());
}

const duelServer = {
  name: 'duel-server',
  configureServer: (server) => attach(server.httpServer),
  configurePreviewServer: (server) => attach(server.httpServer),
};

export default defineConfig({
  plugins: [nodePolyfills(), duelServer],
  server: { headers: isolationHeaders, port: 5173 },
  preview: { headers: isolationHeaders, port: 4173 },
  worker: {
    format: 'es',
    plugins: () => [nodePolyfills()],
  },
  optimizeDeps: { exclude: ['pyodide'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
