# OpenLoci

[English](README.md) · [简体中文](README.zh-CN.md)

OpenLoci is an open-source personal memory system for people and their AI assistants. It brings calendars, daily journals, meals, exercise, expenses, and travel plans into a user-owned Markdown vault, with readable HTML views and efficient search.

The goal is to help an assistant understand a person's life over time: what happened, what they ate, how they exercised, what they thought, what they spent, and what they intend to do next. Suggestions should use relevant evidence, respect privacy, and distinguish recorded facts from interpretations.

## Project goals

- **Own your memory.** Keep primary records in portable Markdown files that remain useful without OpenLoci or any particular model provider.
- **Capture with little friction.** Support quick manual entries, direct file edits, and imports from external services through multiple MCP connections.
- **Understand time.** Connect planned events, completed activities, reflections, and changing preferences across days, months, and years.
- **Retrieve efficiently.** Combine structured filters, full-text search, and optional semantic retrieval to provide a small, relevant context to an LLM.
- **Make records useful to people.** Render the same records as a calendar, daily journal, activity timeline, and domain-specific HTML pages.
- **Keep the user in control.** Make access permissions, automated imports, inferred memories, and external changes explicit and reversible where possible.

## Run v0.1

Requires Node.js 24 or newer.

```sh
npm ci
cp .env.example .env
npm run cli -- init
npm run dev
```

Open `http://127.0.0.1:4310`. The default private vault is `~/.local/share/openloci/vault`; set `OPENLOCI_VAULT` in `.env` to change it. The six domain workspaces provide a tabbed journal editor with `/` commands, week/month calendar, photo meal diary, health dashboard, monthly finances and budgets, and map-based travel plans. Their forms save portable Markdown; SQLite/PostgreSQL powers queries. The underlying API retains all eight record types.

Use the language selector at the top of any page to switch between **English, 简体中文, 日本語, and Español**. The initial language follows your browser preference; an explicit selection is remembered in a local cookie. Search filters and original note content are preserved. Direct links also support `?lang=zh-CN`, `?lang=ja`, and `?lang=es`.

Select **+ More** in the sidebar to create a custom page with a title, description, and **Notes**, **Checklist**, or **Table** layout. Page definitions live in `pages/<id>.md`; their entries remain ordinary Markdown records with a `page_id` link. Completed checklist items are saved with revision checks.

For compiled execution, run `npm run build` followed by `npm start`. Validate with `npm run check` and `npm test`. PostgreSQL integration tests additionally require a disposable `TEST_DATABASE_URL`; they write records into that database.

## Domain workspaces

- **Journal:** multiple tabs, Markdown blocks, headings and todos through `/`, autosave and revision checks.
- **Calendar:** Google Calendar-inspired week/month views; click a half-hour slot to create events, tasks or meetings. Entries are local; no invitations are sent.
- **Meals:** upload a photo, review food and optional calorie estimates, and add a linked OpenLoci calendar event. Recognition uses an OpenAI-compatible endpoint with your own URL, API token and model ID.
- **Exercise:** Apple Health-inspired activity rings, steps, heart rate and workouts; import CSV, JSON or Apple Health XML with source selection.
- **Expenses:** monthly income/expenses, budget, categories, transactions and history; CSV/JSON import with preview and deduplication. Currencies are kept separate.
- **Travel:** map and itinerary by date/city/place, map pins, and reviewable email paste/`.eml` import. Automatic mailbox reception requires a separately configured bridge.

Profile and Memories are removed from default navigation; existing records remain available through the API and original files. Journal is raw writing, Profile is confirmed facts/preferences, and Memory is a longer-term fact with provenance. See [workspace behavior, data formats and model/email setup](docs/domain-workspaces.md).

## Local and cloud databases

SQLite is the default database, with full-text search and date/type indexes. The database contains full record projections, including Markdown bodies and structured metadata. Markdown files remain the authority and allow a database rebuild.

Set `DATABASE_URL` to a PostgreSQL connection URL to select the PostgreSQL adapter. To copy an existing SQLite vault to an empty PostgreSQL database:

```sh
# Stop application writers first. Keep DATABASE_URL unset for this SQLite source.
export TARGET_DATABASE_URL='postgresql://user:password@host:5432/openloci'
npm run cli -- db:transfer
npm run cli -- db:transfer --apply
# Then set DATABASE_URL in your private .env and restart the app.
```

The transfer previews the record count, copies in a PostgreSQL transaction, and verifies complete records before committing. It preserves the source. Use TLS settings required by your cloud provider; certificate verification is never disabled by application code. Database transfer does not upload the vault or attachments. See [database operations](docs/database.md).

## Connect Notion and Google Calendar

The sidebar now has **Import from Notion** and **Import from Google Calendar** buttons. Choose a date range, complete browser sign-in if needed, review and select records, then import. The Google button reads calendars linked under **Notion → Settings → Account → Mail & Calendar**. It gives connection instructions when that link is missing. No CLI is needed for this browser flow.

Notion's date-based preview uses creation dates and excludes pages that contain only navigation links. Older pages edited in the chosen range can be absent; batch limits, failed reads, and truncated pages produce visible warnings. Previews expire after 30 minutes or a server restart. Existing local edits are preserved when remote changes conflict.

For explicit CLI connections and the standalone community Calendar server:

```sh
npm run cli -- mcp:init
npm run cli -- mcp:status
npm run cli -- mcp:connect notion
# Set GOOGLE_OAUTH_CREDENTIALS in .env to your Google desktop OAuth JSON path.
npm run cli -- mcp:connect google-calendar
```

Notion uses its hosted MCP endpoint through an OAuth bridge. Google Calendar uses the community `@cocal/google-calendar-mcp` server and needs a Google Cloud project with Calendar API enabled and desktop OAuth credentials. Each account requires your browser authorization. Configured servers and authenticated connections are different states; no account is connected merely by installing this project.

Imports are explicit, read-only toward external services, and preview by default. [Integration setup](docs/integrations.md) includes credentials, sign-in, import examples, and tool allowlists.

Google's official remote MCP server has a separate optional setup helper: `npm run cli -- mcp:google /absolute/path/to/web-client.json`. See [official Google setup and the Notion calendar alternative](docs/integrations.md#official-google-calendar-mcp).

OpenLoci also supplies its own read-only stdio MCP server: run `npm run mcp`, or configure an assistant to run `node /absolute/path/to/OpenLoci/dist/mcp-server.js` after building. Set its working directory or environment so it reads the intended vault settings. It exposes `memory_search`, `memory_get`, and byte-budgeted `memory_context`, excluding restricted records. `OPENLOCI_MCP_WRITE=1` explicitly enables capture.

## Initial scope

The first release targets one user and one local vault. It includes calendar events, daily journals, meal records, exercise records, expense records, travel plans, and explicit profile facts or preferences. Local capture, browsing, and ordinary search work without an LLM or an internet connection.

Cloud synchronization, collaboration, autonomous purchases or bookings, medical diagnosis, and financial advice are outside the initial scope. OpenLoci can record information and support suggestions without promising these capabilities.

## Architecture overview

Browser pages, a CLI, an HTTP API, and an MCP server use the same application services. Those services validate records, write Markdown, maintain derived indexes, and assemble permission-filtered context. An integration manager connects to multiple external MCP servers and normalizes their data into the same record model.

Markdown is authoritative. SQLite indexes, embeddings, summaries, and rendered HTML are derived data that can be regenerated. An LLM is an optional consumer and enrichment provider; it does not own the storage format or bypass application rules.

## Design documents

- [Domain workspaces and setup](docs/domain-workspaces.md): editors, imports, photo recognition, maps and email reception.
- [Architecture and basic framework](docs/architecture.md): components, proposed stack, package boundaries, workflows, and reliability.
- [Record format and memory model](docs/data-model.md): vault layout, metadata, domain fields, time, provenance, and deletion.
- [MCP integrations](docs/mcp.md): multiple external servers, permissions, synchronization, and the OpenLoci MCP interface.
- [Implementation roadmap](docs/roadmap.md): delivery stages, acceptance criteria, and performance targets.
- [Database operations](docs/database.md): SQLite, PostgreSQL transfer, backups, and cloud deployment boundaries.
- [Integration setup](docs/integrations.md): working MCP configuration and import commands.
- [Example meal record](examples/vault/records/meal/2026/10/meal-example.md): a fictional record showing the proposed format.

## Current status

Version 0.1 implements local capture and revision-checked editing through the API/CLI, SQLite and PostgreSQL storage adapters, full-text and filtered queries, HTML timelines and record pages, file-change reconciliation, assistant MCP reads, and explicit Notion/Google Calendar MCP imports. Notion page bodies retain the MCP fetch representation; they are not guaranteed to be a lossless native Notion export.

The application is a single-user local prototype. Tenant isolation, hosted authentication, semantic search, reviewed AI suggestions, scheduled imports, direct Gmail reception, remote deletion handling, and bidirectional sync remain planned. The journal editor and email parser support a basic subset; they are not complete Notion/HealthKit/email-provider implementations. Use one writer process per vault; the UI server is local and has no account authentication. PostgreSQL support provides a commercial deployment foundation, not a production multi-tenant service.

An open-source license must be selected and added before the first code release.
