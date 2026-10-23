# OpenLoci connection and import setup

## Browser imports

Use the sidebar's **Import from Notion** or **Import from Google Calendar** actions. The browser flow enables the required read tools in the private Notion configuration and can start browser OAuth when authorization is missing. It uses the same MCP client and vault services as CLI imports. Google Calendar imports in this flow use Notion's linked calendar accounts, independently of the optional official Google preview connector.

Preview requests accept a source and inclusive local dates for at most 93 days. Notion search is bounded to 50 candidate pages created in the range; it fetches their content and skips pure navigation pages. Dated titles determine journal dates, with source activity timestamps as a fallback. This is not an exhaustive search of older pages edited recently. Calendar boundaries are computed in the vault timezone, including daylight-saving changes. Unrecognized event formats and partial reads do not silently become a successful complete import.

The browser shows source limits, failed reads, and truncation warnings. The user chooses records before applying. Server-held previews are bounded, expire after 30 minutes, and are lost on restart; source records remain unchanged. Saving goes through deterministic import IDs and local-edit conflict checks. A failed subset can be retried without duplicating successful records.

## Initialize private configuration

Run `npm run cli -- mcp:init`. It writes `<vault>/.openloci/mcp.json` with Notion and Google Calendar entries disabled and never overwrites an existing config. Set `OPENLOCI_MCP_CONFIG` to use another private path. Configuration is loaded at process startup; restart the web app after edits or sign-in.

`mcp:status` only reports configuration and clients connected in the current process. CLI connections close when the command exits; tokens persist so subsequent commands can authenticate again. An enabled entry does not mean authorization was verified.

## Notion

Run `npm run cli -- mcp:connect notion` to enable the entry and start OAuth through the installed, pinned `mcp-remote` bridge. Approve access in your browser. The configuration points to the [official Notion hosted MCP endpoint](https://developers.notion.com/guides/mcp/build-mcp-client). The [bridge](https://github.com/punkpeye/mcp-remote) stores auth state under the vault's private `.openloci/notion-auth/` directory. Protect that directory as credentials.

OpenLoci allows only `notion-search` and `notion-fetch` by default. `npm run cli -- mcp:tools notion` discovers the available schemas and labels allowed tools. Only explicitly allowlisted tools can be called. If a workspace exposes different tool names, review them before changing the configuration.

Create a private JSON options file outside the source checkout:

```json
{
  "account": "my-notion-workspace",
  "page": "https://www.notion.so/My-page-aaaaaaaabbbbccccddddeeeeeeeeeeee",
  "title": "Daily reflection",
  "date": "2026-10-23",
  "apply": false
}
```

Run `npm run cli -- import:notion /absolute/path/to/options.json`. Inspect the preview, then set `apply` to `true` to save. Import one selected page at a time. The page ID is canonicalized for deduplication; choose a stable account label per workspace. The body preserves the MCP fetch representation, including structured text wrappers when present. This version does not recursively traverse pages or download attachments. The saved record is a journal, with the user supplying its title and local grouping date.

## Google Calendar through the community server

This integration uses the community-maintained [Google Calendar MCP server](https://github.com/nspady/google-calendar-mcp), pinned to `@cocal/google-calendar-mcp@2.7.0`. It is separate from Google's own services and SDKs. Configure its prerequisites using its setup guide: create a Google Cloud project, enable Calendar API, configure consent/test users as applicable, and download desktop OAuth credentials.

Save the file outside the repository and set `GOOGLE_OAUTH_CREDENTIALS=/absolute/path/to/gcp-oauth.keys.json` in private `.env`. Run `npm run cli -- mcp:connect google-calendar`; complete any first-run sign-in. If explicit initial authentication is needed, run:

```sh
GOOGLE_OAUTH_CREDENTIALS=/absolute/path/to/gcp-oauth.keys.json \
GOOGLE_CALENDAR_MCP_TOKEN_PATH=/absolute/path/to/private/google-tokens.json \
npx --yes @cocal/google-calendar-mcp@2.7.0 auth
```

Use the token path written into your private MCP config so authentication is shared with OpenLoci. OpenLoci's default allowlist contains only `list-calendars`, `list-events`, and `get-event`; the upstream server's OAuth grant may permit more operations than this application allowlist. Review provider consent accordingly.

Create a private import options file:

```json
{
  "account": "personal",
  "calendarId": "primary",
  "timeMin": "2026-10-23T00:00:00+08:00",
  "timeMax": "2026-10-30T00:00:00+08:00",
  "apply": false
}
```

Use the exact account nickname configured in the upstream server; `personal` here is an example. Discover calendar IDs with `list-calendars`. Run `npm run cli -- import:calendar /absolute/path/to/options.json`. Inspect the preview and set `apply` to `true` to save. Each import covers one explicit account/calendar and at most 93 days; the upstream server performs event listing. Partial account failures are rejected. All-day exclusive end dates and timed occurrence IDs are preserved. The first version stores returned occurrences, not a complete locally expandable recurrence engine.

## Official Google Calendar MCP

Google's [official setup guide](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server) lists a remote server at `https://calendarmcp.googleapis.com/mcp/v1`. It requires Developer Preview enrollment, a Cloud project with `calendar-json.googleapis.com` and `calendarmcp.googleapis.com` enabled, and an OAuth client configured for an AI-powered agent. The guide provides read scopes for calendar lists, events, and availability.

OpenLoci's optional helper uses a **Web application** OAuth client with the authorized redirect URI `http://localhost:4311/oauth/callback`. Download that client's JSON, then run:

```sh
npm run cli -- mcp:google /absolute/path/to/web-client.json
npm run cli -- mcp:connect google-calendar-official
npm run cli -- mcp:tools google-calendar-official
```

The helper validates the callback, keeps client credentials in private files, preserves other configured servers, and requests only the read scopes. Connection uses the pinned OAuth bridge with offline access for refresh tokens. It never prints the client secret or embeds it in subprocess arguments. A successful helper run means **configured**, not authenticated or preview-approved.

Once authorized, inspect the discovered input schemas and use `mcp:call google-calendar-official TOOL arguments.json` for allowed read tools. Official-server event normalization and pagination are not implemented by `import:calendar`, which still targets the community server. The official setup helper has local configuration tests; live Google verification requires an eligible project and user authorization.

## Google Calendar through Notion

An existing Notion MCP authorization can also read calendars linked to that Notion account. In Notion's workspace menu, open **Settings → Account → Mail & Calendar → Connected calendars**, then connect your Google account or link your existing Notion Calendar account. See [Notion's settings instructions](https://www.notion.com/help/manage-email-and-calendar-settings).

Allowlist only `notion-calendar-list-calendars` and `notion-calendar-list-events` in the private Notion entry before calling them. Discover their schemas with `mcp:tools notion`. This route uses Notion's Google authorization and does not use your standalone Google Cloud OAuth client. A working Notion notes connection does not establish calendar access: verify the calendar list first, then read a bounded time range.

## Conflict and privacy behavior

Both import paths use deterministic IDs derived from the server, account, and remote object identity. Repeated imports do not duplicate records. A saved import fingerprint detects local changes to synchronized fields: unchanged remote data leaves local edits intact; simultaneous local and remote changes return a conflict. Independent tags and other local metadata are preserved on updates.

Calendar batch imports report per-record failures and may save other successful records. Retry is safe for already saved records. There are no scheduled sync cursors, external writes, or remote-deletion propagation in v0.1. Imported content remains untrusted text and cannot grant tool access.

Local subprocesses receive a small environment allowlist plus explicitly configured variables. Database credentials are not automatically inherited. Do not grant untrusted local programs access merely because they speak MCP. HTTP servers can be configured with a token environment variable and must use HTTPS except on loopback; built-in Notion uses the OAuth bridge instead.
