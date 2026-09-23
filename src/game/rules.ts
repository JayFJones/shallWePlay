// The rules of tic-tac-toe and nothing else. No I/O, no seats, no clocks,
// so every rule can be tested by handing in a board and reading the answer.

export type Mark = 'X' | 'O';
export type Cell = Mark | null;

// Squares are numbered 1 to 9 in reading order, the way a player says them:
//   1 | 2 | 3
//   4 | 5 | 6
//   7 | 8 | 9
// The board array is 0-based, so square n lives at index n - 1.
export type Board = readonly Cell[];

export type Outcome =
  | { kind: 'win'; winner: Mark; line: readonly [number, number, number] }
  | { kind: 'draw' };

export interface GameState {
  board: Board;
  toMove: Mark;
  outcome: Outcome | null;
}

export type MoveError = 'bad_square' | 'square_taken' | 'not_your_turn' | 'game_over';

export type MoveResult = { ok: true; state: GameState } | { ok: false; error: MoveError };

// As square numbers, so a win can be reported in the same terms a player uses.
export const LINES: readonly (readonly [number, number, number])[] = [
  [1, 2, 3], [4, 5, 6], [7, 8, 9],
  [1, 4, 7], [2, 5, 8], [3, 6, 9],
  [1, 5, 9], [3, 5, 7],
];

export function newGame(firstToMove: Mark = 'X'): GameState {
  return { board: Array<Cell>(9).fill(null), toMove: firstToMove, outcome: null };
}

export function other(mark: Mark): Mark {
  return mark === 'X' ? 'O' : 'X';
}

export function outcomeOf(board: Board): Outcome | null {
  for (const line of LINES) {
    const [a, b, c] = line.map((sq) => board[sq - 1]);
    if (a && a === b && a === c) return { kind: 'win', winner: a, line };
  }
  return board.every((cell) => cell !== null) ? { kind: 'draw' } : null;
}

export function openSquares(board: Board): number[] {
  const open: number[] = [];
  board.forEach((cell, i) => {
    if (cell === null) open.push(i + 1);
  });
  return open;
}

// The checks run in a fixed order so the error names the first thing wrong.
// A finished game refuses every move, even a well-formed one.
export function applyMove(state: GameState, square: number, mark: Mark): MoveResult {
  if (state.outcome) return { ok: false, error: 'game_over' };
  if (mark !== state.toMove) return { ok: false, error: 'not_your_turn' };
  if (!Number.isInteger(square) || square < 1 || square > 9) return { ok: false, error: 'bad_square' };
  if (state.board[square - 1] !== null) return { ok: false, error: 'square_taken' };

  const board = state.board.slice();
  board[square - 1] = mark;
  return { ok: true, state: { board, toMove: other(mark), outcome: outcomeOf(board) } };
}
