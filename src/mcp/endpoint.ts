// The /mcp endpoint: Streamable HTTP, one session per client. Every session
// gets its own transport and McpServer, all pointing at the same Lobby.

import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Express, Request, Response } from 'express';
import type { Lobby } from '../game/lobby.js';
import { Sessions, type IdleLimits } from '../sessions.js';
import type { Traffic } from '../traffic.js';
import { createWoprServer } from './server.js';

export interface McpEndpointOptions {
  lobby: Lobby;
  traffic: Traffic;
  idle: IdleLimits;
  sweepMs: number;
  log: (message: string) => void;
}

export function mountMcp(app: Express, { lobby, traffic, idle, sweepMs, log }: McpEndpointOptions): { close(): Promise<void> } {
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

  app.post('/mcp', handlePost);
  app.get('/mcp', handleSession);
  app.delete('/mcp', handleSession);

  const sweeper = setInterval(() => sessions.sweep(), sweepMs);
  return {
    async close() {
      clearInterval(sweeper);
      await sessions.closeAll();
    },
  };
}
