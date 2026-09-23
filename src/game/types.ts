// The shapes the rest of the server reads: what a table looks like from
// outside, what a finished game records, and the ways a request can fail.

import type { Board, Mark, MoveError, Outcome } from './rules.js';

// Whoever connects gets an id from the transport: an MCP session id, or a
// browser token. The table only compares them.
export type PlayerId = string;

export type Ending = Outcome | { kind: 'forfeit'; winner: Mark };

export interface TableView {
  table: string;
  // Unique per game, so a record of MCP calls can say which game it was.
  game: string;
  board: Board;
  toMove: Mark;
  outcome: Ending | null;
  players: Record<Mark, string | null>;
  you: Mark | null;
  drawStreak: number;
  strangeGame: boolean;
}

// Enough to replay the game square by square.
export interface FinishedGame {
  table: string;
  game: string;
  players: Record<Mark, string | null>;
  firstToMove: Mark;
  moves: number[];
  outcome: Ending;
  startedAt: string;
  endedAt: string;
}

export type TableError = MoveError | 'table_full' | 'not_seated' | 'no_opponent' | 'game_in_progress';

export type Result<T> = { ok: true; value: T } | { ok: false; error: TableError };

export type WaitStatus = 'your_turn' | 'game_over' | 'still_waiting' | 'not_seated';
