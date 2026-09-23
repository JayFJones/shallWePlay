// Turns the table into the words a model reads. A model cannot see the
// board, so everything it needs to choose a move must be in this text.

import type { Mark } from '../game/rules.js';
import type { TableError, TableView } from '../game/table.js';

// Open squares show their number, so the model can read its legal moves
// straight off the picture instead of counting cells.
export function drawBoard(view: TableView): string {
  const cell = (i: number): string => view.board[i] ?? String(i + 1);
  const row = (r: number): string => ` ${cell(r * 3)} | ${cell(r * 3 + 1)} | ${cell(r * 3 + 2)}`;
  return [row(0), '---+---+---', row(1), '---+---+---', row(2)].join('\n');
}

export function describe(view: TableView): string {
  const name = (mark: Mark): string => view.players[mark] ?? 'nobody';
  const lines = [drawBoard(view), ''];

  lines.push(view.you ? `You are ${view.you}. X is ${name('X')}. O is ${name('O')}.` : `X is ${name('X')}. O is ${name('O')}.`);
  lines.push(status(view));

  if (view.strangeGame) {
    lines.push('', `A STRANGE GAME. THE ONLY WINNING MOVE IS NOT TO PLAY. (${view.drawStreak} draws in a row)`);
  }
  return lines.join('\n');
}

function status(view: TableView): string {
  const outcome = view.outcome;
  if (outcome?.kind === 'win') return `GAME OVER. ${outcome.winner} wins on squares ${outcome.line.join('-')}.`;
  if (outcome?.kind === 'draw') return 'GAME OVER. A draw.';
  if (outcome?.kind === 'forfeit') return `GAME OVER. ${outcome.winner} wins because the other player left.`;
  if (!view.players.X || !view.players.O) return 'Waiting for a second player to join.';
  if (view.you === view.toMove) return `Your move. Open squares: ${openList(view)}.`;
  return `${view.toMove} to move.`;
}

function openList(view: TableView): string {
  return view.board.flatMap((cell, i) => (cell === null ? [i + 1] : [])).join(', ');
}

// Each refusal says what went wrong and what to do next, because the model
// acts on this text and nothing else.
export const REFUSALS: Record<TableError, string> = {
  bad_square: 'Refused: squares are numbered 1 to 9.',
  square_taken: 'Refused: that square is taken. Pick an open square.',
  not_your_turn: 'Refused: it is not your turn. Wait for the other player to move.',
  game_over: 'Refused: the game is over. Start a new game to play again.',
  table_full: 'Refused: both seats are taken. You can watch with get_board.',
  not_seated: 'Refused: you have no seat. Call join_game first.',
  no_opponent: 'Refused: there is no opponent yet. Wait for a second player to join.',
  game_in_progress: 'Refused: a game is in progress. Finish it first.',
};
