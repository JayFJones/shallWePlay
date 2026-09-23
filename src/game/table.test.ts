import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRANGE_GAME_DRAWS, Table, type FinishedGame } from './table.js';

function seated(): Table {
  const table = new Table();
  table.join('a', 'Alice');
  table.join('b', 'Bob');
  return table;
}

// Plays squares in order, alternating a (X) and b (O), and fails loudly on a
// refusal so a broken setup cannot pass as a passing test.
function playAll(table: Table, squares: number[]): void {
  for (const square of squares) {
    const mover = table.view().toMove === table.view('a').you ? 'a' : 'b';
    const result = table.move(mover, square);
    assert.ok(result.ok, `move ${square} by ${mover} was refused: ${!result.ok && result.error}`);
  }
}

const X_WINS = [1, 4, 2, 5, 3];
const DRAW = [5, 1, 3, 7, 4, 6, 2, 8, 9];

test('the first player gets X, the second gets O, the third is turned away', () => {
  const table = new Table();
  assert.deepEqual(table.join('a', 'Alice'), { ok: true, value: 'X' });
  assert.deepEqual(table.join('b', 'Bob'), { ok: true, value: 'O' });
  assert.deepEqual(table.join('c', 'Carol'), { ok: false, error: 'table_full' });
  assert.deepEqual(table.view().players, { X: 'Alice', O: 'Bob' });
});

test('joining twice keeps the same seat', () => {
  const table = new Table();
  table.join('a', 'Alice');
  assert.deepEqual(table.join('a', 'Alice again'), { ok: true, value: 'X' });
  assert.equal(table.view().players.O, null);
});

test('a blank name gets a default, and a long one is cut', () => {
  const table = new Table();
  table.join('a', '   ');
  table.join('b', 'B'.repeat(100));
  assert.equal(table.view().players.X, 'Player X');
  assert.equal(table.view().players.O?.length, 40);
});

test('nobody moves without an opponent', () => {
  const table = new Table();
  table.join('a', 'Alice');
  assert.deepEqual(table.move('a', 5), { ok: false, error: 'no_opponent' });
});

test('a player who is not seated cannot move', () => {
  assert.deepEqual(seated().move('stranger', 5), { ok: false, error: 'not_seated' });
});

test('one player cannot move for the other', () => {
  const table = seated();
  assert.deepEqual(table.move('b', 5), { ok: false, error: 'not_your_turn' });
  table.move('a', 5);
  assert.deepEqual(table.move('a', 1), { ok: false, error: 'not_your_turn' });
});

test('the rules errors come through from rules.ts', () => {
  const table = seated();
  table.move('a', 5);
  assert.deepEqual(table.move('b', 5), { ok: false, error: 'square_taken' });
  assert.deepEqual(table.move('b', 0), { ok: false, error: 'bad_square' });
});

test('each player sees their own mark in the view', () => {
  const table = seated();
  assert.equal(table.view('a').you, 'X');
  assert.equal(table.view('b').you, 'O');
  assert.equal(table.view().you, null);
});

test('a new game is refused while one is in progress', () => {
  const table = seated();
  table.move('a', 5);
  assert.deepEqual(table.newGame('b'), { ok: false, error: 'game_in_progress' });
});

test('after a game, a new game clears the board and swaps who moves first', () => {
  const table = seated();
  playAll(table, X_WINS);
  const result = table.newGame('b');
  assert.ok(result.ok);
  assert.equal(table.view().outcome, null);
  assert.ok(table.view().board.every((cell) => cell === null));
  assert.equal(table.view().toMove, 'O');

  playAll(table, [5, 1, 9, 3, 2, 6, 7, 8, 4]);
  table.newGame('a');
  assert.equal(table.view().toMove, 'X');
});

test('leaving mid-game forfeits it to the other player', () => {
  const table = seated();
  table.move('a', 5);
  table.leave('a');
  assert.deepEqual(table.view().outcome, { kind: 'forfeit', winner: 'O' });
  assert.deepEqual(table.move('b', 1), { ok: false, error: 'game_over' });
});

test('leaving before the first move forfeits nothing', () => {
  const table = seated();
  table.leave('a');
  assert.equal(table.view().outcome, null);
  assert.equal(table.view().players.X, null);
});

test('a newcomer sits down to a fresh board, not a finished game', () => {
  const table = seated();
  playAll(table, X_WINS);
  table.leave('a');
  table.join('c', 'Carol');
  assert.equal(table.view().outcome, null);
  assert.ok(table.view().board.every((cell) => cell === null));
  assert.equal(table.view('c').you, 'X');
});

test(`${STRANGE_GAME_DRAWS} draws in a row make it a strange game, and a win resets the count`, () => {
  const table = seated();
  for (let i = 0; i < STRANGE_GAME_DRAWS; i++) {
    assert.equal(table.view().strangeGame, false);
    // O moves first on every other game, so the same squares still draw.
    playAll(table, DRAW);
    assert.equal(table.view().outcome?.kind, 'draw');
    table.newGame('a');
  }
  assert.equal(table.view().drawStreak, STRANGE_GAME_DRAWS);
  assert.equal(table.view().strangeGame, true);

  playAll(table, X_WINS);
  assert.equal(table.view().drawStreak, 0);
  assert.equal(table.view().strangeGame, false);
});

test('waiting returns at once when it is already your turn', async () => {
  const { status } = await seated().waitForTurn('a', 1000);
  assert.equal(status, 'your_turn');
});

test('waiting wakes up when the opponent moves', async () => {
  const table = seated();
  table.move('a', 5);
  const waiting = table.waitForTurn('a', 1000);
  table.move('b', 1);
  const { status, view } = await waiting;
  assert.equal(status, 'your_turn');
  assert.equal(view.board[0], 'O');
});

test('waiting wakes up when an opponent arrives', async () => {
  const table = new Table();
  table.join('a', 'Alice');
  const waiting = table.waitForTurn('a', 1000);
  table.join('b', 'Bob');
  assert.equal((await waiting).status, 'your_turn');
});

test('waiting gives up after the timeout', async () => {
  const table = seated();
  const started = Date.now();
  const { status } = await table.waitForTurn('b', 30);
  assert.equal(status, 'still_waiting');
  assert.ok(Date.now() - started >= 25);
});

test('waiting reports the end of the game, including a forfeit', async () => {
  const table = seated();
  table.move('a', 5);
  const waiting = table.waitForTurn('a', 1000);
  table.leave('b');
  const { status, view } = await waiting;
  assert.equal(status, 'game_over');
  assert.deepEqual(view.outcome, { kind: 'forfeit', winner: 'X' });
});

// A wait that keeps its listener leaks one per call. An AI that waits all
// night would pile them up, so this reads the private set to count them.
test('a finished wait stops listening', async () => {
  const table = seated();
  const listeners = (): number => (Reflect.get(table, 'listeners') as Set<unknown>).size;
  await table.waitForTurn('a', 1000);
  await table.waitForTurn('b', 10);
  const waiting = table.waitForTurn('b', 1000);
  assert.equal(listeners(), 1);
  table.move('a', 5);
  await waiting;
  assert.equal(listeners(), 0);
});

test('two requests for the next game make one new game, not two', () => {
  const table = seated();
  playAll(table, X_WINS);
  table.newGame('a');
  table.newGame('b');
  assert.equal(table.view().toMove, 'O');
});

test('a cancelled wait returns at once and stops listening', async () => {
  const table = seated();
  const controller = new AbortController();
  const waiting = table.waitForTurn('b', 60_000, controller.signal);
  controller.abort();
  assert.equal((await waiting).status, 'still_waiting');
  assert.equal((Reflect.get(table, 'listeners') as Set<unknown>).size, 0);
});

test('a won game is reported once, with everything needed to replay it', () => {
  let clock = Date.UTC(2026, 8, 23, 12, 0, 0);
  const table = new Table('7', () => clock);
  const games: FinishedGame[] = [];
  table.onFinish((g) => games.push(g));
  table.join('a', 'Alice');
  table.join('b', 'Bob');
  clock += 90_000;
  playAll(table, X_WINS);
  table.move('b', 9);

  assert.equal(games.length, 1);
  assert.equal(games[0]!.game, table.view().game);
  assert.deepEqual(games, [
    {
      table: '7',
      game: games[0]!.game,
      players: { X: 'Alice', O: 'Bob' },
      firstToMove: 'X',
      moves: X_WINS,
      outcome: { kind: 'win', winner: 'X', line: [1, 2, 3] },
      startedAt: '2026-09-23T12:00:00.000Z',
      endedAt: '2026-09-23T12:01:30.000Z',
    },
  ]);
});

test('a forfeit is reported with the leaver still named', () => {
  const table = seated();
  const games: FinishedGame[] = [];
  table.onFinish((g) => games.push(g));
  table.move('a', 5);
  table.leave('b');
  assert.equal(games.length, 1);
  assert.deepEqual(games[0]!.players, { X: 'Alice', O: 'Bob' });
  assert.deepEqual(games[0]!.outcome, { kind: 'forfeit', winner: 'X' });
});

test('leaving before any move reports no game', () => {
  const table = seated();
  let reported = 0;
  table.onFinish(() => reported++);
  table.leave('a');
  assert.equal(reported, 0);
});

test('the next game records who went first and only its own moves', () => {
  const table = seated();
  const games: FinishedGame[] = [];
  table.onFinish((g) => games.push(g));
  playAll(table, X_WINS);
  table.newGame('a');
  playAll(table, DRAW);
  assert.equal(games[1]!.firstToMove, 'O');
  assert.deepEqual(games[1]!.moves, DRAW);
});

test('each game gets its own id, and it changes with a new game', () => {
  const table = seated();
  const first = table.view().game;
  playAll(table, X_WINS);
  assert.equal(table.view().game, first);
  table.newGame('a');
  assert.notEqual(table.view().game, first);
});
