// One process, one table. Every MCP connection is its own session with its
// own transport and McpServer, all pointing at the same Table.

import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';
import { Table } from './game/table.js';
import { createWoprServer } from './mcp/server.js';

// Localhost only. createMcpExpressApp then also checks the Host header,
// which stops a web page elsewhere from reaching this server through DNS
// rebinding.
const HOST = '127.0.0.1';

export interface Wopr {
  url: string;
  table: Table;
  close(): Promise<void>;
}

export type Log = (message: string) => void;

export function startWopr(port: number, log: Log = () => {}): Promise<Wopr> {
  const table = new Table();
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  // A session can end by a DELETE from the client or by the transport
  // closing. Either way the seat must be given up, once.
  function endSession(id: string): void {
    if (!sessions.delete(id)) return;
    table.leave(id);
    log(`session ${id.slice(0, 8)} ended`);
  }

  async function handlePost(req: Request, res: Response): Promise<void> {
    const id = req.header('mcp-session-id');
    const existing = id ? sessions.get(id) : undefined;
    if (existing) return existing.handleRequest(req, res, req.body);

    if (id || !isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unknown or missing session. Start with an initialize request.' },
        id: null,
      });
      return;
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (newId) => {
        sessions.set(newId, transport);
        log(`session ${newId.slice(0, 8)} started`);
      },
      onsessionclosed: endSession,
    });
    transport.onclose = () => {
      if (transport.sessionId) endSession(transport.sessionId);
    };

    await createWoprServer(table).connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  async function handleSession(req: Request, res: Response): Promise<void> {
    const transport = sessions.get(req.header('mcp-session-id') ?? '');
    if (!transport) {
      res.status(400).send('Unknown or missing session.');
      return;
    }
    await transport.handleRequest(req, res);
  }

  const app = createMcpExpressApp({ host: HOST });
  app.post('/mcp', handlePost);
  app.get('/mcp', handleSession);
  app.delete('/mcp', handleSession);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, HOST, () => {
      const address = server.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://localhost:${bound}`,
        table,
        close: async () => {
          await Promise.all([...sessions.values()].map((t) => t.close()));
          // Clients hold keep-alive sockets open, and close() waits on them.
          server.closeAllConnections();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
    server.once('error', reject);
  });
}
