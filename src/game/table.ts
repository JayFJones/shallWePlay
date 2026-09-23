// One game table. It knows who sits where, wakes up players who are
// waiting, and reports each finished game. The rules live in rules.ts, and
// which player sits at which table is the lobby's business.

import { randomUUID } from 'node:crypto';
import { applyMove, newGame, other, type GameState, type Mark } from './rules.js';
import type { Ending, FinishedGame, PlayerId, Result, TableView, WaitStatus } from './types.js';

export type { Ending, FinishedGame, PlayerId, Result, TableError, TableView, WaitStatus } from './types.js';

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
  private first: Mark = 'X';
  private gameId: string = randomUUID();
  private moves: number[] = [];
  private startedAt: number;
  private forfeitWinner: Mark | null = null;
  private drawStreak = 0;
  private listeners = new Set<() => void>();
  private finishListeners = new Set<(game: FinishedGame) => void>();

  constructor(
    readonly id = '1',
    private now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  join(id: PlayerId, name: string): Result<Mark> {
    const seated = this.markOf(id);
    if (seated) return { ok: true, value: seated };

    const mark: Mark | null = !this.seats.X ? 'X' : !this.seats.O ? 'O' : null;
    if (!mark) return { ok: false, error: 'table_full' };

    this.seats[mark] = { id, name: name.trim().slice(0, NAME_LIMIT) || `Player ${mark}` };
    // A newcomer should not sit down to somebody else's finished game.
    if (this.outcome()) this.reset(other(this.first));
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
      this.finished();
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
    this.moves.push(square);
    if (this.game.outcome?.kind === 'draw') this.drawStreak += 1;
    if (this.game.outcome?.kind === 'win') this.drawStreak = 0;
    if (this.game.outcome) this.finished();
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
    this.reset(other(this.first));
    this.changed();
    return { ok: true, value: this.view(id) };
  }

  view(id?: PlayerId): TableView {
    return {
      table: this.id,
      game: this.gameId,
      board: this.game.board,
      toMove: this.game.toMove,
      outcome: this.outcome(),
      players: this.names(),
      you: id ? this.markOf(id) : null,
      drawStreak: this.drawStreak,
      strangeGame: this.drawStreak >= STRANGE_GAME_DRAWS,
    };
  }

  isEmpty(): boolean {
    return !this.seats.X && !this.seats.O;
  }

  hasFreeSeat(): boolean {
    return !this.seats.X || !this.seats.O;
  }

  // MCP clients call the server, never the other way round, so a player
  // cannot be told "your turn". Instead the call itself waits, and gives up
  // after the timeout so it stays inside the client's tool time limit. A
  // cancelled call stops waiting at once instead of holding a listener.
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

  onFinish(listener: (game: FinishedGame) => void): () => void {
    this.finishListeners.add(listener);
    return () => this.finishListeners.delete(listener);
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

  private names(): Record<Mark, string | null> {
    return { X: this.seats.X?.name ?? null, O: this.seats.O?.name ?? null };
  }

  private outcome(): Ending | null {
    if (this.forfeitWinner) return { kind: 'forfeit', winner: this.forfeitWinner };
    return this.game.outcome;
  }

  private fresh(): boolean {
    return !this.outcome() && this.moves.length === 0;
  }

  private inProgress(): boolean {
    return !this.outcome() && this.moves.length > 0;
  }

  private reset(first: Mark): void {
    this.game = newGame(first);
    this.first = first;
    this.moves = [];
    this.gameId = randomUUID();
    this.startedAt = this.now();
    this.forfeitWinner = null;
  }

  private finished(): void {
    const outcome = this.outcome();
    if (!outcome) return;
    const game: FinishedGame = {
      table: this.id,
      game: this.gameId,
      players: this.names(),
      firstToMove: this.first,
      moves: [...this.moves],
      outcome,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(this.now()).toISOString(),
    };
    for (const listener of [...this.finishListeners]) listener(game);
  }

  // Copied first, because a listener may unsubscribe while we loop.
  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
