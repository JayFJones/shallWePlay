// A record of every MCP message, taken at the transport, so it shows what
// crossed the wire and not what a tool handler thinks it was sent. Each
// request is paired with its response and tied to the game it touched.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type MessageExtraInfo,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js';
import type { Lobby } from './game/lobby.js';
import type { Mark } from './game/rules.js';

export interface McpCall {
  seq: number;
  at: string;
  ms: number | null;
  session: string;
  endpoint: { http: 'POST'; path: string; protocolVersion: string | null };
  table: string | null;
  game: string | null;
  player: { name: string | null; mark: Mark } | null;
  method: string;
  request: JSONRPCMessage;
  // Notifications get no response, so this stays null for them.
  response: JSONRPCMessage | null;
  failed: boolean;
}

// Enough to answer "what happened in game N" after a restart, without
// holding every wait_for_turn call since the server was installed.
const KEPT_IN_MEMORY = 20_000;

type Context = Pick<McpCall, 'table' | 'game' | 'player'>;

export class Traffic {
  private calls: McpCall[] = [];
  private seq = 0;
  private listeners = new Set<(call: McpCall) => void>();

  constructor(
    private lobby: Lobby,
    private file: string | null = null,
    private log: (message: string) => void = () => {},
  ) {
    if (file && existsSync(file)) this.load(file);
  }

  // Call after McpServer.connect(), which is what installs onmessage.
  tap(transport: Transport, path = '/mcp'): void {
    const pending = new Map<RequestId, { call: McpCall; started: number }>();
    const inbound = transport.onmessage;
    const send = transport.send.bind(transport);

    transport.onmessage = (message: JSONRPCMessage, extra?: MessageExtraInfo) => {
      if (isJSONRPCRequest(message) || isJSONRPCNotification(message)) {
        const version = extra?.requestInfo?.headers['mcp-protocol-version'];
        const call = this.start(transport.sessionId ?? '', message, path, typeof version === 'string' ? version : null);
        if (isJSONRPCRequest(message)) pending.set(message.id, { call, started: performance.now() });
        else this.finish(call);
      }
      inbound?.(message, extra);
    };

    transport.send = (message, options) => {
      const id = isJSONRPCResponse(message) ? message.id : undefined;
      const entry = id === undefined ? undefined : pending.get(id);
      if (entry) {
        pending.delete(id!);
        const { call } = entry;
        // initialize has no session until the transport answers it, and
        // join_game has no table until the call runs.
        call.session ||= transport.sessionId ?? '';
        if (!call.game) Object.assign(call, this.context(call.session));
        call.response = message;
        call.ms = Math.round(performance.now() - entry.started);
        call.failed = isJSONRPCErrorResponse(message) || isToolError(message);
        this.finish(call);
      }
      return send(message, options);
    };
  }

  recent(limit: number): McpCall[] {
    return this.calls.slice(-limit).reverse();
  }

  forGame(game: string): McpCall[] {
    return this.calls.filter((c) => c.game === game);
  }

  onCall(listener: (call: McpCall) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private start(session: string, message: JSONRPCMessage & { method: string }, path: string, protocolVersion: string | null): McpCall {
    return {
      seq: 0,
      at: new Date().toISOString(),
      ms: null,
      session,
      endpoint: { http: 'POST', path, protocolVersion },
      ...this.context(session),
      method: message.method,
      request: message,
      response: null,
      failed: false,
    };
  }

  private context(session: string): Context {
    const table = this.lobby.tableOf(session);
    if (!table) return { table: null, game: null, player: null };
    const view = table.view(session);
    return { table: view.table, game: view.game, player: view.you ? { name: view.players[view.you], mark: view.you } : null };
  }

  private finish(call: McpCall): void {
    call.seq = ++this.seq;
    this.keep(call);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(call)}\n`);
    }
    for (const listener of [...this.listeners]) listener(call);
  }

  private keep(call: McpCall): void {
    this.calls.push(call);
    if (this.calls.length > KEPT_IN_MEMORY) this.calls.splice(0, this.calls.length - KEPT_IN_MEMORY);
  }

  private load(file: string): void {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        this.keep(JSON.parse(line) as McpCall);
      } catch {
        // A torn last line from a crash. The rest are still good.
      }
    }
    this.seq = this.calls.at(-1)?.seq ?? 0;
    this.log(`traffic: loaded ${this.calls.length} MCP calls from ${file}`);
  }
}

// A refused move is a successful JSON-RPC call whose result says isError.
// Both count as failed here, because both are what a reader looks for.
function isToolError(message: JSONRPCMessage): boolean {
  return isJSONRPCResultResponse(message) && message.result.isError === true;
}
