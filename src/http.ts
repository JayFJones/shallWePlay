// One process, one lobby of tables. Every MCP connection is its own session
// with its own transport and McpServer, all pointing at the same Lobby.

import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { mountAdmin } from './admin.js';
import { Lobby } from './game/lobby.js';
import { History } from './history.js';
import { createWoprServer } from './mcp/server.js';
import { DEFAULT_IDLE, Sessions, type IdleLimits } from './sessions.js';
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
  const sessions = new Sessions<StreamableHTTPServerTransport>(lobby, idle, log);

  // The spec answers an unknown session with 404, which tells a client to
  // start a new one. That matters once the idle sweep drops sessions.
  function unknownSession(res: Response): void {
    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found. Start a new one.' }, id: null });
  }

  async function handlePost(req: Request, res: Response): Promise<void> {
    const id = req.header('mcp-session-id');
    if (id) {
      const transport = sessions.touch(id);
      return transport ? transport.handleRequest(req, res, req.body) : unknownSession(res);
    }
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Start with an initialize request.' }, id: null });
      return;
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (newId) => sessions.add(newId, transport),
      onsessionclosed: (closedId) => sessions.end(closedId),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.end(transport.sessionId);
    };

    await createWoprServer(lobby).connect(transport);
    traffic.tap(transport);
    await transport.handleRequest(req, res, req.body);
  }

  async function handleSession(req: Request, res: Response): Promise<void> {
    const transport = sessions.touch(req.header('mcp-session-id') ?? '');
    if (!transport) return unknownSession(res);
    await transport.handleRequest(req, res);
  }

  const app = createMcpExpressApp({ host: HOST });
  app.post('/mcp', handlePost);
  app.get('/mcp', handleSession);
  app.delete('/mcp', handleSession);
  const admin = mountAdmin(app, { lobby, history, traffic });

  const sweeper = setInterval(() => sessions.sweep(), sweepMs);

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
          clearInterval(sweeper);
          admin.close();
          await sessions.closeAll();
          // Clients hold keep-alive sockets open, and close() waits on them.
          server.closeAllConnections();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
    server.once('error', (error) => {
      clearInterval(sweeper);
      reject(error);
    });
  });
}
