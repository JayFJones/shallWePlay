// One process, one lobby of tables. This file only builds the shared parts
// and mounts the three ways in: MCP players at /mcp, people at /, and the
// admin panel at /admin.

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { mountAdmin } from './admin.js';
import { Lobby } from './game/lobby.js';
import { History } from './history.js';
import { mountMcp } from './mcp/endpoint.js';
import { DEFAULT_IDLE, type IdleLimits } from './sessions.js';
import { Traffic } from './traffic.js';

// Localhost only. createMcpExpressApp then also checks the Host header,
// which stops a web page elsewhere from reaching this server through DNS
// rebinding.
const HOST = '127.0.0.1';

export interface WoprOptions {
  port: number;
  log?: (message: string) => void;
  idle?: IdleLimits;
  sweepMs?: number;
  // Where finished games and MCP calls are appended. Leave out to keep
  // them in memory.
  historyFile?: string;
  callsFile?: string;
}

export interface Wopr {
  url: string;
  lobby: Lobby;
  history: History;
  traffic: Traffic;
  close(): Promise<void>;
}

export function startWopr(options: WoprOptions): Promise<Wopr> {
  const { port, log = () => {}, idle = DEFAULT_IDLE, sweepMs = 60_000, historyFile, callsFile } = options;
  const lobby = new Lobby();
  const history = new History(historyFile ?? null, log);
  const traffic = new Traffic(lobby, callsFile ?? null, log);
  lobby.onFinish((game) => {
    const { id, table, outcome } = history.record(game);
    log(`game ${id} at table ${table} ended: ${outcome.kind}`);
  });

  const app = createMcpExpressApp({ host: HOST });
  const mounts = [mountMcp(app, { lobby, traffic, idle, sweepMs, log }), mountAdmin(app, { lobby, history, traffic })];

  return new Promise((resolve, reject) => {
    const server = app.listen(port, HOST, () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://localhost:${bound}`,
        lobby,
        history,
        traffic,
        close: async () => {
          await Promise.all(mounts.map((m) => m.close()));
          // Clients hold keep-alive sockets open, and close() waits on them.
          server.closeAllConnections();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
    server.once('error', async (error) => {
      await Promise.all(mounts.map((m) => m.close()));
      reject(error);
    });
  });
}
