import { fileURLToPath } from 'node:url';
import { startWopr } from './http.js';

const port = Number(process.env.PORT ?? 5171);
const log = (message: string): void => console.log(`${new Date().toISOString()} ${message}`);

// Beside the project, not wherever the server happened to be started from.
const historyFile = fileURLToPath(new URL('../data/history.jsonl', import.meta.url));

const wopr = await startWopr({ port, log, historyFile });
log(`WOPR is listening on ${wopr.url}/mcp`);
log('GREETINGS. SHALL WE PLAY A GAME?');
