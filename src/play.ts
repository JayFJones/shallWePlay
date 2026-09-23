// How a person plays: plain HTTP from the page at /, against the same lobby
// the MCP players use. A person and an AI sit at one table and neither can
// tell how the other connected.

import type { Express, Request, Response } from 'express';
import type { Lobby } from './game/lobby.js';
import type { Result, TableView } from './game/table.js';

export interface PlayOptions {
  lobby: Lobby;
  // How long a player with no open page keeps the seat. Long enough to
  // survive a page reload, short enough that a closed tab frees the table.
  graceMs?: number;
  sweepMs?: number;
}

// The page makes up its own random token and keeps it. It must look random
// enough that one player cannot guess another's.
const TOKEN = /^[A-Za-z0-9-]{16,64}$/;

// A browser player id can never equal an MCP session id.
const playerId = (token: string): string => `web:${token}`;

export function mountPlay(app: Express, { lobby, graceMs = 60_000, sweepMs = 10_000 }: PlayOptions): { close(): void } {
  const presence = new Map<string, { streams: number; lastSeen: number }>();

  function seen(token: string, streamDelta = 0): void {
    const entry = presence.get(token) ?? { streams: 0, lastSeen: 0 };
    entry.streams += streamDelta;
    entry.lastSeen = Date.now();
    presence.set(token, entry);
  }

  function tokenOf(req: Request, res: Response): string | null {
    const token = req.header('x-wopr-player') ?? (typeof req.query.player === 'string' ? req.query.player : '');
    if (TOKEN.test(token)) return token;
    res.status(400).json({ ok: false, error: 'bad_token' });
    return null;
  }

  const viewOf = (token: string): TableView | null => lobby.tableOf(playerId(token))?.view(playerId(token)) ?? null;

  function answer(res: Response, token: string, result: Result<unknown>): void {
    res.status(result.ok ? 200 : 409).json(result.ok ? { ok: true, view: viewOf(token) } : { ok: false, error: result.error, view: viewOf(token) });
  }

  // Every action finds the player's table first, so a player with no seat
  // gets the same not_seated answer from every route.
  function action(run: (id: string, body: Record<string, unknown>) => Result<unknown>) {
    return (req: Request, res: Response) => {
      const token = tokenOf(req, res);
      if (!token) return;
      seen(token);
      answer(res, token, run(playerId(token), (req.body ?? {}) as Record<string, unknown>));
    };
  }

  const atTable = (id: string, run: (table: NonNullable<ReturnType<Lobby['tableOf']>>) => Result<unknown>): Result<unknown> => {
    const table = lobby.tableOf(id);
    return table ? run(table) : { ok: false, error: 'not_seated' };
  };

  app.post('/api/play/join', action((id, body) => lobby.join(id, String(body.name ?? ''))));
  app.post('/api/play/move', action((id, body) => atTable(id, (t) => t.move(id, Number(body.square)))));
  app.post('/api/play/new', action((id) => atTable(id, (t) => t.newGame(id))));
  app.post('/api/play/leave', action((id) => lobby.leave(id)));

  // The page's own board, pushed on every change. EventSource cannot send
  // headers, so the token comes in the query string.
  app.get('/api/play/events', (req, res) => {
    const token = tokenOf(req, res);
    if (!token) return;
    seen(token, +1);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let last = '';
    const push = () => {
      const data = JSON.stringify(viewOf(token));
      if (data === last) return;
      last = data;
      res.write(`event: view\ndata: ${data}\n\n`);
    };
    push();
    const off = lobby.onChange(push);
    req.on('close', () => {
      off();
      seen(token, -1);
    });
  });

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of presence) {
      if (entry.streams > 0 || now - entry.lastSeen < graceMs) continue;
      presence.delete(token);
      lobby.leave(playerId(token));
    }
  }, sweepMs);

  return { close: () => clearInterval(sweeper) };
}
