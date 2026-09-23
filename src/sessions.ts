// The live MCP sessions, and what happens to the ones that go quiet.
//
// A client that exits cleanly sends DELETE and its seat is freed at once.
// Many do not: `claude -p` just exits. Without this sweep its seat would
// stay taken until the server restarts.

// The lobby, in practice. Only leave() matters here.
export interface Seats {
  leave(id: string): { ok: boolean };
}

export interface Closable {
  close(): Promise<void>;
}

export interface IdleLimits {
  // A player still in the game calls wait_for_turn at least every minute,
  // so a seat quiet for this long belongs to a player who has gone.
  seatMs: number;
  // Past this, the session itself is dropped. Longer than seatMs so a
  // player who wandered off can still come back and rejoin.
  sessionMs: number;
}

export const DEFAULT_IDLE: IdleLimits = { seatMs: 5 * 60_000, sessionMs: 60 * 60_000 };

export class Sessions<T extends Closable> {
  private live = new Map<string, { transport: T; lastSeen: number }>();

  constructor(
    private seats: Seats,
    private limits: IdleLimits = DEFAULT_IDLE,
    private log: (message: string) => void = () => {},
    private now: () => number = Date.now,
  ) {}

  add(id: string, transport: T): void {
    this.live.set(id, { transport, lastSeen: this.now() });
    this.log(`session ${short(id)} started`);
  }

  // Every request counts as a sign of life.
  touch(id: string): T | undefined {
    const session = this.live.get(id);
    if (session) session.lastSeen = this.now();
    return session?.transport;
  }

  // Called from both DELETE and transport close, so it must be safe twice.
  end(id: string): void {
    if (!this.live.delete(id)) return;
    this.seats.leave(id);
    this.log(`session ${short(id)} ended`);
  }

  sweep(): void {
    const now = this.now();
    for (const [id, session] of this.live) {
      const idle = now - session.lastSeen;
      if (idle >= this.limits.sessionMs) {
        this.end(id);
        void session.transport.close();
      } else if (idle >= this.limits.seatMs && this.seats.leave(id).ok) {
        this.log(`session ${short(id)} lost its seat after ${Math.round(idle / 1000)}s idle`);
      }
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.live.values()].map((s) => s.transport.close()));
  }
}

function short(id: string): string {
  return id.slice(0, 8);
}
