# OpenLoci implementation roadmap

Version 0.1 delivers an initial slice across stages 1–4: file persistence, SQLite/PostgreSQL repositories and transfer, CLI/API capture and updates, local HTML timelines and detail pages, full-text queries, file reconciliation, read-only assistant MCP, and explicit Notion/Google Calendar imports. The acceptance criteria below remain the target for completing each full stage. Advanced domain validation, calendar grids, reviewed memories, scheduled imports, and multi-user deployment are still pending.

## Stage 1 Portable storage and capture

Implement the core schemas, Markdown parser and serializer, vault repository, revision checks, and CLI capture/validate/export commands. Cover all initial record types, including expenses and travel. Select an open-source license and add contribution instructions before publishing code.

Acceptance: create and edit each type, preserve unknown fields and free-form prose, detect revision conflicts, and recover safely after an interrupted save. A restored vault preserves records, links, and attachments without relying on SQLite.

## Stage 2 Local browsing and search

Add SQLite projections, full-text search, file watching and reconciliation, the local HTTP API, and React pages for the calendar, daily timeline, journal, meals, exercise, expenses, and travel. Include capture forms and a Markdown editor.

Acceptance: manual file edits appear in views; malformed files produce visible errors; a full rebuild reproduces query results. Calendar tests cover all-day ranges, timezone changes, recurring exceptions, and planned versus completed activity. Rendering tests cover untrusted HTML and unsafe links.

## Stage 3 Assistant memory access

Implement scoped MCP reads and capture, retrieval with citation pointers and token budgets, deterministic aggregates, and optional model providers. Add summaries and candidate memory review after basic retrieval works. Semantic retrieval remains optional.

Acceptance: an assistant can answer “What did I eat and how much did I exercise last week?” with source records and stated coverage. Updating or deleting evidence invalidates stale summaries and removes old retrieval chunks. An unauthorized caller receives neither record content nor restricted snippets.

## Stage 4 Multiple MCP integrations

Implement the server registry, credentials references, capability approval, adapters, durable import jobs, and import conflict UI. Build one calendar adapter and one adapter from another domain against actual available servers or explicit development fixtures.

Acceptance: both integrations run independently; repeated imports do not duplicate records; one server's outage does not block the other; restart resumes safely; revoked credentials fail clearly; deleted imports do not reappear. External service writes remain disabled until a dedicated authorization flow exists.

## Stage 5 Suggestions and portability

Add reviewed long-term memories, weekly reflection pages, optional evidence-based suggestions, explicit static HTML exports, and backup/restore workflows. Suggestion examples include meal variety, exercise consistency, spending summaries, and travel schedule conflicts. Always show the supporting time window and distinguish incomplete logging from actual inactivity.

Acceptance: suggestions link to evidence, can be dismissed or corrected, and obey provider consent and record sensitivity. Export previews reveal exactly what will be included. Core capture and browsing still work with every model provider disabled.

## Performance targets

These are engineering targets to benchmark, not current measurements. Define reference hardware, filesystem, dataset, and query mix before assessing them.

- A vault with 100,000 records is the initial scale benchmark.
- Local durable capture should complete within 200 ms at p95, excluding indexing, attachments, and external calls.
- Indexed date/type and full-text queries should complete within 300 ms at p95 for a bounded first page.
- An ordinary file edit should become searchable within two seconds while the app is running.
- Local context assembly should complete within one second at p95, excluding external model and embedding requests, and must respect the caller's token budget.
- Re-index only changed content; a full rebuild must report progress and resume after interruption.

Evaluate retrieval quality with a consented or synthetic fixture set containing exact matches, paraphrases, time questions, missing observations, and conflicting preferences. Measure relevant-record recall, citation correctness, and structured aggregate accuracy alongside latency. Compare against date filters and full-text search before adding semantic complexity.

## Decisions deferred

Choose exact framework and dependency versions during implementation. Defer multi-user hosting, device synchronization, attachment OCR, vector storage implementation, and fully bidirectional service synchronization until the local storage and query path meet the acceptance criteria. These extensions must preserve Markdown portability and use the same authorization and provenance model.
