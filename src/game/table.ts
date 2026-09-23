// The one game table everybody plays at. It knows who sits where and wakes
// up players who are waiting. The rules themselves live in rules.ts.

import { applyMove, newGame, other, type Board, type GameState, type Mark, type MoveError, type Outcome } from './rules.js';

// Whoever connects gets an id from the transport: an MCP session id, or a
// browser token. The table only compares them.
export type PlayerId = string;

export type Ending = Outcome | { kind: 'forfeit'; winner: Mark };

export interface TableView {
  board: Board;
  toMove: Mark;
  outcome: Ending | null;
  players: Record<Mark, string | null>;
  you: Mark | null;
  drawStreak: number;
  strangeGame: boolean;
}

export type TableError = MoveError | 'table_full' | 'not_seated' | 'no_opponent' | 'game_in_progress';

export type Result<T> = { ok: true; value: T } | { ok: false; error: TableError };

export type WaitStatus = 'your_turn' | 'game_over' | 'still_waiting' | 'not_seated';

// WarGames: Joshua gives up on tic-tac-toe after enough draws. Three is
// enough to see it happen in a demo without playing all night.
export const STRANGE_GAME_DRAWS = 3;

const NAME_LIMIT = 40;

interface Seat {
  id: PlayerId;
  name: string;
}

export class Table {
  private seats: Record<Mark, Seat | null> = { X: null, O: null };
  private game: GameState = newGame('X');
  private forfeitWinner: Mark | null = null;
  private drawStreak = 0;
  private listeners = new Set<() => void>();

  join(id: PlayerId, name: string): Result<Mark> {
    const seated = this.markOf(id);
    if (seated) return { ok: true, value: seated };

    const mark: Mark | null = !this.seats.X ? 'X' : !this.seats.O ? 'O' : null;
    if (!mark) return { ok: false, error: 'table_full' };

    this.seats[mark] = { id, name: name.trim().slice(0, NAME_LIMIT) || `Player ${mark}` };
    // A newcomer should not sit down to somebody else's finished game.
    if (this.outcome()) this.reset(other(this.firstToMove()));
    this.changed();
    return { ok: true, value: mark };
  }

  leave(id: PlayerId): Result<null> {
    const mark = this.markOf(id);
    if (!mark) return { ok: false, error: 'not_seated' };

    // Walking out of a game you are losing must not erase the loss.
    if (this.inProgress() && this.seats[other(mark)]) {
      this.forfeitWinner = other(mark);
      this.drawStreak = 0;
    }
    this.seats[mark] = null;
    this.changed();
    return { ok: true, value: null };
  }

  move(id: PlayerId, square: number): Result<TableView> {
    const mark = this.markOf(id);
    if (!mark) return { ok: false, error: 'not_seated' };
    if (this.forfeitWinner) return { ok: false, error: 'game_over' };
    if (!this.seats[other(mark)]) return { ok: false, error: 'no_opponent' };

    const result = applyMove(this.game, square, mark);
    if (!result.ok) return result;

    this.game = result.state;
    if (this.game.outcome?.kind === 'draw') this.drawStreak += 1;
    if (this.game.outcome?.kind === 'win') this.drawStreak = 0;
    this.changed();
    return { ok: true, value: this.view(id) };
  }

  // Refused mid-game, so a losing player cannot wipe the board.
  newGame(id: PlayerId): Result<TableView> {
    if (!this.markOf(id)) return { ok: false, error: 'not_seated' };
    if (this.inProgress()) return { ok: false, error: 'game_in_progress' };

    // Both players often ask for the next game at once. The second request
    // must not reset again, or the first move would swap back.
    if (this.fresh()) return { ok: true, value: this.view(id) };

    // Whoever moved second last time moves first this time.
    this.reset(other(this.firstToMove()));
    this.changed();
    return { ok: true, value: this.view(id) };
  }

  view(id?: PlayerId): TableView {
    return {
      board: this.game.board,
      toMove: this.game.toMove,
      outcome: this.outcome(),
      players: { X: this.seats.X?.name ?? null, O: this.seats.O?.name ?? null },
      you: id ? this.markOf(id) : null,
      drawStreak: this.drawStreak,
      strangeGame: this.drawStreak >= STRANGE_GAME_DRAWS,
    };
  }

  // MCP clients call the server, never the other way round, so a player
  // cannot be told "your turn". Instead the call itself waits, and gives up
  // after the timeout so it stays inside the client's tool time limit.
  // A cancelled call stops waiting at once instead of holding a listener
  // until the timeout.
  waitForTurn(id: PlayerId, timeoutMs: number, signal?: AbortSignal): Promise<{ status: WaitStatus; view: TableView }> {
    return new Promise((resolve) => {
      const check = (giveUp: boolean): boolean => {
        const status = this.waitStatus(id);
        if (status === 'still_waiting' && !giveUp) return false;
        clearTimeout(timer);
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
        resolve({ status, view: this.view(id) });
        return true;
      };
      const onAbort = (): boolean => check(true);
      const timer = setTimeout(() => check(true), timeoutMs);
      const unsubscribe = this.onChange(() => check(false));
      signal?.addEventListener('abort', onAbort);
      check(signal?.aborted ?? false);
    });
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private waitStatus(id: PlayerId): WaitStatus {
    const mark = this.markOf(id);
    if (!mark) return 'not_seated';
    if (this.outcome()) return 'game_over';
    if (this.seats[other(mark)] && this.game.toMove === mark) return 'your_turn';
    return 'still_waiting';
  }

  private markOf(id: PlayerId): Mark | null {
    if (this.seats.X?.id === id) return 'X';
    if (this.seats.O?.id === id) return 'O';
    return null;
  }

  private outcome(): Ending | null {
    if (this.forfeitWinner) return { kind: 'forfeit', winner: this.forfeitWinner };
    return this.game.outcome;
  }

  private fresh(): boolean {
    return !this.outcome() && this.game.board.every((cell) => cell === null);
  }

  private inProgress(): boolean {
    return !this.outcome() && this.game.board.some((cell) => cell !== null);
  }

  // Marks alternate, so after an even number of moves the mark to move is
  // the one that went first. Saves keeping a second copy of that fact.
  private firstToMove(): Mark {
    const played = this.game.board.filter((cell) => cell !== null).length;
    return played % 2 === 0 ? this.game.toMove : other(this.game.toMove);
  }

  private reset(firstToMove: Mark): void {
    this.game = newGame(firstToMove);
    this.forfeitWinner = null;
  }

  // Copied first, because a listener may unsubscribe while we loop.
  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
