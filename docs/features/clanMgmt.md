# Clan Management

This document describes how Clan Management works in the OSRS Clan Hub app.

## What the feature does

Clan Management is the entry point for all clan-scoped features. It lets users:

- view available clans in a dropdown,
- create a new clan with up to 5 members,
- select the active clan,
- load and persist the selected clan's full state (`name`, `players`, `bounties`),
- recover from API failures using local backup data.

The selected clan drives the rest of the dashboard (members list, score cards, highscores table, bounty board).

## Main files involved

- Frontend logic: `web/app.js`
- API routes + sanitization + persistence: `backend/server.js`
- Shared constraints and model reference: `docs/dataModel.md`

## Core frontend state and storage keys

The client keeps one active clan in memory:

- `state.id`
- `state.name`
- `state.players`
- `state.bounties`

Related local storage keys:

- `osrs-clan-hub-selected-clan-id`: currently selected clan id.
- `osrs-clan-hub-clan-backup`: local fallback copy of the selected clan payload.
- `osrs-clan-hub-acting-as:<clanId>`: per-clan acting member used by bounty actions.

## Boot and initial clan selection flow

On startup (`boot()` in `web/app.js`):

1. `fetchClanList()` requests `GET /api/clans`.
2. The app reads the saved selected clan id from `osrs-clan-hub-selected-clan-id`.
3. It picks the initial clan:
   - stored id if it still exists in the fetched list,
   - otherwise the first clan in the sorted list,
   - otherwise no clan is selected.
4. If a clan is picked, `selectClanById(pick, { refreshHiscores: true })` loads it and triggers player hiscore refresh.
5. If none exist, state resets to an empty clan and the UI shows empty-state messaging.

## Clan list and dropdown behavior

`renderClanSelect()` rebuilds the clan dropdown from `clanList`:

- adds a placeholder option,
- shows either "Select a clan..." or "No clans yet - use New clan",
- renders each clan by `id` and display `name`,
- keeps value only if the current id is still valid.

`clanList` entries use the list-item shape returned by `GET /api/clans`:

- `id`
- `name`
- `playerCount`

The helper `upsertClanListFromDetail()` keeps a newly created/updated clan present in the dropdown even if list refetch is delayed or fails.

## Selecting and loading a clan

When the dropdown changes:

1. `persistSelectedClanId(id)` updates in-memory `selectedClanId` and local storage.
2. `loadClanDetail(id)` fetches `GET /api/clans/:id`.
3. On success, response is normalized into local `state` and written to backup storage.
4. On fetch failure, client attempts fallback from `osrs-clan-hub-clan-backup`:
   - if cached `clanId` matches requested id, cached data is loaded,
   - otherwise state falls back to an empty shell for that id.
5. `render()` updates all clan-dependent UI sections.

Optional `refreshHiscores: true` then calls `refreshAllPlayers()` to synchronize player stats after selection.

## Creating a new clan

The New Clan flow is managed by the modal (`initNewClanModal()`):

1. User opens modal with `#btn-new-clan`.
2. `initNewClanPlayerGrid()` builds exactly 5 name inputs (max roster size).
3. On submit:
   - clan name is trimmed and capped to 40 chars; empty names are rejected client-side,
   - player names are normalized (`trim`, collapse spaces, max 12 chars),
   - duplicate names are deduplicated client-side (case-sensitive set at this stage),
   - roster is capped to 5 and transformed into player objects with default stats.
4. Client sends `POST /api/clans` with `{ name, players }`.
5. On success:
   - created clan is upserted into `clanList`,
   - list is refetched (`fetchClanList()`),
   - created clan id is persisted as selected,
   - local state switches to returned clan payload,
   - local backup is written,
   - UI re-renders and optionally runs `refreshAllPlayers()` if roster is not empty.
6. On failure:
   - inline modal error is shown from API error payload when available,
   - submit button is re-enabled,
   - modal remains open for correction/retry.

## Saving clan changes

All clan mutations eventually persist through `saveState()`:

- endpoint: `PUT /api/clans/:id`
- payload: full clan document `{ name, players, bounties }`
- behavior: server returns the sanitized saved clan, which replaces local state

If save fails:

- callers catch and write local backup (`osrs-clan-hub-clan-backup`),
- UI continues using in-memory state for degraded/offline continuity.

This "full document write" model means writes are last-write-wins at the clan document level.

## Server API behavior relevant to clan management

`backend/server.js` provides and enforces the clan management contract:

- `GET /api/clans`
  - returns all clans as `{ id, name, playerCount }`,
  - sorted by name (case-insensitive).
- `GET /api/clans/:id`
  - validates UUID id format,
  - returns full clan (`id`, `name`, `players`, `bounties`),
  - returns `404` if not found.
- `POST /api/clans`
  - requires non-empty clan name,
  - ignores incoming bounties on create (`bounties: []` enforced),
  - creates UUID id server-side.
- `PUT /api/clans/:id`
  - validates id and existence,
  - sanitizes incoming payload,
  - allows empty incoming name only by falling back to existing stored name.

All routes depend on MongoDB availability (`MONGODB_URI`), returning a `503` configuration error when the database is not configured.

## Validation and sanitization rules

Server-side sanitization (`sanitizeState`, `sanitizeClanBody`, `sanitizeBounties`) guarantees consistent persisted data:

- clan name trimmed, max 40 chars,
- max 5 players,
- player names normalized and deduplicated case-insensitively,
- player message max 240 chars,
- numeric player fields coerced (`totalLevel`, skill values, XP values),
- max 80 bounties,
- bounty state and roster references normalized/validated.

Because server sanitization is authoritative, client-generated payloads can be permissive while stored data remains normalized.

## Legacy migration and backward compatibility

The server includes one-time safe migration logic from legacy single-clan storage (`clanState` singleton) into the `clans` collection:

- migration runs lazily on clan route access,
- migration failures are logged but do not block normal clan listing/loading.

Deprecated legacy endpoints (`/api/clan`) are still present for compatibility, but the app's clan management flow uses `/api/clans` routes.

## UI output tied to clan management

After clan load/select/create, `render()` updates:

- clan dropdown (`#clan-select`),
- members list (`#clan-members-list`),
- clan title (`#clan-title`),
- player cards (`#skill-cards`),
- clan highscores table (`#clan-highscores-root`),
- bounty board (`#bounty-mount`).

This keeps all dashboard panels synchronized to a single selected clan context.

## Current limitations

- No in-place edit/delete for existing clans.
- No roster editor for an existing clan in the current UI (roster is effectively set at creation unless changed indirectly via other flows that persist full state).
- No optimistic concurrency/versioning; concurrent edits can overwrite one another.
- Local backup stores one selected clan snapshot, not a full offline cache of all clans.
