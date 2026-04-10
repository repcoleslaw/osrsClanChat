# Bounty Board

This document describes how the clan bounty board works in the OSRS Clan Hub app.

## What the feature does

The bounty board lets clan members create and manage shared tasks ("bounties") inside the active clan:

- create a new bounty as a selected clan member,
- claim open bounties,
- mark in-progress bounties complete,
- view closed bounties in a collapsible history section.

The board is rendered in the **Clan Bounty Board** panel (`#bounty-mount`) on the dashboard.

## Main files involved

- Frontend logic: `web/app.js`
- Bounty board layout + modal markup: `web/index.html`
- Styling: `web/styles.css` (`.bounty-*` classes)
- Server sanitization and persistence: `backend/server.js`

## Bounty data model

Each bounty stored in `state.bounties` (and persisted to `/api/clans/:id`) uses:

- `id`: UUID string
- `title`: short task title
- `description`: task details
- `requester`: player name who requested it
- `owner`: player name who has claimed it, or `null`
- `state`: `open` | `in_progress` | `closed`
- `createdAt`: ISO timestamp string
- `updatedAt`: ISO timestamp string

Related client keys in local storage:

- `osrs-clan-hub-acting-as:<clanId>`: selected acting member for bounty actions
- `osrs-clan-hub-clan-backup`: fallback copy of clan data (`players`, `bounties`, etc.)

## Rendering flow

`renderBountyBoard()` rebuilds the board from current in-memory state:

1. Shows an empty-state message if no clan is selected.
2. Shows an empty-state message if the selected clan has no members.
3. Renders toolbar controls:
   - **You are** dropdown (acting member),
   - **+** button to create a bounty.
4. Renders active bounties (`open` and `in_progress`) sorted by:
   - state order (`open` first, then `in_progress`),
   - then `createdAt` ascending.
5. Renders closed bounties in a `<details>` section sorted by `updatedAt` descending.

Active bounty cards are rendered by `renderBountyCard(b)` with:

- title + state badge,
- description,
- requester/owner meta,
- context-sensitive action buttons.

## Acting member ("You are")

All write actions depend on the acting member selected in the toolbar:

- The dropdown options come from current clan `players`.
- Selection is persisted per clan id in local storage.
- If stored acting member is no longer in the current roster, selection is cleared.
- The `+` create button is disabled until a valid acting member is selected.

Helper behavior:

- `getActingAs()` reads from local storage.
- `setActingAs(name)` writes/clears local storage.
- `actingMemberValid()` checks selected name exists in `state.players`.

## Creating a bounty

The `+` button opens the bounty modal (`#bounty-modal`) only when `actingMemberValid()` is true.

Modal submit flow (`initBountyModal()`):

1. Validate acting member.
2. Read and trim title/description.
3. Require both title and description (empty values are rejected client-side).
4. Create bounty object with:
   - `id = crypto.randomUUID()`,
   - `requester = acting member`,
   - `owner = null`,
   - `state = "open"`,
   - `createdAt` and `updatedAt = now`.
5. Push to `state.bounties`.
6. Persist with `persistBounties()` and re-render.

## State transitions and permissions

### `open` -> `in_progress` (Claim)

- Visible action: **Claim**
- Enabled only when acting member is valid.
- On click:
  - `owner` becomes acting member,
  - `state` becomes `in_progress`,
  - `updatedAt` set to now,
  - state is persisted.

### `in_progress` -> `closed` (Mark complete)

- Visible action: **Mark complete**
- Enabled only when acting member is either:
  - the bounty `owner`, or
  - the bounty `requester`.
- On click:
  - `state` becomes `closed`,
  - `updatedAt` set to now,
  - state is persisted.

### `closed`

- Closed bounties are hidden from active cards and shown in the closed history list.
- No reopen/edit action is currently implemented in the UI.

## Persistence and fallback behavior

All bounty mutations call `persistBounties()`:

- Primary path: `saveState()` -> `PUT /api/clans/:id` with full clan payload (`name`, `players`, `bounties`).
- On save failure:
  - write fallback data to `osrs-clan-hub-clan-backup`,
  - re-render so UI still reflects local in-memory state.

On clan load failure, the app can rehydrate from local backup if the cached `clanId` matches the selected clan id.

## Server-side validation and normalization

`backend/server.js` sanitizes all bounties on clan write:

- limits list to max 80 bounties,
- requires non-empty `title`,
- trims/caps:
  - `title` to 200 chars,
  - `description` to 2000 chars,
  - player names to 12 chars via `cleanName`,
- requires `requester` to exist in clan roster,
- requires `owner` (when present) to exist in clan roster,
- normalizes state values:
  - accepts `open`, `in_progress`, `closed`,
  - converts `inprogress` -> `in_progress`,
  - invalid values default to `open`,
- enforces state consistency:
  - `open` forces `owner = null`,
  - `in_progress` without owner is reset to `open`,
- fills missing/invalid `id` with a generated UUID,
- ensures `createdAt` / `updatedAt` are present string timestamps.

This keeps persisted bounty data consistent even if client-side data is stale or malformed.

## Current limitations

- No edit/delete bounty actions in UI.
- No manual "unclaim" or reopen action.
- No server-side optimistic concurrency/version checks (last write wins at clan document level).
- Closed history rows are condensed (title + owner/requester) rather than full card details.
