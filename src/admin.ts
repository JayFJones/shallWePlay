// The admin panel's data: live tables, finished games, the MCP calls behind
// them, and the list of MCP commands. Read-only. Nothing here can move a
// piece or free a seat.

import { fileURLToPath } from 'node:url';
import express, { type Express, type Response } from 'express';
import { buildCatalog, type Catalog } from './catalog.js';
import type { Lobby } from './game/lobby.js';
import type { History } from './history.js';
import type { McpCall, Traffic } from './traffic.js';

// Resolved from this file, so it works from dist/ whatever the working
// directory is.
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

// Proxies and browsers drop an idle stream. A comment line every so often
// keeps it open without waking the page.
const KEEPALIVE_MS = 25_000;

const HISTORY_SHOWN = 200;
const CALLS_SHOWN = 100;

export interface AdminSources {
  lobby: Lobby;
  history: History;
  traffic: Traffic;
}

export function mountAdmin(app: Express, { lobby, history, traffic }: AdminSources): { close(): void } {
  const snapshot = () => ({ tables: lobby.views(), history: history.list().slice(0, HISTORY_SHOWN) });
  const streams = new Set<Response>();
  const broadcast = (event: string, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) res.write(frame);
  };

  app.get('/api/state', (_req, res) => {
    res.json(snapshot());
  });

  app.get('/api/calls', (_req, res) => {
    res.json(traffic.recent(CALLS_SHOWN));
  });

  app.get('/api/games/:game/calls', (req, res) => {
    res.json(traffic.forGame(req.params.game));
  });

  // Built once, on first request. The tool list only changes when the code
  // does, and that means a restart anyway.
  let catalog: Promise<Catalog> | null = null;
  app.get('/api/catalog', async (_req, res) => {
    catalog ??= buildCatalog();
    res.json(await catalog);
  });

  // Server-sent events: the server pushes, the page listens. A "state"
  // message carries the whole state, so the page never has to merge. A
  // "call" message carries one MCP call as it completes.
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    streams.add(res);
    req.on('close', () => streams.delete(res));
  });

  const offChange = lobby.onChange(() => broadcast('state', snapshot()));
  const offCall = traffic.onCall((call: McpCall) => broadcast('call', call));
  const keepalive = setInterval(() => {
    for (const res of streams) res.write(': keepalive\n\n');
  }, KEEPALIVE_MS);

  app.get('/admin', (_req, res) => res.sendFile('admin.html', { root: PUBLIC_DIR }));
  app.use(express.static(PUBLIC_DIR));

  return {
    close() {
      offChange();
      offCall();
      clearInterval(keepalive);
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}
