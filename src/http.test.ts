// Real MCP clients over real HTTP against a real server on a free port.
// The table tests prove the rules. These prove the rules survive the trip
// through MCP, and that the seat really belongs to the session.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startWopr, type Wopr } from './http.js';

let wopr: Wopr;
const clients: Client[] = [];
const transports = new Map<Client, StreamableHTTPClientTransport>();

before(async () => {
  wopr = await startWopr({ port: 0 });
});

after(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await wopr.close();
});

async function connect(): Promise<Client> {
  const client = new Client({ name: 'test-player', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${wopr.url}/mcp`));
  await client.connect(transport);
  clients.push(client);
  transports.set(client, transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { text: content.map((c) => c.text).join('\n'), isError: result.isError === true };
}

test('the server greets a client and lists the three tools', async () => {
  const client = await connect();
  assert.match(client.getInstructions() ?? '', /SHALL WE PLAY A GAME\?/);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_board', 'join_game', 'make_move']);
  await client.close();
});

let joshua: Client;
let falken: Client;

test('two clients play a full game, and cheating is refused', async () => {
  joshua = await connect();
  falken = await connect();

  assert.match((await call(joshua, 'join_game', { name: 'Joshua' })).text, /You are X/);
  assert.match((await call(falken, 'join_game', { name: 'Falken' })).text, /You are O/);

  const outOfTurn = await call(falken, 'make_move', { square: 5 });
  assert.equal(outOfTurn.isError, true);
  assert.match(outOfTurn.text, /not your turn/);

  await call(joshua, 'make_move', { square: 5 });
  const taken = await call(falken, 'make_move', { square: 5 });
  assert.equal(taken.isError, true);
  assert.match(taken.text, /taken/);

  await call(falken, 'make_move', { square: 1 });
  await call(joshua, 'make_move', { square: 3 });
  await call(falken, 'make_move', { square: 7 });
  await call(joshua, 'make_move', { square: 4 });
  await call(falken, 'make_move', { square: 6 });
  await call(joshua, 'make_move', { square: 2 });
  await call(falken, 'make_move', { square: 8 });
  const last = await call(joshua, 'make_move', { square: 9 });
  assert.match(last.text, /GAME OVER\. A draw\./);

  const board = await call(falken, 'get_board');
  assert.match(board.text, / O \| X \| X/);
  assert.match(board.text, /You are O/);
});

test('a third client is turned away', async () => {
  const kibitzer = await connect();
  const result = await call(kibitzer, 'join_game', { name: 'Kibitzer' });
  assert.equal(result.isError, true);
  assert.match(result.text, /both seats are taken/);
});

test('a square outside 1 to 9 is refused before it reaches the table', async () => {
  const result = await call(joshua, 'make_move', { square: 10 });
  assert.equal(result.isError, true);
});

// A clean client exit sends DELETE. The seat must not stay taken by a
// player who has gone.
test('ending a session gives up its seat', async () => {
  assert.equal(wopr.table.view().players.X, 'Joshua');
  await transports.get(joshua)!.terminateSession();
  assert.equal(wopr.table.view().players.X, null);
  assert.equal(wopr.table.view().players.O, 'Falken');
});
