# OpenLoci record format and memory model

## Vault organization

In v0.1 all active record types live under `records/<type>/YYYY/MM/<id>.md`, including profile and memory. The special top-level profile/memory locations below are a future organization option. Meal uploads currently use `attachments/media/<sha256>.<ext>` and travel email review uses private `inbox/travel/<id>.txt`. [Workspace field and import details](domain-workspaces.md) describe the implemented subset. Current `.openloci/` contains `index.sqlite` when using SQLite, revision `history/`, private `mcp.json`, and provider authentication files. Scheduled sync state, embeddings, and summary caches are not implemented yet. Back up the whole private vault, including hidden directories; do not publish it with the source code.

Use one Markdown file per record. Journal documents have independent IDs and may share a local date; meal, exercise, expense, and calendar entries remain separate records so imports and edits do not rewrite a large daily file. The daily HTML page composes them using indexed dates and links.

```text
vault/
  profile/                         Confirmed facts and preferences as Markdown
  records/
    journal/YYYY/MM/<id>.md
    event/YYYY/MM/<id>.md
    meal/YYYY/MM/<id>.md
    exercise/YYYY/MM/<id>.md
    expense/YYYY/MM/<id>.md
    travel/YYYY/MM/<id>.md
  memories/                        Reviewed or candidate inferences as Markdown
  attachments/<record-id>/          Receipts, photographs, and supporting files
  .openloci/
    config.json                    Vault settings and credential references
    state.sqlite                   Rebuildable indexes, jobs, and sync projections
    sync/                          Durable cursors and deletion tombstones
    cache/                         Disposable embeddings and HTML caches
```

Durable operational state in `sync/` prevents deleted imports from being resurrected; it is not a substitute for record content. Rebuilding indexes preserves this state. When sync state is lost, imports must reconcile with user review before restoring previously seen remote records. Backup tools should include hidden directories and attachments.

## Common record fields

Custom page definitions use a separate `pages/<uuid>.md` file: frontmatter contains `schema_version`, `id`, `title`, `layout` (`notes`, `checklist`, or `table`), and `created_at`; its Markdown body is the description. These definitions are read directly from the vault and do not appear as personal memory records. Ordinary records can carry a `page_id` UUID. SQLite and PostgreSQL index that association, and database transfer preserves it. Checklist completion is stored in the record's `attributes.completed` boolean. Include `pages/` when moving or backing up the vault.

Each file has YAML frontmatter followed by ordinary Markdown. The first schema uses these common fields:

- `schema_version`: integer format version, initially `1`.
- `id`: globally unique, immutable string generated on creation.
- `type`: `journal`, `event`, `meal`, `exercise`, `expense`, `travel`, `profile`, or `memory`.
- `title`: a short display title.
- `date`: quoted local calendar date used for day grouping.
- `timezone`: IANA timezone used to interpret the local date.
- `created_at` and `updated_at`: quoted RFC 3339 timestamps with explicit offsets.
- `visibility`: `private` by default, or `shareable`; shareable means eligible for explicit sharing, never automatically public.
- `sensitivity`: `standard` or `restricted`, checked independently of visibility.
- `tags`: optional list of user labels.
- `links`: optional list of related record IDs, independent of file paths.
- `source`: provenance, including `kind` (`manual`, `import`, or `generated`), adapter/server ID when relevant, and remote account/object identifiers for imports.
- `attributes`: type-specific structured fields.

Define required fields, enums, and constraints in versioned schemas during the first implementation stage. Unknown user fields must survive editing. An unsupported schema version can be displayed as raw Markdown but cannot be rewritten automatically. Application revision hashes are computed from file bytes, avoiding self-referential hashes in frontmatter.

Use record IDs for internal links and resolve them at render time. Files may move without breaking identity. Example files use readable IDs for illustration; production IDs should use a standard globally unique identifier generator.

## Domain attributes

**Journal:** `mood` and user-defined reflection fields are optional. Free-form thoughts belong in the body. Enforce one journal per local date and timezone grouping policy; detect duplicate journals during imports.

**Event:** `start_at`, `end_at`, `all_day`, `status`, and optional `location`. Timed events require timestamps with offsets. All-day events use `start_date` and an exclusive `end_date` instead. Preserve recurrence rules, series identity, and occurrence exceptions for imported recurring calendars; expand occurrences only within the requested time window.

**Meal:** `eaten_at`, `meal_type`, and `items`, with optional quantities, units, and nutrition values. Nutrition fields identify whether values were entered, imported, or estimated. Missing values stay unknown instead of becoming zero.

**Exercise:** `started_at`, `activity`, `duration_seconds`, and optional `distance_meters`, sets, repetitions, load, or heart-rate measurements. Preserve original units when converting values for display.

**Expense:** `spent_at`, `amount_minor` as an integer, `currency`, category, and optional merchant and receipt links. Validate currency minor-unit scale and the safe numeric range. Refunds use negative amounts. Report totals separately by currency unless an explicit exchange-rate source and conversion date are supplied.

**Travel:** `start_date`, `end_date`, destinations, booking status, and links to itinerary events and expenses. Travel end dates are inclusive, unlike calendar all-day event ranges. Detailed segments use timed event records with their own timezones. Plans remain distinct from completed trips.

**Profile:** `key`, a typed `value`, optional validity dates, and confirmation provenance. An explicit preference such as vegetarian meals differs from a pattern inferred from recent food records.

**Memory:** `status` (`candidate`, `confirmed`, `rejected`, or `stale`), `evidence` containing record IDs and revision hashes, optional confidence, validity dates, and model/provider metadata when generated. Rejected candidates remain excluded from retrieval; deletion removes their content according to policy.

## Time and uncertainty

Keep occurrence time separate from creation, import, and update time. For entries with only a known date, do not invent a precise timestamp. A traveler may record events in several timezones on the same day; queries state whether their date boundaries use the record timezone or the user's selected viewing timezone.

Use the `date` field as the canonical record grouping date, not the directory name. Keep planned, completed, canceled, and uncertain states explicit. Estimated calories, inferred preferences, and imported facts must remain distinguishable in both HTML and LLM context.

## Derived indexes

SQLite projects records, typed domain fields, tags, links, source mappings, full-text chunks, and content hashes. Optional embedding rows include model and chunking versions. Derived summaries are either disposable cache entries or visible generated Markdown memory records with provenance; neither silently replaces originals.

On every query, excluded or deleted records are removed before excerpts reach a model. A source edit marks dependent summaries and memories stale until recomputed or reviewed. Deleting evidence invalidates dependent conclusions and removes associated chunks, embeddings, and caches.

## Mutation and retention

Migrations are explicit, previewable, and backed up before changing user files. Writers preserve free-form text and unknown metadata. Import deduplication uses server, account, remote object, and occurrence identifiers rather than titles or timestamps alone.

Deletion removes active content and derived copies, then retains only minimal opaque synchronization identifiers needed to prevent re-import. The user can choose recoverable trash with a clear retention period or permanent deletion. Backups and external services have separate retention policies; local deletion does not claim to erase those copies.
