const express = require("express");
const path = require("node:path");
const { MongoClient } = require("mongodb");
const { randomUUID } = require("node:crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 5;
const MAX_BOUNTIES = 80;
const BOUNTY_TITLE_MAX = 200;
const BOUNTY_DESC_MAX = 2000;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "osrsclanhub";
const STATE_ID = "singleton";

const defaultState = {
  clanName: "",
  players: [],
  bounties: []
};

/** @type {MongoClient | null} */
let mongoClient = null;

async function getDb() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is not set");
  }
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
  }
  return mongoClient.db(MONGODB_DB);
}

app.use(express.json({ limit: "512kb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 12);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeBounties(rawBounties, playerNames) {
  const allowed = new Set(playerNames.map((n) => cleanName(n).toLowerCase()).filter(Boolean));
  const isAllowed = (n) => {
    const c = cleanName(n);
    return c && allowed.has(c.toLowerCase());
  };

  const list = Array.isArray(rawBounties) ? rawBounties : [];
  const out = [];

  for (const b of list) {
    if (out.length >= MAX_BOUNTIES) break;

    const id = typeof b?.id === "string" && UUID_RE.test(b.id) ? b.id : randomUUID();
    const title = String(b?.title || "").trim().slice(0, BOUNTY_TITLE_MAX);
    const description = String(b?.description || "").trim().slice(0, BOUNTY_DESC_MAX);
    const requester = cleanName(b?.requester);
    if (!title || !requester || !isAllowed(requester)) continue;

    let state = String(b?.state || "open").toLowerCase().replace(/\s+/g, "_");
    if (state === "inprogress") state = "in_progress";
    if (!["open", "in_progress", "closed"].includes(state)) state = "open";

    let owner = b?.owner ? cleanName(b.owner) : null;
    if (owner && !isAllowed(owner)) owner = null;

    if (state === "open") {
      owner = null;
    } else if (state === "in_progress") {
      if (!owner) {
        state = "open";
        owner = null;
      }
    } else if (state === "closed") {
      if (owner && !isAllowed(owner)) owner = null;
    }

    const createdAt = b?.createdAt ? String(b.createdAt) : new Date().toISOString();
    const updatedAt = b?.updatedAt ? String(b.updatedAt) : new Date().toISOString();

    out.push({
      id,
      title,
      description,
      requester,
      owner,
      state,
      createdAt,
      updatedAt
    });
  }

  return out;
}

function sanitizeState(input) {
  const clanName = String(input?.clanName || "").trim().slice(0, 40);
  const incomingPlayers = Array.isArray(input?.players) ? input.players : [];
  const unique = [];
  const seen = new Set();

  for (const player of incomingPlayers) {
    const normalizedName = cleanName(player?.name);
    const key = normalizedName.toLowerCase();
    if (!normalizedName || seen.has(key)) continue;
    seen.add(key);

    unique.push({
      name: normalizedName,
      message: String(player?.message || "").trim().slice(0, 240),
      updatedAt: player?.updatedAt ? String(player.updatedAt) : null,
      totalLevel: Number(player?.totalLevel) || 0,
      skills: typeof player?.skills === "object" && player?.skills ? player.skills : {}
    });

    if (unique.length >= MAX_PLAYERS) break;
  }

  const bounties = sanitizeBounties(input?.bounties, unique.map((p) => p.name));

  return { clanName, players: unique, bounties };
}

async function readState() {
  const db = await getDb();
  const doc = await db.collection("clanState").findOne({ _id: STATE_ID });
  if (!doc) {
    return sanitizeState({ ...defaultState });
  }
  const { _id: _drop, ...rest } = doc;
  return sanitizeState(rest);
}

async function writeState(input) {
  const safe = sanitizeState(input || {});
  const db = await getDb();
  await db.collection("clanState").updateOne({ _id: STATE_ID }, { $set: safe }, { upsert: true });
  return safe;
}

app.get("/api/clan", async (_req, res) => {
  try {
    const state = await readState();
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load clan data" });
  }
});

app.put("/api/clan", async (req, res) => {
  try {
    const saved = await writeState(req.body || {});
    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save clan data" });
  }
});

app.get("/api/hiscores", async (req, res) => {
  const player = cleanName(req.query.player || "");
  if (!player) {
    res.status(400).json({ error: "Missing or invalid player" });
    return;
  }

  const url = `https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws?player=${encodeURIComponent(player)}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "OSRS-ClanHub/1.0"
      }
    });

    if (!upstream.ok) {
      const status = upstream.status === 404 ? 404 : 502;
      res.status(status).json({ error: "Could not load hiscores for that player" });
      return;
    }

    const text = await upstream.text();
    res.type("text/plain").send(text);
  } catch {
    res.status(502).json({ error: "Hiscores service unreachable" });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    if (!MONGODB_URI) {
      res.status(503).json({ ok: false, error: "MONGODB_URI not configured" });
      return;
    }
    await getDb();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(503).json({ ok: false, error: "Database unreachable" });
  }
});

if (process.env.SERVE_STATIC === "1") {
  const webRoot = path.join(__dirname, "..", "web");
  app.use(express.static(webRoot));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webRoot, "index.html"));
  });
}

const server = app.listen(PORT, () => {
  console.log(`OSRS Clan Hub API at http://localhost:${PORT}`);
  if (!MONGODB_URI) {
    console.warn("Warning: MONGODB_URI is not set. API will error on clan routes.");
  }
  if (process.env.SERVE_STATIC === "1") {
    console.log("Serving static UI from ./web");
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other process or run with a different port, e.g.:\n` +
        `  $env:PORT=3001; npm start`
    );
    process.exit(1);
  }
  throw err;
});
