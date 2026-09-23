import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, LINES, newGame, openSquares, outcomeOf, type Cell, type GameState, type Mark } from './rules.js';

function play(moves: number[], first: Mark = 'X'): GameState {
  let state = newGame(first);
  for (const square of moves) {
    const result = applyMove(state, square, state.toMove);
    assert.ok(result.ok, `move ${square} was refused: ${!result.ok && result.error}`);
    state = result.state;
  }
  return state;
}

function boardFrom(text: string): Cell[] {
  return [...text].map((c) => (c === 'X' || c === 'O' ? c : null));
}

test('a new game is empty with X to move', () => {
  const state = newGame();
  assert.deepEqual(openSquares(state.board), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(state.toMove, 'X');
  assert.equal(state.outcome, null);
});

test('every one of the eight lines wins for either mark', () => {
  for (const mark of ['X', 'O'] as const) {
    for (const line of LINES) {
      const board = Array<Cell>(9).fill(null);
      for (const sq of line) board[sq - 1] = mark;
      assert.deepEqual(outcomeOf(board), { kind: 'win', winner: mark, line });
    }
  }
});

test('a full board with no line is a draw', () => {
  assert.deepEqual(outcomeOf(boardFrom('XOXXOOOXX')), { kind: 'draw' });
});

test('a win on the last square is a win, not a draw', () => {
  assert.equal(outcomeOf(boardFrom('XOXOXOOXX'))?.kind, 'win');
});

test('a played game reaches the right outcome', () => {
  const drawn = play([5, 1, 3, 7, 4, 6, 2, 8, 9]);
  assert.equal(drawn.outcome?.kind, 'draw');

  const xWins = play([1, 4, 2, 5, 3]);
  assert.deepEqual(xWins.outcome, { kind: 'win', winner: 'X', line: [1, 2, 3] });
});

test('turns alternate after each move', () => {
  const state = play([5]);
  assert.equal(state.toMove, 'O');
  assert.equal(state.board[4], 'X');
});

test('O can be the first to move', () => {
  const state = play([5], 'O');
  assert.equal(state.board[4], 'O');
  assert.equal(state.toMove, 'X');
});

test('a move out of turn is refused', () => {
  assert.deepEqual(applyMove(newGame(), 5, 'O'), { ok: false, error: 'not_your_turn' });
});

test('a taken square is refused', () => {
  assert.deepEqual(applyMove(play([5]), 5, 'O'), { ok: false, error: 'square_taken' });
});

test('squares outside 1 to 9, and non-integers, are refused', () => {
  for (const square of [0, 10, -1, 2.5, Number.NaN]) {
    assert.deepEqual(applyMove(newGame(), square, 'X'), { ok: false, error: 'bad_square' });
  }
});

test('no move is allowed once the game is over', () => {
  const over = play([1, 4, 2, 5, 3]);
  assert.deepEqual(applyMove(over, 9, 'O'), { ok: false, error: 'game_over' });
});

test('a refused move leaves the state untouched', () => {
  const state = play([5]);
  const before = structuredClone(state);
  applyMove(state, 5, 'O');
  assert.deepEqual(state, before);
});
