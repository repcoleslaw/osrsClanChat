# Existing Data Model

This document describes the persisted and in-memory data model used by the OSRS Clan Hub app.

## Overview

The app centers around one main aggregate:

- **Clan**: contains clan metadata, a fixed-size list of players, and the clan bounty board.

Data appears in three layers:

- **MongoDB storage** (`clans` collection)
- **API payloads** (`/api/clans` endpoints)
- **Frontend state + local backup** (browser `localStorage`)

The shapes are intentionally very similar, with light name mapping and sanitization.

## Core Entities

### Clan

Canonical API shape:

```json
{
  "id": "uuid",
  "name": "Eggbois",
  "players": [/* Player */],
  "bounties": [/* Bounty */]
}
```

Storage shape in MongoDB (`clans` collection):

```json
{
  "_id": "uuid",
  "name": "Eggbois",
  "players": [/* Player */],
  "bounties": [/* Bounty */]
}
```

Legacy single-clan payloads still exist on deprecated routes:

```json
{
  "clanName": "Eggbois",
  "players": [/* Player */],
  "bounties": [/* Bounty */]
}
```

#### Clan constraints

- `name`: trimmed string, max **40** characters.
- `players`: array capped at **5** members.
- `bounties`: array capped at **80** items.

### Player

```json
{
  "name": "iaRralco",
  "message": "Current status message",
  "updatedAt": "2026-04-09T00:29:14.565Z",
  "totalLevel": 1836,
  "skills": {
    "overall": 1836,
    "attack": 85
  },
  "skillsXp": {
    "overall": 171234567,
    "attack": 3250000
  }
}
```

#### Player constraints and behavior

- `name`
  - normalized whitespace and trimmed;
  - max **12** chars;
  - unique per clan (case-insensitive uniqueness enforcement).
- `message`: trimmed string, max **240** chars.
- `updatedAt`: nullable string timestamp.
- `totalLevel`: number (defaults to `0` if invalid).
- `skills`: object map of skill key -> numeric level.
- `skillsXp`: object map of skill key -> numeric XP.

Skill keys used in UI:

- `overall`, `attack`, `defence`, `strength`, `hitpoints`, `ranged`, `prayer`, `magic`, `cooking`, `woodcutting`, `fletching`, `fishing`, `firemaking`, `crafting`, `smithing`, `mining`, `herblore`, `agility`, `thieving`, `slayer`, `farming`, `runecraft`, `hunter`, `construction`, `sailing`

Notes:

- Hiscore parsing populates `skills` and `skillsXp` from OSRS CSV lines.
- UI progress bars clamp XP using `MAX_SKILL_XP = 13034431`.

### Bounty

```json
{
  "id": "42b42efb-af0e-4c75-9191-dcc2d4358039",
  "title": "Need Sharks",
  "description": "Need 1k sharks",
  "requester": "iaRralco",
  "owner": null,
  "state": "open",
  "createdAt": "2026-04-09T00:06:15.720Z",
  "updatedAt": "2026-04-09T00:06:15.720Z"
}
```

#### Bounty constraints and state rules

- `id`: UUID string; generated if missing/invalid.
- `title`: trimmed string, required, max **200** chars.
- `description`: trimmed string, max **2000** chars.
- `requester`: required player name that must exist in clan roster.
- `owner`: nullable player name; if present must exist in clan roster.
- `state`: enum of:
  - `open`
  - `in_progress`
  - `closed`
- `createdAt` / `updatedAt`: string timestamps.

State normalization rules:

- `inprogress` is normalized to `in_progress`.
- Invalid states default to `open`.
- If state is `open`, `owner` is forced to `null`.
- If state is `in_progress` but `owner` is missing, bounty is reset to `open`.

## Relationships

- A clan has many players (max 5).
- A clan has many bounties (max 80).
- `bounty.requester` references a player by name.
- `bounty.owner` optionally references a player by name.
- Referential integrity is soft-enforced during server sanitization by checking names against current clan player names.

## API Shapes

### List clans

`GET /api/clans`

Response:

```json
{
  "clans": [
    { "id": "uuid", "name": "Eggbois", "playerCount": 5 }
  ]
}
```

### Clan detail

`GET /api/clans/:id`

Returns full `Clan` shape.

### Create clan

`POST /api/clans`

Body:

```json
{
  "name": "Clan Name",
  "players": [/* Player-like objects (name required) */]
}
```

Server behavior:

- Clan name required.
- Incoming `bounties` ignored on create (created as empty array).
- Server sanitizes all player fields and enforces max counts.

### Update clan

`PUT /api/clans/:id`

Body:

```json
{
  "name": "Clan Name",
  "players": [/* Player */],
  "bounties": [/* Bounty */]
}
```

Server behavior:

- Full-document replace after sanitization.
- Empty `name` falls back to the existing clan name.

## Frontend Local Cache Model

Saved under `localStorage` key `osrs-clan-hub-clan-backup`:

```json
{
  "clanId": "uuid",
  "name": "Eggbois",
  "players": [/* Player */],
  "bounties": [/* Bounty */]
}
```

Other related local keys:

- `osrs-clan-hub-selected-clan-id`: selected clan id.
- `osrs-clan-hub-acting-as:<clanId>`: selected acting member for bounty interactions.

## Validation & Sanitization Summary

All clan writes are sanitized server-side before persistence:

- trims strings and caps length;
- coerces numerics for skill/level fields;
- deduplicates player names case-insensitively;
- enforces max player and bounty limits;
- validates bounty requester/owner against current roster;
- normalizes bounty lifecycle state.

This means client and local-cache data can be permissive, but persisted data is normalized into a consistent model.

# Proposed Changes

## User Model

The application needs to manage User Sessions. When a user 