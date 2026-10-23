import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'openloci-test-fixture', version: '1' });
server.registerTool('list-events', { inputSchema: { account: z.string(), calendarId: z.string(), timeMin: z.string(), timeMax: z.string(), timeZone: z.string() } }, async input => ({
  content: [{ type: 'text', text: JSON.stringify({ events: [{ id: 'event-1', accountId: input.account, calendarId: input.calendarId,
    summary: 'Morning walk', start: { dateTime: '2026-10-23T08:00:00+08:00' }, end: { dateTime: '2026-10-23T08:30:00+08:00' },
  }] }) }],
}));
server.registerTool('notion-fetch', { inputSchema: { id: z.string() } }, async () => ({ content: [{ type: 'text', text: '# Weekly reflection\n\nA good week for walking.' }] }));
server.registerTool('dangerous-write', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'must not run' }] }));
await server.connect(new StdioServerTransport());
