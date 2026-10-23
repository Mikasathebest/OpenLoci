# OpenLoci architecture and basic framework

## Design principles

OpenLoci is a local application with a browser interface and a portable Markdown vault. A modular monolith keeps the first implementation easy to run and debug while defining clear boundaries for storage, retrieval, integrations, and presentation. The initial deployment uses one application process and one background worker loop; it does not require a message broker, hosted database, or vector service.

Each user action and integration import follows the same validation and persistence path. Presentation and AI components consume records through application interfaces so that permissions, provenance, and revision checks apply consistently.

## Proposed technology choices

The v0.1 implementation uses TypeScript, Node.js 24, Express, SQLite FTS5, PostgreSQL GIN full-text search, YAML, and the MCP TypeScript SDK. HTML is rendered on the server with a small browser script; React is deferred until richer editors justify it. The current compact layout is `src/` with core, database, vault, application, HTTP, rendering, and integration modules, plus `tests/`. The package layout below remains a future extraction plan.

SQLite and PostgreSQL implement the same driver and record repository interfaces. Both hold complete record projections for efficient reads, while Markdown remains the authority. [Database operations](database.md) specifies transfer and recovery. Commercial multi-user deployment is a later layer, separate from this local implementation.

Use TypeScript across the application, a Node.js runtime, React for browser views, and an HTTP framework for the local API. Use a Markdown parser that exposes an abstract syntax tree and a YAML parser for frontmatter. Validate structured metadata against versioned schemas. Use SQLite with full-text indexing for local queries; semantic search is an optional later addition behind a provider interface.

Choose supported dependency versions and a compatible MCP SDK during implementation, then pin them in a lockfile. Keep domain logic independent of the web framework, model provider, and MCP transport.

## Component responsibilities

**Domain core** defines record types, schema versions, validation, time rules, links, and structured aggregates. It has no filesystem, network, or LLM dependencies.

**Vault storage** resolves IDs to paths, preserves Markdown content, performs revision-checked atomic writes, and handles attachments and file changes. It rejects path traversal and writes through symlinks outside the vault.

**Application services** implement capture, editing, deletion, calendar queries, importing, exporting, and context assembly. They coordinate storage and indexing and return consistent errors to every interface.

**Index and retrieval** maintain structured projections, full-text indexes, backlinks, source mappings, and optional embeddings. Queries apply caller permissions before ranking and assembling excerpts.

**Memory service** creates evidence-backed summaries and candidate long-term memories. Inferences carry source IDs and revisions; model-generated preferences require review before becoming confirmed profile facts.

**Integration manager** owns external MCP clients, server configuration, tool allowlists, credentials references, capability discovery, health reporting, and synchronization jobs. Service-specific adapters translate remote payloads into domain records.

**OpenLoci MCP server** exposes selected memory operations to external assistants. It delegates to application services and never grants unrestricted filesystem or connector access.

**Web interface** renders calendar, journal, meals, exercise, expenses, travel, and search pages. It supports editing Markdown and structured fields while showing import origin, indexing status, and inference status.

## Proposed repository layout

The following layout describes the implementation to build; these packages do not exist yet.

```text
apps/
  web/                  React views and accessible editors
  server/               Local HTTP API and background job runner
  cli/                  Capture, validate, rebuild, import, and export commands
packages/
  core/                 Domain types and validation schemas
  vault/                Markdown parsing and safe file persistence
  application/          Shared use cases and authorization
  index/                SQLite projections and full-text search
  retrieval/            Ranking and context budget management
  memory/               Summaries, evidence, and inferred memories
  integrations/         MCP client manager and service adapters
  mcp-server/           Assistant-facing tools and resources
  rendering/            Safe Markdown to HTML rendering
  providers/            Optional model and embedding adapters
docs/
examples/vault/
```

Packages depend inward on `core`; application services depend on abstract storage and provider contracts. Entry points supply concrete implementations. UI components do not import storage internals. The integration manager never calls an LLM to decide whether a remote operation is authorized.

## Basic application contracts

These illustrative contracts describe intended behavior rather than a published SDK:

```typescript
interface RecordService {
  create(input: NewRecord, actor: AccessContext): Promise<RecordRevision>;
  update(id: string, patch: RecordPatch, expectedHash: string,
         actor: AccessContext): Promise<RecordRevision>;
  get(id: string, actor: AccessContext): Promise<RecordRevision>;
  remove(id: string, expectedHash: string, actor: AccessContext): Promise<void>;
}

interface RetrievalService {
  search(query: MemoryQuery, actor: AccessContext): Promise<SearchPage>;
  context(query: ContextQuery, actor: AccessContext): Promise<ContextBundle>;
}

interface ImportAdapter {
  pull(cursor?: string): Promise<ImportBatch>;
  normalize(item: RemoteItem): Promise<RecordCandidate>;
}
```

`AccessContext` identifies a caller and its vault, record-type, sensitivity, and operation grants. `MemoryQuery` supports date ranges, types, tags, text, and pagination. `ContextQuery` adds an explicit output token budget. A `ContextBundle` includes excerpts, record IDs, source revisions, dates, and any truncation or coverage limits. Imports cannot directly write files: candidates pass through application services and import policy.

## Save and recovery workflow

1. Authenticate the caller where needed, check its grants, validate the record, and resolve its stable ID.
2. Serialize mutations through a vault writer. Compare the current file hash with the caller's expected revision; return a conflict on mismatch.
3. Write a temporary file in the destination directory, flush it, and atomically rename it into place. Preserve unknown frontmatter fields and unrelated Markdown sections.
4. Record a change job and project the committed file into SQLite. A response distinguishes a durable save from completed indexing.
5. Refresh affected views and invalidate summaries or embeddings tied to old content hashes.

Markdown and SQLite do not share a transaction. On startup, reconciliation compares files and hashes with indexed state and recovers missing projection jobs. File watchers improve responsiveness; periodic reconciliation covers missed events. Invalid external edits remain on disk and produce visible validation errors instead of silent overwrites. A just-saved record is readable directly from the vault even while search catches up.

Simultaneous writes through external editors cannot be made fully transactional with application writes. Detect changed hashes, retain a recoverable prior revision during replacement, and surface conflicts. Multi-device concurrent editing is deferred until an explicit conflict strategy exists.

## Retrieval and memory efficiency

Use structured filters first for dates, types, amounts, and activity attributes. Use full-text search for words and phrases. Add optional semantic candidates for questions whose wording differs from the saved text, then merge and rank candidates by relevance, time, and source quality. These ranking signals must not replace access checks.

Chunk content at meaningful headings or record boundaries. Cache embeddings by content hash, chunking version, and embedding model. Avoid re-embedding unchanged files. Keep time-window summaries with source revisions so edits invalidate only affected summaries.

Build LLM context progressively: relevant confirmed preferences, concise period summaries, then selected original excerpts. Enforce the requested token budget and include citation pointers. Do not send an entire vault by default. Arithmetic questions such as monthly spending use structured aggregation with explicit currency and coverage; they do not rely on an LLM adding retrieved snippets.

## HTML views

Provide calendar day/week/month views, a daily page combining planned and completed activities, a journal editor, and filtered domain timelines. Render semantic HTML with keyboard navigation and responsive layouts. Display dates in the chosen timezone while retaining the original event timezone.

Disable raw HTML by default, sanitize rendered output, block executable URL schemes, and constrain attachment paths. Imported Markdown is untrusted content. Remote images require an explicit loading policy because loading them can disclose browsing activity.

The local app serves authenticated interactive views; static HTML export is an explicit operation with a preview of included records and attachments. Private records must never be published automatically.

## Privacy and operations

Bind the local server to loopback by default. Enforce origin checks and CSRF protection for browser mutations; require authentication and TLS before enabling remote access. Keep secrets in an OS credential store or a dedicated secret backend, referenced by ID from configuration.

Markdown is plaintext unless the user protects the filesystem or backup destination. Keep the private vault outside the source checkout by default. Do not enable telemetry or external model requests implicitly. Logs record operation IDs and timings with content and credentials redacted.

Vault records and attachments are sufficient to restore user content. Back up configuration and deletion/sync state as well when continuing an integration after restore. Derived indexes are disposable. A database failure must not prevent reading or exporting original Markdown.
