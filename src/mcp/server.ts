// The MCP face of WOPR. Every connection gets its own McpServer, and all of
// them share one Lobby, which is how separate AI players end up at the
// same table.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Lobby } from '../game/lobby.js';
import type { Table, TableError } from '../game/table.js';
import { describe, describeWait, INSTRUCTIONS, playInstructions, REFUSALS } from './text.js';

// Long enough that a model waiting on a slow opponent makes few calls.
// Short enough to stay inside a client's tool time limit.
const WAIT_DEFAULT_S = 30;
const WAIT_MAX_S = 55;

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

export function createWoprServer(lobby: Lobby): McpServer {
  const server = new McpServer({ name: 'wopr', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  // Runs a tool body against the caller's table, or refuses if they have none.
  const atTable =
    (body: (table: Table, id: string) => CallToolResult | Promise<CallToolResult>) =>
    (extra: { sessionId?: string }): CallToolResult | Promise<CallToolResult> => {
      const id = playerOf(extra);
      const table = lobby.tableOf(id);
      return table ? body(table, id) : refused('not_seated');
    };

  server.registerTool(
    'join_game',
    {
      title: 'Join a game',
      description:
        'Take a seat. You are put at a table where a player is waiting, or at a new table. ' +
        'The first player at a table is X, the second is O. Joining again keeps the seat you have.',
      inputSchema: { name: z.string().describe('The name other players see for you, up to 40 characters.') },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    ({ name }, extra) => {
      const id = playerOf(extra);
      const result = lobby.join(id, name);
      if (!result.ok) return refused(result.error);
      return said(`You are ${result.value.mark} at table ${result.value.table}.\n\n${describe(lobby.tableOf(id)!.view(id))}`);
    },
  );

  server.registerTool(
    'get_board',
    {
      title: 'Look at the board',
      description:
        'Show your table: the board, who sits where, whose turn it is, and the result if the game is over. ' +
        'Open squares show their number. Returns at once. To wait for your turn, use wait_for_turn.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    atTable((table, id) => said(describe(table.view(id)))),
  );

  server.registerTool(
    'wait_for_turn',
    {
      title: 'Wait for your turn',
      description:
        'Wait until it is your turn or the game ends, then show the board. ' +
        `Gives up after timeout_seconds and answers STILL WAITING. Then call it again.`,
      inputSchema: {
        timeout_seconds: z.number().int().min(1).max(WAIT_MAX_S).optional().describe(`How long to wait, default ${WAIT_DEFAULT_S}.`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ timeout_seconds }, extra) =>
      atTable(async (table, id) => {
        const { status, view } = await table.waitForTurn(id, (timeout_seconds ?? WAIT_DEFAULT_S) * 1000, extra.signal);
        return status === 'not_seated' ? refused('not_seated') : said(describeWait(status, view));
      })(extra),
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
    ({ square }, extra) =>
      atTable((table, id) => {
        const result = table.move(id, square);
        return result.ok ? said(describe(result.value)) : refused(result.error);
      })(extra),
  );

  server.registerTool(
    'new_game',
    {
      title: 'Start the next game',
      description:
        'Clear the board for the next game with the same opponent. Whoever moved second last time moves first. ' +
        'Refused while a game is running. Asking when a new game has already started does nothing.',
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    atTable((table, id) => {
      const result = table.newGame(id);
      return result.ok ? said(describe(result.value)) : refused(result.error);
    }),
  );

  server.registerTool(
    'leave_game',
    {
      title: 'Leave the table',
      description: 'Give up your seat. Leaving in the middle of a game forfeits it to the other player.',
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    (extra) => {
      const result = lobby.leave(playerOf(extra));
      return result.ok ? said('You have left the table. GOODBYE.') : refused(result.error);
    },
  );

  server.registerResource(
    'board',
    'wopr://board',
    { title: 'Your board', description: 'The board at your table, as text.', mimeType: 'text/plain' },
    (uri, extra) => {
      const id = playerOf(extra);
      const table = lobby.tableOf(id);
      return { contents: [{ uri: uri.href, text: table ? describe(table.view(id)) : REFUSALS.not_seated }] };
    },
  );

  server.registerPrompt(
    'shall_we_play',
    {
      title: 'Shall we play a game?',
      description: 'Play a whole tic-tac-toe match on WOPR: join, wait, move, and repeat until the match ends.',
      argsSchema: {
        name: z.string().optional().describe('Your name at the table. Default: Joshua.'),
        games: z.string().optional().describe('How many games to play, 1 to 10. Default: 1.'),
      },
    },
    ({ name, games }) => {
      const count = Math.max(1, Math.min(10, Number.parseInt(games ?? '1', 10) || 1));
      return {
        messages: [{ role: 'user', content: { type: 'text', text: playInstructions(name?.trim() || 'Joshua', count) } }],
      };
    },
  );

  return server;
}
