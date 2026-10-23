import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'openloci-test-fixture', version: '1' });
server.registerTool('list-events', { inputSchema: { account: z.string(), calendarId: z.string(), timeMin: z.string(), timeMax: z.string(), timeZone: z.string() } }, async input => ({
  content: [{ type: 'text', text: JSON.stringify({ events: [{ id: 'event-1', accountId: input.account, calendarId: input.calendarId,
    summary: 'Morning walk', start: { dateTime: '2026-10-23T08:00:00+08:00' }, end: { dateTime: '2026-10-23T08:30:00+08:00' },
  }] }) }],
}));
server.registerTool('notion-fetch', { inputSchema: { id: z.string() } }, async input => ({ content: [{ type: 'text', text: input.id === '22222222-2222-4222-8222-222222222222'
  ? JSON.stringify({ title: 'October', text: '<content><page url="https://notion.so/example">A child page</page></content>' })
  : input.id === '11111111-1111-4111-8111-111111111111' ? JSON.stringify({ title: '10.21 Reading', text: '<content>Read a book. **Useful notes.**</content>' })
  : '# Weekly reflection\n\nA good week for walking.' }] }));
server.registerTool('notion-get-self', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ workspace: { id: 'fixture-workspace', name: 'Test workspace' } }) }] }));
server.registerTool('notion-search', { inputSchema: { query: z.string(), filters: z.record(z.unknown()), page_size: z.number() } }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ results: [
  { id: '11111111-1111-4111-8111-111111111111', title: '10.21 Reading', timestamp: '2026-10-21T01:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'October', timestamp: '2026-10-21T01:00:00Z' },
] }) }] }));
server.registerTool('notion-calendar-list-calendars', { inputSchema: {} }, async () => process.env.FIXTURE_CALENDAR_UNLINKED === '1'
  ? { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'calendar_connection_required' }) }] }
  : { content: [{ type: 'text', text: JSON.stringify({ calendars: [{ accountId: 'fixture-google', calendarId: 'primary' }] }) }] });
server.registerTool('notion-calendar-list-events', { inputSchema: { timeMin: z.string(), timeMax: z.string(), timeZone: z.string() } }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ events: [
  { eventId: 'walk-1', title: 'Morning walk', calendar: { accountId: 'fixture-google', calendarId: 'primary' }, period: { type: 'DATE_TIME', start: { dateTime: '2026-10-21T08:00:00+08:00' }, end: { dateTime: '2026-10-21T08:30:00+08:00' } } },
] }) }] }));
server.registerTool('dangerous-write', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: 'must not run' }] }));
await server.connect(new StdioServerTransport());
