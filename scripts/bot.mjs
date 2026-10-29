// Joins a duel room as a bot opponent, on any Code Duel server.
//
//   npm run bot -- <ROOM> [easy|medium|hard] [--url http://localhost:5173] [--speed 1]
//
// e.g. create a room in the browser, then: npm run bot -- ABCD hard
//      or against a deployed server:     npm run bot -- ABCD medium --url https://your-app.onrender.com
import { startBot, BOT_LEVELS } from '../server/bot.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
};
const url = option('url', 'http://localhost:5173');
const speed = Number(option('speed', '1')) || 1;
const [code, level = 'medium'] = args;

if (!code || !/^[A-Za-z0-9]{4}$/.test(code) || !(level in BOT_LEVELS)) {
  console.error('Usage: npm run bot -- <ROOM> [easy|medium|hard] [--url http://localhost:5173] [--speed 1]');
  process.exit(1);
}

const bot = startBot({ url, code: code.toUpperCase(), level, speed, log: console.log });
console.log(`[bot] ${bot.name} (${BOT_LEVELS[level].label}) joining room ${code.toUpperCase()} on ${url}…`);
process.on('SIGINT', () => bot.stop());
await bot.done;
console.log('[bot] left the room.');
process.exit(0);
