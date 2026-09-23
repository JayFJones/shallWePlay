// Every MCP command WOPR answers, for the admin panel. The list is not
// written by hand: a client connects to a throwaway copy of the server in
// memory and asks, exactly as Claude Code does. So it cannot drift from the
// code.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { Lobby } from './game/lobby.js';
import { createWoprServer } from './mcp/server.js';

// The JSON-RPC methods under the tools, resources and prompts. The SDK
// handles these itself, so there is nothing in our code to list them from.
// Each entry names the capability that turns it on.
const PROTOCOL_METHODS = [
  { method: 'initialize', needs: null, does: 'Opens a session. Client and server agree a protocol version and say what each can do.' },
  { method: 'notifications/initialized', needs: null, does: 'The client says it is ready. A notification, so no reply.' },
  { method: 'ping', needs: null, does: 'Checks the other side is still there.' },
  { method: 'tools/list', needs: 'tools', does: 'Lists the tools, with a JSON Schema for each one\'s arguments.' },
  { method: 'tools/call', needs: 'tools', does: 'Runs one tool with arguments. Every game move goes through this.' },
  { method: 'resources/list', needs: 'resources', does: 'Lists the resources a client can read.' },
  { method: 'resources/templates/list', needs: 'resources', does: 'Lists resource URI patterns. WOPR has none.' },
  { method: 'resources/read', needs: 'resources', does: 'Reads one resource by URI.' },
  { method: 'prompts/list', needs: 'prompts', does: 'Lists the prompts a client can offer its user.' },
  { method: 'prompts/get', needs: 'prompts', does: 'Fills in one prompt with arguments and returns its messages.' },
] as const;

export interface Catalog {
  server: { name: string; version: string } | null;
  // Newest first. A client asks for one at initialize and the server
  // answers with the newest both sides know.
  protocolVersions: string[];
  instructions: string | null;
  endpoint: string;
  methods: { method: string; does: string }[];
  tools: Awaited<ReturnType<Client['listTools']>>['tools'];
  resources: Awaited<ReturnType<Client['listResources']>>['resources'];
  prompts: Awaited<ReturnType<Client['listPrompts']>>['prompts'];
}

export async function buildCatalog(endpoint = '/mcp'): Promise<Catalog> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // A lobby of its own, so asking cannot seat anybody at a real table.
  const server = createWoprServer(new Lobby());
  const client = new Client({ name: 'wopr-catalog', version: '0.0.0' });
  await server.connect(serverSide);
  await client.connect(clientSide);

  try {
    const capabilities = client.getServerCapabilities() ?? {};
    const [{ tools }, { resources }, { prompts }] = await Promise.all([client.listTools(), client.listResources(), client.listPrompts()]);
    return {
      server: client.getServerVersion() ?? null,
      protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      instructions: client.getInstructions() ?? null,
      endpoint,
      methods: PROTOCOL_METHODS.filter((m) => !m.needs || m.needs in capabilities).map(({ method, does }) => ({ method, does })),
      tools,
      resources,
      prompts,
    };
  } finally {
    await client.close();
    await server.close();
  }
}
