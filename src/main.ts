import { startWopr } from './http.js';

const port = Number(process.env.PORT ?? 5171);
const log = (message: string): void => console.log(`${new Date().toISOString()} ${message}`);

const wopr = await startWopr(port, log);
log(`WOPR is listening on ${wopr.url}/mcp`);
log('GREETINGS. SHALL WE PLAY A GAME?');
