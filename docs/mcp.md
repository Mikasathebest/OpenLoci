# OpenLoci MCP integration framework

## Two integration directions

For executable v0.1 commands and the actual camelCase configuration format, use [connection and import setup](integrations.md). The following sections describe the broader target architecture; scheduled synchronization, remote deletions, and assistant updates are deferred. v0.1 implements bounded manual imports, read-only assistant tools, and optional assistant capture.

OpenLoci acts as an MCP host when connecting to external services, using an independent client for each configured server. It also exposes an MCP server so assistants can query and update a permitted part of the personal vault. These are separate trust boundaries and use separate credentials and policies.

The host/client/server relationship follows the [official MCP architecture](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/architecture/index.mdx). Implementation must pin a supported protocol revision and SDK and verify interoperability against that revision; proposed application contracts below are OpenLoci conventions, not MCP standards.

## Multiple external servers

Maintain a registry with a unique server ID, display name, transport configuration, credential reference, allowed capabilities, import scopes, adapter name, and synchronization settings. Support local process connections and remote HTTP connections through the selected SDK's supported transports. Enabling a local server means authorizing execution of its configured program; imported configuration must not launch programs automatically.

Typical adapters could import calendar events, wearable workouts, meal records, expense exports, or travel reservations. Availability depends on actual service APIs and usable MCP servers. Where no server exists, a separate adapter or MCP wrapper is needed; OpenLoci does not assume every service already supports MCP.

Server tools are discovered and namespaced internally by server ID. Approve capabilities explicitly rather than trusting tool names or descriptions. Capability changes after an upgrade require review before newly discovered tools become available. One unavailable server must not block local capture or healthy integrations.

## Example server configuration

This illustrative OpenLoci configuration is not an SDK configuration format:

```json
{
  "servers": [
    {
      "id": "calendar-personal",
      "transport": "stdio",
      "command": "/absolute/path/to/calendar-mcp-server",
      "args": [],
      "credential_ref": "keychain:openloci/calendar-personal",
      "adapter": "calendar",
      "allowed_tools": ["list_events"],
      "sync": { "direction": "import", "interval_minutes": 15 }
    },
    {
      "id": "fitness-personal",
      "transport": "http",
      "url": "https://fitness.example.invalid/mcp",
      "credential_ref": "keychain:openloci/fitness-personal",
      "adapter": "fitness",
      "allowed_tools": ["list_workouts"],
      "sync": { "direction": "import", "interval_minutes": 60 }
    }
  ]
}
```

The command, URL, adapter names, and tools are placeholders. Real connections require server-specific capability mapping and authentication. For remote HTTP authorization, follow the selected revision of the [MCP authorization specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx) and its [security considerations](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/security-considerations.mdx), including audience-bound credentials and protections against confused-deputy behavior. Never forward an assistant's OpenLoci token to a third-party service.

## Import workflow

1. Fetch a bounded page of remote objects using the adapter's durable cursor and authorized scope.
2. Validate payload size and shape, normalize timestamps and units, and retain remote identity and revision information.
3. Deduplicate by server, account, object, and occurrence ID. Check deletion tombstones before proposing new records.
4. Apply the configured import policy. Imports are read-only toward the external service by default; first import previews its scope before a user enables recurring imports.
5. Write accepted records through application services. Preserve local edits by comparing the last imported field values with current local and remote values; unresolved overlapping changes become reviewable conflicts.
6. Advance the cursor only after all preceding items are durably saved, skipped by policy, or recorded in a visible recoverable failure queue. Replay after a crash must be idempotent.

Use bounded concurrency, timeouts, backoff with jitter, and per-server rate limits. Isolate credentials, cursors, and failures per server/account. Disable retries for permanent authorization failures and show a reconnect action. A remote deletion is a proposed local change governed by policy, not an unconditional erasure of personal notes.

## Assistant facing interface

Expose a small initial set of proposed tools:

- `memory_search`: filtered search with pagination, excerpts, dates, and record IDs.
- `memory_get`: retrieve an authorized record and current revision.
- `memory_context`: assemble evidence and relevant preferences within a token budget.
- `record_create`: create a typed record with validated metadata and Markdown.
- `record_update`: apply a permitted patch using an expected revision hash.

Offer authorized records as read-only resources identified by stable URIs such as `openloci://records/<id>`. Resource reads enforce the same permissions as tools. Advertise features only when supported by the pinned protocol and SDK.

Start assistant connections with read access scoped to selected types and sensitivity levels. Grant capture separately from editing existing records. Keep deletion and execution of external service tools out of the initial assistant interface. Later external mutations require an explicit user-authorized workflow, exact target, preview, and audit record. An assistant's general permission to query memory does not authorize modifying a calendar or making a booking.

## Trust and audit

Treat remote text, Markdown, tool descriptions, and model output as untrusted data. Instructions found inside a meal note or imported reservation cannot grant permissions or trigger other tools. Avoid automatic forwarding of personal records from one server to another.

Audit entries record actor, server, tool, operation, affected IDs, outcome, and time while redacting content and credentials. Enforce permission checks before retrieval and again before returning resources or performing writes. Test multiple servers with overlapping tool names, revoked credentials, malformed payloads, partial failures, and changes to discovered capabilities.
