// The MCP face of WOPR. Every connection gets its own McpServer, and all of
// them share one Table, which is how two separate AI players end up on one
// board.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Table, TableError } from '../game/table.js';
import { describe, REFUSALS } from './text.js';

const INSTRUCTIONS = `GREETINGS. SHALL WE PLAY A GAME?

This is WOPR, a tic-tac-toe table for two players. Squares are numbered 1 to 9:
 1 | 2 | 3
 4 | 5 | 6
 7 | 8 | 9
Call join_game to take a seat as X or O. Call get_board to see the board and
whose turn it is. Call make_move with a square number on your turn. The
server enforces the rules and refuses illegal moves.`;

function said(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

function refused(error: TableError): CallToolResult {
  return { content: [{ type: 'text', text: REFUSALS[error] }], isError: true };
}

// The seat is tied to the MCP session, so the only way to act for a seat is
// to be the connection that took it. A missing session id means a stateless
// request, which could never hold a seat.
function playerOf(extra: { sessionId?: string }): string {
  if (!extra.sessionId) throw new Error('WOPR needs a stateful MCP session to seat a player.');
  return extra.sessionId;
}

export function createWoprServer(table: Table): McpServer {
  const server = new McpServer({ name: 'wopr', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'join_game',
    {
      title: 'Join the game',
      description:
        'Take a free seat at the tic-tac-toe table. The first player to join is X, the second is O. ' +
        'Joining again keeps the seat you already have. Refused if both seats are taken.',
      inputSchema: { name: z.string().describe('The name other players see for you, up to 40 characters.') },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    ({ name }, extra) => {
      const id = playerOf(extra);
      const result = table.join(id, name);
      if (!result.ok) return refused(result.error);
      return said(`You are ${result.value}.\n\n${describe(table.view(id))}`);
    },
  );

  server.registerTool(
    'get_board',
    {
      title: 'Look at the board',
      description:
        'Show the board, who sits where, whose turn it is, and the result if the game is over. ' +
        'Open squares show their number. Anyone can call this, seated or not.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (extra) => said(describe(table.view(playerOf(extra)))),
  );

  server.registerTool(
    'make_move',
    {
      title: 'Make a move',
      description:
        'Put your mark on a square, numbered 1 to 9 in reading order (1 is top left, 9 is bottom right). ' +
        'Only on your turn, only on an open square, and only while the game is running. ' +
        'Returns the board after your move.',
      inputSchema: { square: z.number().int().min(1).max(9).describe('The square to play, 1 to 9.') },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ square }, extra) => {
      const result = table.move(playerOf(extra), square);
      if (!result.ok) return refused(result.error);
      return said(describe(result.value));
    },
  );

  return server;
}
