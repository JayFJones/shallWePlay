// Turns the table into the words a model reads. A model cannot see the
// board, so everything it needs to choose a move must be in this text.

import type { Mark } from '../game/rules.js';
import type { TableError, TableView, WaitStatus } from '../game/table.js';

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

  const seats = `X is ${name('X')}. O is ${name('O')}.`;
  lines.push(view.you ? `Table ${view.table}. You are ${view.you}. ${seats}` : `Table ${view.table}. ${seats}`);
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

// The first line says what happened, in capitals, so the model does not
// have to work it out from the board.
export function describeWait(status: Exclude<WaitStatus, 'not_seated'>, view: TableView): string {
  if (status === 'your_turn') return `YOUR TURN.\n\n${describe(view)}`;
  if (status === 'still_waiting') return `STILL WAITING. Call wait_for_turn again.\n\n${describe(view)}`;
  return describe(view);
}

// Each refusal says what went wrong and what to do next, because the model
// acts on this text and nothing else.
export const REFUSALS: Record<TableError, string> = {
  bad_square: 'Refused: squares are numbered 1 to 9.',
  square_taken: 'Refused: that square is taken. Pick an open square.',
  not_your_turn: 'Refused: it is not your turn. Call wait_for_turn.',
  game_over: 'Refused: the game is over. Start a new game to play again.',
  table_full: 'Refused: both seats are taken.',
  not_seated: 'Refused: you have no seat. Call join_game first.',
  no_opponent: 'Refused: there is no opponent yet. Call wait_for_turn until one joins.',
  game_in_progress: 'Refused: a game is in progress. If you asked for the next game, the other player already started it. Call wait_for_turn.',
};

export const INSTRUCTIONS = `GREETINGS. SHALL WE PLAY A GAME?

This is WOPR, a tic-tac-toe server. Squares are numbered 1 to 9:
 1 | 2 | 3
 4 | 5 | 6
 7 | 8 | 9
Call join_game to take a seat. You are put at a table with a player who is
waiting, or at a new table. Call wait_for_turn to wait for your move, and
make_move to play it. The server enforces the rules and refuses illegal
moves. The shall_we_play prompt walks through a whole match.`;

// The whole match as one set of steps, so a model started with one slash
// command can play to the end without help.
export function playInstructions(name: string, games: number): string {
  return `GREETINGS. SHALL WE PLAY A GAME?

You are playing tic-tac-toe on the WOPR server as "${name}". Play ${games} game${games === 1 ? '' : 's'}.

1. Call join_game with the name "${name}".
2. Call wait_for_turn. It answers YOUR TURN, GAME OVER, or STILL WAITING.
   On STILL WAITING, call it again. Do not stop to ask me.
3. On YOUR TURN, read the board and call make_move with your square.
   Play to win. Block any line the other player could finish next move.
4. On GAME OVER, note the result. If you have games left, call new_game,
   then go back to step 2. If new_game is refused because a game is in
   progress, the other player already started it: go back to step 2.
5. If WOPR says A STRANGE GAME, stop early.
6. When you are done, call leave_game. Then report each game's result in
   one line, and anything WOPR said at the end.`;
}
