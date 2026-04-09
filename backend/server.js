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
const LEGACY_STATE_ID = "singleton";
const CLANS_COLLECTION = "clans";

const defaultState = {
  clanName: "",
  players: [],
  bounties: []
};

/** @type {MongoClient | null} */
let mongoClient = null;

/** @type {Promise<void> | null} */
let migrationPromise = null;

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
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, OPTIONS");
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
  const clanName = String(input?.clanName ?? input?.name ?? "").trim().slice(0, 40);
  const incomingPlayers = Array.isArray(input?.players) ? input.players : [];
  const unique = [];
  const seen = new Set();

  for (const player of incomingPlayers) {
    const normalizedName = cleanName(typeof player === "string" ? player : player?.name);
    const key = normalizedName.toLowerCase();
    if (!normalizedName || seen.has(key)) continue;
    seen.add(key);

    const p = typeof player === "object" && player ? player : {};
    unique.push({
      name: normalizedName,
      message: String(p?.message || "").trim().slice(0, 240),
      updatedAt: p?.updatedAt ? String(p.updatedAt) : null,
      totalLevel: Number(p?.totalLevel) || 0,
      skills: typeof p?.skills === "object" && p?.skills ? p.skills : {}
    });

    if (unique.length >= MAX_PLAYERS) break;
  }

  const bounties = sanitizeBounties(input?.bounties, unique.map((p) => p.name));

  return { clanName, players: unique, bounties };
}

function clanDocFromSanitized(safe) {
  return {
    name: safe.clanName,
    players: safe.players,
    bounties: safe.bounties
  };
}

function sanitizeClanBody(body, options = {}) {
  const { emptyNameOk = false } = options;
  const safe = sanitizeState({
    clanName: body?.name ?? body?.clanName ?? "",
    players: body?.players,
    bounties: body?.bounties
  });
  if (!emptyNameOk && !safe.clanName.trim()) {
    return null;
  }
  return clanDocFromSanitized(safe);
}

async function migrateLegacySingletonIfNeeded(db) {
  const clans = db.collection(CLANS_COLLECTION);
  const n = await clans.countDocuments();
  if (n > 0) return;

  const legacy = await db.collection("clanState").findOne({ _id: LEGACY_STATE_ID });
  if (!legacy) return;

  const { _id: _drop, ...rest } = legacy;
  const safe = sanitizeState(rest);
  if (!safe.clanName && safe.players.length === 0 && safe.bounties.length === 0) return;

  const doc = { _id: randomUUID(), ...clanDocFromSanitized(safe) };
  await clans.insertOne(doc);
}

async function ensureMigrated(db) {
  if (!migrationPromise) {
    migrationPromise = migrateLegacySingletonIfNeeded(db).catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  await migrationPromise;
}

function clanToListItem(doc) {
  return {
    id: doc._id,
    name: doc.name || "",
    playerCount: Array.isArray(doc.players) ? doc.players.length : 0
  };
}

function clanToApi(doc) {
  return {
    id: doc._id,
    name: doc.name || "",
    players: Array.isArray(doc.players) ? doc.players : [],
    bounties: Array.isArray(doc.bounties) ? doc.bounties : []
  };
}

app.get("/api/clans", async (_req, res) => {
  try {
    const db = await getDb();
    await ensureMigrated(db);
    const docs = await db.collection(CLANS_COLLECTION).find({}).sort({ name: 1 }).toArray();
    res.json({ clans: docs.map(clanToListItem) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load clans" });
  }
});

app.get("/api/clans/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid clan id" });
      return;
    }
    const db = await getDb();
    await ensureMigrated(db);
    const doc = await db.collection(CLANS_COLLECTION).findOne({ _id: id });
    if (!doc) {
      res.status(404).json({ error: "Clan not found" });
      return;
    }
    res.json(clanToApi(doc));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load clan" });
  }
});

app.post("/api/clans", async (req, res) => {
  try {
    const db = await getDb();
    await ensureMigrated(db);
    const sanitized = sanitizeClanBody(
      { ...req.body, bounties: [] },
      { emptyNameOk: false }
    );
    if (!sanitized || !sanitized.name.trim()) {
      res.status(400).json({ error: "Clan name is required" });
      return;
    }
    const id = randomUUID();
    const doc = { _id: id, ...sanitized };
    await db.collection(CLANS_COLLECTION).insertOne(doc);
    res.status(201).json(clanToApi(doc));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create clan" });
  }
});

app.put("/api/clans/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid clan id" });
      return;
    }
    const db = await getDb();
    await ensureMigrated(db);
    const existing = await db.collection(CLANS_COLLECTION).findOne({ _id: id });
    if (!existing) {
      res.status(404).json({ error: "Clan not found" });
      return;
    }
    const sanitized = sanitizeClanBody(req.body, { emptyNameOk: true });
    if (!sanitized) {
      res.status(400).json({ error: "Invalid clan data" });
      return;
    }
    if (!sanitized.name.trim()) {
      sanitized.name = existing.name || "";
    }
    const doc = { _id: id, ...sanitized };
    await db.collection(CLANS_COLLECTION).replaceOne({ _id: id }, doc);
    res.json(clanToApi(doc));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save clan" });
  }
});

/** @deprecated Legacy single-clan routes; prefer /api/clans */
app.get("/api/clan", async (_req, res) => {
  try {
    const db = await getDb();
    await ensureMigrated(db);
    const docs = await db.collection(CLANS_COLLECTION).find({}).sort({ name: 1 }).limit(1).toArray();
    if (!docs.length) {
      res.json({ clanName: "", players: [], bounties: [] });
      return;
    }
    const c = clanToApi(docs[0]);
    res.json({ clanName: c.name, players: c.players, bounties: c.bounties });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load clan data" });
  }
});

app.put("/api/clan", async (req, res) => {
  try {
    const db = await getDb();
    await ensureMigrated(db);
    const col = db.collection(CLANS_COLLECTION);
    const docs = await col.find({}).sort({ name: 1 }).limit(1).toArray();
    const safe = sanitizeState(req.body || {});
    const payload = clanDocFromSanitized(safe);
    if (!docs.length) {
      const id = randomUUID();
      await col.insertOne({ _id: id, ...payload });
      res.json({ clanName: payload.name, players: payload.players, bounties: payload.bounties });
      return;
    }
    const id = docs[0]._id;
    await col.replaceOne({ _id: id }, { _id: id, ...payload });
    res.json({ clanName: payload.name, players: payload.players, bounties: payload.bounties });
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
