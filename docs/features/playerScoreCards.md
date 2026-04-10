# Player Score Cards

This document explains how player score cards are rendered and updated in the OSRS Clan Hub app.

## What the feature does

Player score cards are the primary clan dashboard view. For each player in the selected clan, a card shows:

- rank within the current clan (by total level),
- player name,
- sync status / last updated timestamp,
- editable player status message,
- total level,
- per-skill levels with XP progress bars.

Cards are shown in the **Player cards** tab (`#clan-panel-cards`) and rendered into `#skill-cards`.

## Main files involved

- Frontend logic: `web/app.js`
- Player cards tab markup: `web/index.html`
- Styling: `web/styles.css` (`.player-skill-card*`)
- API + data sanitization: `backend/server.js`

## Data model used by cards

Each card is built from a `Player` object in `state.players`:

- `name`: OSRS username
- `message`: free-text status shown/edited on card
- `updatedAt`: ISO timestamp for last successful hiscore sync
- `totalLevel`: total level (from hiscores `overall`)
- `skills`: map of skill key -> level
- `skillsXp`: map of skill key -> XP
- `fetchStatus` (UI-only): transient sync state (`loading`, `ok`, `error`)

The frontend can hold temporary UI-only fields (`fetchStatus`), while persisted data is normalized server-side.

## Rendering flow

Cards are rendered by `renderSkillCards()`:

1. Clears `#skill-cards`.
2. If no clan or no players exist, shows an empty-state message.
3. Sorts players by `totalLevel` descending to produce rank display (`#1`, `#2`, ...).
4. Builds one `.player-skill-card` per player.
5. Appends card elements:
   - status strip (label + textarea),
   - header (rank, name, status line, total pill, sync button),
   - skill meters area.

Rank is visual only and recalculated from the current in-memory state each render.

## Status message handling

Each card has a `textarea` bound to `player.message`:

- On `change`, message is trimmed and capped to 240 chars.
- The player entry in `state.players` is updated.
- `saveState()` is called to persist via `PUT /api/clans/:id`.
- If save fails, current state is still written to local backup (`localStorage`).

This means status updates are intended to be persisted remotely, with local fallback if the API is unavailable.

## Hiscore sync handling

### Single player sync

Clicking a card's **Sync** button calls `refreshPlayer(index)`:

1. Sets `fetchStatus = "loading"` and re-renders (`Syncing...` in UI).
2. Calls `/api/hiscores?player=<name>` (frontend `fetchHiscores`).
3. Parses OSRS CSV (`parseHiscoresCsv`) using ordered skill lines.
4. Updates:
   - `totalLevel` from `overall`,
   - `skills`,
   - `skillsXp`,
   - `updatedAt` to current timestamp,
   - `fetchStatus = "ok"`.
5. Persists entire clan state with `saveState()`.
6. On any fetch/save failure, sets `fetchStatus = "error"` and writes local fallback cache.
7. Re-renders the cards.

### Refresh all

The **Refresh All Hiscores** button runs `refreshAllPlayers()`, which syncs players sequentially (`await` inside loop), one card at a time.

## Skill display details

- Skill keys come from `skillsOrder`.
- Card meters use `SKILL_KEYS = skillsOrder` without `overall`.
- If no skill data exists for a player, card shows "Sync hiscores to load per-skill levels."
- For each skill row:
  - label is formatted (`formatSkillName`),
  - level uses `player.skills[skill]`,
  - progress fill is based on XP clamped to `MAX_SKILL_XP` (`13034431`).

Progress bars visualize XP toward the max cap, not next-level XP.

## Persistence and fallback behavior

- Primary persistence: `PUT /api/clans/:id` with full clan payload (`name`, `players`, `bounties`).
- Local backup key: `osrs-clan-hub-clan-backup`.
- Selected clan key: `osrs-clan-hub-selected-clan-id`.
- On clan load failure, app can hydrate from local backup for the same clan id.

This gives the cards an offline/degraded-mode path where recent data remains visible.

## Server responsibilities relevant to cards

`backend/server.js` sanitizes incoming player data:

- trims/caps `name` and `message`,
- coerces numeric fields (`totalLevel`, `skills`, `skillsXp`),
- normalizes timestamps to strings/null,
- enforces uniqueness and player-count limits.

The hiscore endpoint proxies OSRS hiscores and returns CSV used by card sync parsing.

## UX notes and limits

- Maximum players per clan: 5 (cards render at most 5 players).
- Card order is dynamic by current `totalLevel`.
- Sync status text:
  - loading -> `Syncing...`
  - error -> `Could not fetch hiscores`
  - success with timestamp -> `Updated <local time>`
  - never synced -> `Not synced yet - use Sync`

These behaviors are implemented entirely in the frontend render cycle and refresh helpers.
