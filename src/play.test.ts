// A person on the web page against an AI over MCP, at one table. The person
// is played here with plain fetch calls, the same ones the page makes.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startWopr, type Wopr } from './http.js';

let wopr: Wopr;
const clients: Client[] = [];

before(async () => {
  wopr = await startWopr({ port: 0, play: { graceMs: 60, sweepMs: 20 } });
});

after(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await wopr.close();
});

// Like the real page: it holds the event stream open, which is what keeps
// the seat, and remembers every view the server pushed.
async function person(token = randomUUID()) {
  const post = async (path: string, body: object = {}) => {
    const res = await fetch(`${wopr.url}/api/play/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wopr-player': token },
      body: JSON.stringify(body),
    });
    return { status: res.status, ...((await res.json()) as { ok: boolean; error?: string; view: any }) };
  };

  const views: any[] = [];
  const controller = new AbortController();
  const res = await fetch(`${wopr.url}/api/play/events?player=${token}`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const data = /^data: (.*)$/m.exec(buffer.slice(0, end))?.[1];
          buffer = buffer.slice(end + 2);
          if (data) views.push(JSON.parse(data));
        }
      }
    } catch {
      // Aborted by close(). Nothing to do.
    }
  })();
  const close = async () => {
    controller.abort();
    await pump;
  };
  return { token, post, views, close };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

async function ai(name: string): Promise<Client> {
  const client = new Client({ name: 'test-ai', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${wopr.url}/mcp`)));
  clients.push(client);
  await client.callTool({ name: 'join_game', arguments: { name } });
  return client;
}

const aiMove = (client: Client, square: number) => client.callTool({ name: 'make_move', arguments: { square } });

test('a person and an AI play one game at one table', async () => {
  const lightman = await person();
  const joined = await lightman.post('join', { name: 'David' });
  assert.equal(joined.ok, true);
  assert.equal(joined.view.you, 'X');

  const joshua = await ai('Joshua');
  assert.deepEqual(wopr.lobby.views()[0]!.players, { X: 'David', O: 'Joshua' });

  const early = await aiMove(joshua, 5);
  assert.equal(early.isError, true, 'the AI cannot move first');

  assert.equal((await lightman.post('move', { square: 1 })).ok, true);
  const outOfTurn = await lightman.post('move', { square: 2 });
  assert.deepEqual([outOfTurn.status, outOfTurn.error], [409, 'not_your_turn']);

  await aiMove(joshua, 5);
  await lightman.post('move', { square: 2 });
  await aiMove(joshua, 9);
  const win = await lightman.post('move', { square: 3 });
  assert.deepEqual(win.view.outcome, { kind: 'win', winner: 'X', line: [1, 2, 3] });
  assert.deepEqual(wopr.history.list()[0]!.players, { X: 'David', O: 'Joshua' });

  const next = await lightman.post('new');
  assert.equal(next.view.toMove, 'O', 'the AI moves first in the next game');
  await lightman.post('leave');
  await lightman.close();
});

test('a request without a proper token is refused', async () => {
  const res = await fetch(`${wopr.url}/api/play/join`, { method: 'POST', headers: { 'x-wopr-player': 'short' } });
  assert.equal(res.status, 400);
});

test('moving without a seat says so', async () => {
  const stranger = await person();
  const result = await stranger.post('move', { square: 5 });
  assert.deepEqual([result.status, result.error], [409, 'not_seated']);
  await stranger.close();
});

test('the page stream sends the board as it changes', async () => {
  const falken = await person();
  await settle();
  assert.deepEqual([...falken.views], [null], 'no seat yet');
  await falken.post('join', { name: 'Falken' });
  await settle();
  assert.equal(falken.views.at(-1).players.X, 'Falken');
  await falken.post('leave');
  await falken.close();
});

test('closing the page frees the seat after the grace period', async () => {
  const tab = await person();
  await tab.post('join', { name: 'Tab' });
  const seated = () => wopr.lobby.views().some((v) => v.players.X === 'Tab');

  await new Promise((r) => setTimeout(r, 150));
  assert.ok(seated(), 'an open page keeps the seat');

  await tab.close();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!seated(), 'a closed page loses it');
});
