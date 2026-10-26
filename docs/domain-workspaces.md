# Domain workspaces

OpenLoci renders six distinct workspaces over the same Markdown record store. They use the existing SQLite/PostgreSQL projection, revision hashes, locale selector (English, Chinese, Japanese, Spanish), custom pages, and MCP import dialogs. No demonstration data is inserted into a private vault.

## Journal

`/?type=journal` provides a document list, multiple open tabs, a large title field, date, and a block editor. Type `/` at the start of a block for a new journal page, to-do, heading, subheading, bullet, quote, or divider. Enter creates a block. Ctrl/Cmd-S saves; edits also save after a short pause. Each document is stored as Markdown, not an opaque editor database.

Open tab IDs are remembered in local storage. Unsaved drafts are retained in session storage, including their revision hash; conflicting external edits cannot silently overwrite newer files. Browser drafts contain private note text and are retained until saved or the browser session ends. This is a basic Markdown editor, not a complete Notion block/export implementation. The document list follows the existing search/date filters and pagination; its default page size is 50.

## Calendar

`/?type=event` has week and month views. Click any half-hour slot to create a 30-minute event; use the form for a task or meeting, duration, location, and participant addresses. Click an existing event to edit with revision checking. Tasks can be marked complete. Dates and times use the vault timezone, including daylight-saving validation. All-day imports retain their exclusive end dates.

New entries and edits are saved **locally in OpenLoci**. Participant addresses are recorded; no meeting invitations are sent and no Google events are created by these forms. The sidebar Google import still reads the account connected through Notion, or a separately configured MCP server. Import and outbound synchronization are separate capabilities.

## Meals

`/?type=meal` groups a selected day into breakfast, lunch, dinner, and snacks. Upload JPEG, PNG, or WebP (8 MB maximum), enter or review the food name and optional estimated calories, then save. Original photos are stored under `attachments/media/`; Markdown records reference their IDs. The optional calendar checkbox creates a linked 30-minute local event. A failed calendar write is reported separately from the already-saved meal.

The recognition button sends the selected photo to the explicitly configured model only when clicked. Its output is editable and must be saved by the user. Calorie values are labeled estimates and are never inferred as medical facts. Without model credentials, photo upload and manual capture continue to work.

## Exercise

`/?type=exercise` uses activity rings, daily energy/exercise/stand metrics, steps, latest heart rate, a seven-day activity chart, and workouts. Ring display goals are 500 kcal, 30 minutes, and 12 hours; they are presentation references, not personalized health guidance. Unknown measurements remain blank instead of fabricated values.

Upload CSV, JSON, or an unzipped Apple Health `export.xml`, preview, optionally restrict dates, and confirm the import. Maximum file size is 15 MB and at most 5000 accepted records per batch. Unsupported units/rows are counted. XML external entities are rejected. Apple Health support includes workouts, steps, active energy (kcal or kJ), exercise time, heart rate, and stand hours; it is not a complete HealthKit data importer.

Choose one source device to view totals; watch and phone measurements are never combined automatically. Imported `AppleExerciseTime` takes precedence over workout durations for the exercise ring when available. This avoids counting the same movement twice across those categories. Overlapping samples within a single source are not medically reconciled. Manual workouts are also supported.

CSV columns: `id,date,title,activity,duration_minutes,calories,steps,distance_meters,source`. `duration_seconds` can replace minutes. JSON is an array of objects with the same keys. Dates use `YYYY-MM-DD`. [Download sample](../public/exercise-sample.csv).

## Expenses

`/?type=expense` shows monthly income, expenses and balance, then budget, category distribution, current transactions, and historical months. All records are included in the aggregate, independent of timeline pagination. Select a currency; different currencies are never converted or added together.

Amounts are stored as integer minor units using the currency's fraction digits (JPY has no decimal minor units). Negative expense amounts represent refunds. Budgets are separate from transactions; saving the same month/currency/category budget replaces it rather than accumulating duplicates. The basic budget button edits the `Total` category; multiple category budgets can be created through the same form.

Import CSV or JSON with `id,date,title,amount,currency,direction,category,source`. `amount_minor` can replace `amount`. Directions are `expense` or `income`. Common Chinese columns such as 日期、交易时间、交易对方、金额、收/支、交易分类 are recognized. This accepts clean exported rows, not arbitrary bank PDF statements or every provider's multi-line export headers. Reimporting an unchanged file is idempotent. Supply stable `id` and `source` columns to retain identity across changed exports. [Download sample](../public/expense-sample.csv).

## Travel

`/?type=travel` opens a Leaflet map alongside an itinerary ordered by date/time. Add city, attraction/hotel/airport, start time, and booking type; optional checkout/end dates are validated. Click the map to set exact coordinates, or edit an existing stop's latitude and longitude. A small set of city shortcuts adjusts the viewport without pretending to locate a specific attraction. No public geocoding service is called automatically.

The map loads tiles from OpenStreetMap only when viewed online, includes attribution, and does not bulk download or prefetch. Map requests disclose the viewed tile area and site origin to that provider. Leaflet assets are served locally. The map needs internet access; itinerary capture does not. A public deployment must use a tile provider appropriate to its traffic and follow the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

Paste a reservation email or upload `.eml` (2 MB maximum). The local parser handles explicitly labeled flight/hotel fields and ISO dates. Optional model extraction handles less structured messages. Review and fill unknown dates, city and places before saving. Extraction never automatically creates bookings, sends emails, or purchases travel.

### Model configuration

Use a private `.env` file:

```dotenv
OPENLOCI_AI_BASE_URL=https://your-service.example/v1
OPENLOCI_AI_MODEL=your-model-id
OPENLOCI_AI_API_KEY=your-private-key
# Or keep the key in a private file containing only its value:
# OPENLOCI_AI_API_KEY_FILE=/absolute/path/to/private-key.txt
```

Use any OpenAI-compatible Chat Completions service. Configure its URL, API token and model ID yourself; OpenLoci has no built-in provider or model. The URL may be a base `/v1` URL or the full `/v1/chat/completions` endpoint. Requests use `Authorization: Bearer <token>`, a `model` field and standard system/user `messages`. Text input uses a string; photo input uses text plus an `image_url` data URL. Responses are read from `choices[0].message.content` and parsed as JSON. For photo recognition, choose a model that supports image input. Authentication, model access and image support must be verified with your chosen service. See the [official request/response format](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

The reusable TypeScript interface is `RecognitionConfig` and `recognizeWith(config, prompt, image?)` in `src/integrations/recognition.ts`. Applications can pass configuration directly; OpenLoci reads it from the private environment variables above. Existing HTTP interfaces remain `POST /api/domain/photos/recognize` with `{id}` and `POST /api/domain/travel/parse-email` with `{content, use_model: true}`. They return validated food/reservation JSON for review, without exposing the configured token to the browser.

Remote endpoints require HTTPS and an API key; a localhost development model may omit the key. Restart the server after editing environment configuration. Provider calls have a timeout and do not overwrite the source on failure. Only explicit recognition actions send data. Text extraction and photo recognition use the same configured model in this initial implementation.

### Receiving forwarded email

An email address alone does not authorize reading its inbox. Gmail OAuth/IMAP polling and hosted SMTP reception are not yet implemented. Manual `.eml` and paste import work now.

A mail bridge can deliver a received message to the local, token-protected endpoint:

```http
POST /api/inbound/travel-email
Content-Type: application/json
Authorization: Bearer <OPENLOCI_MAIL_WEBHOOK_TOKEN>

{"filename":"reservation.eml","content":"From: ...\r\nSubject: ...\r\n\r\n..."}
```

Set `OPENLOCI_MAIL_WEBHOOK_TOKEN` and `OPENLOCI_TRAVEL_FORWARD_ADDRESS` only after configuring a real receiver/bridge. The server remains bound to loopback and requires a localhost Host; an external mail provider cannot call it directly. Use a trusted local bridge that reads an already authorized mailbox and posts locally. Do not expose the unauthenticated application to the internet. Received text is retained privately under `inbox/travel/` and appears in the travel email review dialog; no itinerary is created until reviewed and saved. The receiver does not implement provider-signature verification or retry deduplication; the bridge should do so.

## Profile and Memories

Journal holds original chronological writing. Profile represents confirmed facts/preferences; Memory represents derived or explicitly saved long-term facts with provenance. Those concepts remain in the storage/API schema for compatibility, but **Profile and Memories no longer occupy default navigation or capture menus**. Existing records are preserved. Removing a sidebar item does not delete a person's data. A later reviewed memory-management interface can live under settings or custom pages.
