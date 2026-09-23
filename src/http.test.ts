// Real MCP clients over real HTTP against a real server on a free port.
// The table tests prove the rules. These prove the rules survive the trip
// through MCP, and that a seat really belongs to its session.

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

// Plays like a model told to follow the shall_we_play steps: wait, and on
// its turn play the next square from its list.
async function playOut(client: Client, squares: number[]): Promise<string> {
  const queue = [...squares];
  for (;;) {
    const { text } = await call(client, 'wait_for_turn', { timeout_seconds: 5 });
    if (text.includes('GAME OVER')) return text;
    if (text.startsWith('YOUR TURN')) {
      const move = await call(client, 'make_move', { square: queue.shift() });
      assert.equal(move.isError, false, move.text);
    }
  }
}

test('the server greets a client and offers the tools, the board, and the prompt', async () => {
  const client = await connect();
  assert.match(client.getInstructions() ?? '', /SHALL WE PLAY A GAME\?/);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_board', 'join_game', 'leave_game', 'make_move', 'new_game', 'wait_for_turn']);

  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((r) => r.uri), ['wopr://board']);

  const prompt = await client.getPrompt({ name: 'shall_we_play', arguments: { name: 'Falken', games: '3' } });
  const text = (prompt.messages[0]!.content as { text: string }).text;
  assert.match(text, /as "Falken"\. Play 3 games\./);
  await client.close();
});

let joshua: Client;
let falken: Client;

test('two clients play a whole game by waiting for turns, and cheating is refused', async () => {
  joshua = await connect();
  falken = await connect();

  assert.match((await call(joshua, 'join_game', { name: 'Joshua' })).text, /You are X at table 1/);
  assert.match((await call(falken, 'join_game', { name: 'Falken' })).text, /You are O at table 1/);

  const outOfTurn = await call(falken, 'make_move', { square: 5 });
  assert.equal(outOfTurn.isError, true);
  assert.match(outOfTurn.text, /not your turn/);

  // Both play at once. Each only moves when wait_for_turn says so.
  const [xEnd, oEnd] = await Promise.all([playOut(joshua, [5, 3, 4, 2, 9]), playOut(falken, [1, 7, 6, 8])]);
  assert.match(xEnd, /GAME OVER\. A draw\./);
  assert.match(oEnd, /GAME OVER\. A draw\./);
  assert.deepEqual(wopr.history.list().map((g) => [g.players.X, g.players.O, g.outcome.kind]), [['Joshua', 'Falken', 'draw']]);

  const taken = await call(falken, 'make_move', { square: 5 });
  assert.equal(taken.isError, true);
  assert.match(taken.text, /game is over/);
});

test('the board resource shows the reader their own table', async () => {
  const { contents } = await falken.readResource({ uri: 'wopr://board' });
  const text = (contents[0] as { text: string }).text;
  assert.match(text, / O \| X \| X/);
  assert.match(text, /Table 1\. You are O\./);
});

test('the next game starts once, even when both players ask', async () => {
  await Promise.all([call(joshua, 'new_game'), call(falken, 'new_game')]);
  assert.match((await call(falken, 'get_board')).text, /Your move/);
});

test('a third client opens table 2 instead of being turned away', async () => {
  const kibitzer = await connect();
  assert.match((await call(kibitzer, 'join_game', { name: 'Kibitzer' })).text, /You are X at table 2/);
  assert.equal(wopr.lobby.views().length, 2);
  assert.match((await call(kibitzer, 'leave_game')).text, /GOODBYE/);
  assert.equal(wopr.lobby.views().length, 1);
});

test('a client with no seat is told to join first', async () => {
  const stranger = await connect();
  const result = await call(stranger, 'wait_for_turn', { timeout_seconds: 1 });
  assert.equal(result.isError, true);
  assert.match(result.text, /join_game first/);
});

test('a square outside 1 to 9 is refused before it reaches the table', async () => {
  const result = await call(falken, 'make_move', { square: 10 });
  assert.equal(result.isError, true);
});

// A clean client exit sends DELETE. The seat must not stay taken by a
// player who has gone.
test('ending a session gives up its seat', async () => {
  assert.deepEqual(wopr.lobby.views()[0]!.players, { X: 'Joshua', O: 'Falken' });
  await transports.get(joshua)!.terminateSession();
  assert.deepEqual(wopr.lobby.views()[0]!.players, { X: null, O: 'Falken' });
});

test('the admin state lists live tables and finished games', async () => {
  const res = await fetch(`${wopr.url}/api/state`);
  const state = (await res.json()) as { tables: { table: string }[]; history: { id: number; moves: number[] }[] };
  assert.deepEqual(state.tables.map((t) => t.table), ['1']);
  assert.deepEqual(state.history.map((g) => g.moves.length), [9]);
});

// Reads server-sent events off a fetch body, one whole event at a time.
function eventReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async function next(wanted: string): Promise<any> {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.*)$/m.exec(frame)?.[1];
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (event === wanted && data) return JSON.parse(data);
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`stream ended before a ${wanted} event`);
      buffer += decoder.decode(value, { stream: true });
    }
  };
}

test('the admin stream sends the state at once, then state and MCP calls as they happen', async () => {
  const controller = new AbortController();
  const res = await fetch(`${wopr.url}/api/events`, { signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const next = eventReader(res.body!);

  assert.equal((await next('state')).tables.length, 1);
  const seated = await connect();
  await call(seated, 'join_game', { name: 'Newcomer' });
  assert.equal((await next('state')).tables[0].players.X, 'Newcomer');

  let joined;
  do joined = await next('call');
  while (joined.request.params?.name !== 'join_game');
  assert.equal(joined.method, 'tools/call');
  assert.deepEqual(joined.request.params.arguments, { name: 'Newcomer' });
  assert.deepEqual(joined.player, { name: 'Newcomer', mark: 'X' });
  assert.equal(joined.endpoint.path, '/mcp');
  assert.ok(joined.endpoint.protocolVersion);
  controller.abort();
});

test('every MCP call of a finished game can be read back, refusals included', async () => {
  const [game] = wopr.history.list().slice(-1);
  const res = await fetch(`${wopr.url}/api/games/${game!.game}/calls`);
  const calls = (await res.json()) as { request: { params?: { name?: string; arguments?: { square?: number } } }; failed: boolean }[];
  const moves = calls.filter((c) => c.request.params?.name === 'make_move');

  assert.deepEqual(
    moves.filter((c) => !c.failed).map((c) => c.request.params!.arguments!.square),
    game!.moves,
    'the successful make_move calls are the game, in order',
  );
  assert.ok(moves.some((c) => c.failed), 'the out-of-turn move is in the log as a refusal');
});

test('the catalog lists every MCP command, straight from the server', async () => {
  const catalog = (await (await fetch(`${wopr.url}/api/catalog`)).json()) as {
    server: { name: string };
    methods: { method: string }[];
    tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[];
    resources: { uri: string }[];
    prompts: { name: string }[];
  };
  assert.equal(catalog.server.name, 'wopr');
  assert.ok(catalog.methods.some((m) => m.method === 'tools/call'));
  assert.equal(catalog.tools.length, 6);
  assert.ok(catalog.tools.find((t) => t.name === 'make_move')!.inputSchema.properties!.square);
  assert.deepEqual(catalog.resources.map((r) => r.uri), ['wopr://board']);
  assert.deepEqual(catalog.prompts.map((p) => p.name), ['shall_we_play']);
  assert.equal(wopr.lobby.views().length, 1, 'building the catalog seats nobody');
});

test('the admin page is served', async () => {
  const res = await fetch(`${wopr.url}/admin`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /WOPR ADMIN/);
});
