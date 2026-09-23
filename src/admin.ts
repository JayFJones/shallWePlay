// The admin panel's data: live tables and finished games, as JSON and as a
// live stream. Read-only. Nothing here can move a piece or free a seat.

import { fileURLToPath } from 'node:url';
import express, { type Express, type Response } from 'express';
import type { Lobby } from './game/lobby.js';
import type { History } from './history.js';

// Resolved from this file, so it works from dist/ whatever the working
// directory is.
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

// Proxies and browsers drop an idle stream. A comment line every so often
// keeps it open without waking the page.
const KEEPALIVE_MS = 25_000;

const HISTORY_SHOWN = 200;

export function mountAdmin(app: Express, lobby: Lobby, history: History): { close(): void } {
  const snapshot = () => ({ tables: lobby.views(), history: history.list().slice(0, HISTORY_SHOWN) });
  const streams = new Set<Response>();

  app.get('/api/state', (_req, res) => {
    res.json(snapshot());
  });

  // Server-sent events: the server pushes, the page listens. One message
  // per change carries the whole state, so the page never has to merge.
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    streams.add(res);
    req.on('close', () => streams.delete(res));
  });

  const unsubscribe = lobby.onChange(() => {
    const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of streams) res.write(data);
  });
  const keepalive = setInterval(() => {
    for (const res of streams) res.write(': keepalive\n\n');
  }, KEEPALIVE_MS);

  app.get('/admin', (_req, res) => res.sendFile('admin.html', { root: PUBLIC_DIR }));
  app.use(express.static(PUBLIC_DIR));

  return {
    close() {
      unsubscribe();
      clearInterval(keepalive);
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}
