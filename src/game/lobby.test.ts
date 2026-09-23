import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from './lobby.js';
import type { FinishedGame } from './table.js';

test('the first two players share table 1, the next two get table 2', () => {
  const lobby = new Lobby();
  assert.deepEqual(lobby.join('a', 'Alice'), { ok: true, value: { table: '1', mark: 'X' } });
  assert.deepEqual(lobby.join('b', 'Bob'), { ok: true, value: { table: '1', mark: 'O' } });
  assert.deepEqual(lobby.join('c', 'Carol'), { ok: true, value: { table: '2', mark: 'X' } });
  assert.deepEqual(lobby.join('d', 'Dave'), { ok: true, value: { table: '2', mark: 'O' } });
  assert.equal(lobby.views().length, 2);
});

test('joining twice keeps the same table and seat', () => {
  const lobby = new Lobby();
  lobby.join('a', 'Alice');
  assert.deepEqual(lobby.join('a', 'Alice'), { ok: true, value: { table: '1', mark: 'X' } });
  assert.equal(lobby.views().length, 1);
});

test('a newcomer fills the seat of a player who left, before any new table opens', () => {
  const lobby = new Lobby();
  lobby.join('a', 'Alice');
  lobby.join('b', 'Bob');
  lobby.join('c', 'Carol');
  lobby.leave('a');
  assert.deepEqual(lobby.join('d', 'Dave'), { ok: true, value: { table: '1', mark: 'X' } });
});

test('a table closes when its last player leaves', () => {
  const lobby = new Lobby();
  lobby.join('a', 'Alice');
  lobby.join('b', 'Bob');
  lobby.leave('a');
  lobby.leave('b');
  assert.deepEqual(lobby.views(), []);
  assert.equal(lobby.tableOf('a'), undefined);
});

test('leaving without a seat is refused', () => {
  assert.deepEqual(new Lobby().leave('ghost'), { ok: false, error: 'not_seated' });
});

test('players at different tables cannot touch each other\'s games', () => {
  const lobby = new Lobby();
  for (const [id, name] of [['a', 'Alice'], ['b', 'Bob'], ['c', 'Carol'], ['d', 'Dave']]) lobby.join(id!, name!);
  lobby.tableOf('a')!.move('a', 5);
  assert.deepEqual(lobby.tableOf('c')!.view().board.filter(Boolean), []);
  assert.equal(lobby.tableOf('c')!.move('a', 1).ok, false);
});

test('a finished game at any table is reported once', () => {
  const lobby = new Lobby();
  const games: FinishedGame[] = [];
  lobby.onFinish((g) => games.push(g));
  for (const [id, name] of [['a', 'Alice'], ['b', 'Bob'], ['c', 'Carol'], ['d', 'Dave']]) lobby.join(id!, name!);

  const t2 = lobby.tableOf('c')!;
  for (const [who, square] of [['c', 1], ['d', 4], ['c', 2], ['d', 5], ['c', 3]] as const) t2.move(who, square);

  assert.equal(games.length, 1);
  assert.equal(games[0]!.table, '2');
  assert.deepEqual(games[0]!.players, { X: 'Carol', O: 'Dave' });
  assert.deepEqual(games[0]!.moves, [1, 4, 2, 5, 3]);
});

test('a closed table stops reporting', () => {
  const lobby = new Lobby();
  let changes = 0;
  lobby.join('a', 'Alice');
  const table = lobby.tableOf('a')!;
  lobby.leave('a');
  lobby.onChange(() => changes++);
  table.join('z', 'Zed');
  assert.equal(changes, 0);
});

test('a change listener can already find a player who just joined', () => {
  const lobby = new Lobby();
  const seen: (string | undefined)[] = [];
  lobby.onChange(() => seen.push(lobby.tableOf('a')?.id));
  lobby.join('a', 'Alice');
  assert.equal(seen.at(-1), '1');
});
