import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Table } from './game/table.js';
import { Sessions } from './sessions.js';

const LIMITS = { seatMs: 1000, sessionMs: 5000 };

function setup() {
  let clock = 0;
  const closed: string[] = [];
  const table = new Table();
  const sessions = new Sessions<{ close(): Promise<void> }>(table, LIMITS, () => {}, () => clock);
  const add = (id: string, name: string) => {
    sessions.add(id, { close: async () => void closed.push(id) });
    table.join(id, name);
  };
  return { table, sessions, closed, add, advance: (ms: number) => (clock += ms) };
}

test('a quiet player loses the seat, but keeps the session', () => {
  const { table, sessions, closed, add, advance } = setup();
  add('a', 'Alice');
  advance(1000);
  sessions.sweep();
  assert.equal(table.view().players.X, null);
  assert.deepEqual(closed, []);
  assert.ok(sessions.touch('a'), 'the session should still be there');
});

test('any request keeps the seat', () => {
  const { table, sessions, add, advance } = setup();
  add('a', 'Alice');
  advance(900);
  sessions.touch('a');
  advance(900);
  sessions.sweep();
  assert.equal(table.view().players.X, 'Alice');
});

test('only the quiet player loses the seat', () => {
  const { table, sessions, add, advance } = setup();
  add('a', 'Alice');
  add('b', 'Bob');
  advance(1000);
  sessions.touch('b');
  sessions.sweep();
  assert.deepEqual(table.view().players, { X: null, O: 'Bob' });
});

test('a player who goes quiet mid-game forfeits it', () => {
  const { table, sessions, add, advance } = setup();
  add('a', 'Alice');
  add('b', 'Bob');
  table.move('a', 5);
  advance(1000);
  sessions.touch('b');
  sessions.sweep();
  assert.deepEqual(table.view().outcome, { kind: 'forfeit', winner: 'O' });
});

test('a session quiet for long enough is closed and forgotten', () => {
  const { sessions, closed, add, advance } = setup();
  add('a', 'Alice');
  advance(5000);
  sessions.sweep();
  assert.deepEqual(closed, ['a']);
  assert.equal(sessions.touch('a'), undefined);
});

test('ending a session twice is harmless', () => {
  const { table, sessions, add } = setup();
  add('a', 'Alice');
  sessions.end('a');
  sessions.end('a');
  assert.equal(table.view().players.X, null);
});
