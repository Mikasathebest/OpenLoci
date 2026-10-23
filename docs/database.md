# OpenLoci database operations

## Storage ownership

Markdown files are authoritative records. The database stores a full query projection: IDs, type, date, title, body, metadata JSON, relative file paths, revision hashes, and import identity. SQLite is local by default; PostgreSQL is selectable with `DATABASE_URL`. Both adapters use parameterized queries, date/type indexes, schema version checks, and full-text indexes.

SQLite uses FTS5. PostgreSQL uses a GIN expression index and `simple` text-search configuration. Search matches terms rather than substrings; tokenization differs between engines and is not a multilingual semantic search implementation. Metadata is stored as JSON text for portable transfer; PostgreSQL JSON expressions can query it, but domain-specific JSON indexes are future work.

## Initialize and rebuild

`npm run cli -- init` initializes the vault and selected database. Startup reconciles the database with Markdown under `records/`. The web server watches that directory, debounces changes, and also reconciles every minute. `npm run cli -- rebuild` requests an explicit rebuild. Invalid or duplicate-ID records prevent a partial rebuild and are reported for correction.

Reconciliation updates projections in a transaction and removes projections whose files disappeared. Record moves preserve IDs. For v0.1 each database serves exactly one vault; sharing it between different vaults can remove the other vault's projections during reconciliation.

Application writes flush temporary files before renaming them and check revision hashes. API edits require `If-Match`. Prior revisions are retained under `.openloci/history/`; they contain private data and have no automatic expiry in this version. Indexing failures after a Markdown save report the saved ID and require a rebuild. The filesystem and database cannot commit atomically.

Run only one writing application process per vault. Stop the web server before running write-capable CLI or MCP processes. External editors can race with application writes despite revision checks; recover from retained history if necessary. Multi-process locking and multi-device conflict resolution are not implemented.

## Transfer SQLite to PostgreSQL

1. Back up the entire vault and stop all writers. Provision an empty PostgreSQL database and a database-scoped account with schema creation rights.
2. Keep `DATABASE_URL` unset so the source uses SQLite. Set `TARGET_DATABASE_URL` in the process environment to the PostgreSQL URL. `PGSSLROOTCERT` and provider URL settings control TLS; use the provider's required CA configuration.
3. Run `npm run cli -- db:transfer` to initialize the destination schema and preview the number of records. Preview can create tables and indexes but does not copy records.
4. Run `npm run cli -- db:transfer --apply`. Transfer refuses a nonempty destination, preserves the source, and verifies copied records and counts within a destination transaction. Failure rolls back copied rows. For an interrupted successful transfer, inspect the destination before repeating the command.
5. Set `DATABASE_URL` to the destination URL and restart. Keep `OPENLOCI_VAULT` pointing to the same files. Back up and retain the source until satisfied with the result.

Transfer is a maintenance operation, not a live replication stream. It does not move attachments, history, OAuth credentials, or filesystem content. To move the application host, securely transfer the vault separately and verify its contents before allowing startup reconciliation against the database. Starting with an empty vault against a populated database removes its record projections.

## Commercial deployment boundary

The adapter boundary allows managed PostgreSQL without rewriting capture or query services. Commercial hosting additionally needs tenant isolation in storage and queries, user authentication, access policies, durable shared/object storage for Markdown and attachments, encryption and secret management, migrations, backup restore drills, and deployment monitoring. The local HTTP server deliberately binds to loopback and rejects nonlocal hosts. It is not a hosted multi-user API.

The application does not disable certificate verification or automatically insert production credentials. Never put database URLs containing passwords in committed examples or logs.

## Verification

`TEST_DATABASE_URL` enables the PostgreSQL integration test; use a disposable empty database. The test exercises a real PostgreSQL connection, transfer preview and apply, exact record equivalence, full-text search, date filters, nonempty-target rejection, and transaction rollback. Ordinary tests use temporary SQLite vaults and do not require PostgreSQL.
