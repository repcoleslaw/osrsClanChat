const MAX_PLAYERS = 5;

const API_BASE =
  typeof window !== "undefined" && window.__API_BASE__ != null && String(window.__API_BASE__).trim() !== ""
    ? String(window.__API_BASE__).trim().replace(/\/$/, "")
    : "";

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

const emptyClanState = () => ({
  id: null,
  name: "",
  players: [],
  bounties: []
});

const ACTING_AS_KEY = "osrs-clan-hub-acting-as";
const LOCAL_CLAN_STATE_KEY = "osrs-clan-hub-clan-backup";
const SELECTED_CLAN_ID_KEY = "osrs-clan-hub-selected-clan-id";

function normalizePlayerName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 12);
}

function actingStorageKey() {
  const id = selectedClanId || state.id;
  return id ? `${ACTING_AS_KEY}:${id}` : ACTING_AS_KEY;
}

function readLocalClanState() {
  try {
    const raw = localStorage.getItem(LOCAL_CLAN_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const clanId = typeof parsed.clanId === "string" ? parsed.clanId : null;
    const nameRaw = parsed.name ?? parsed.clanName;
    const name = typeof nameRaw === "string" ? nameRaw.trim().slice(0, 40) : "";

    const players = [];
    if (Array.isArray(parsed.players)) {
      const seen = new Set();
      for (const p of parsed.players) {
        if (players.length >= MAX_PLAYERS) break;
        if (!p || typeof p.name !== "string") continue;
        const n = normalizePlayerName(p.name);
        if (!n) continue;
        const key = n.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        players.push({
          name: n,
          message: typeof p.message === "string" ? p.message.trim().slice(0, 240) : "",
          updatedAt: p.updatedAt != null ? String(p.updatedAt) : null,
          totalLevel: Number(p.totalLevel) || 0,
          skills: typeof p.skills === "object" && p.skills ? p.skills : {}
        });
      }
    }

    const bounties = [];
    if (Array.isArray(parsed.bounties)) {
      for (const b of parsed.bounties) {
        if (!b || typeof b !== "object") continue;
        let st = typeof b.state === "string" ? b.state.toLowerCase().replace(/\s+/g, "_") : "open";
        if (st === "inprogress") st = "in_progress";
        if (!["open", "in_progress", "closed"].includes(st)) st = "open";
        bounties.push({
          id: typeof b.id === "string" && b.id ? b.id : crypto.randomUUID(),
          title: typeof b.title === "string" ? b.title : "",
          description: typeof b.description === "string" ? b.description : "",
          requester: typeof b.requester === "string" ? normalizePlayerName(b.requester) : "",
          owner: b.owner && typeof b.owner === "string" ? normalizePlayerName(b.owner) : null,
          state: st,
          createdAt: b.createdAt != null ? String(b.createdAt) : new Date().toISOString(),
          updatedAt: b.updatedAt != null ? String(b.updatedAt) : new Date().toISOString()
        });
      }
    }

    return { clanId, name, players, bounties };
  } catch {
    return null;
  }
}

function writeLocalClanState(s) {
  try {
    const payload = {
      clanId: s.id,
      name: s.name || "",
      players: Array.isArray(s.players) ? s.players.slice(0, MAX_PLAYERS) : [],
      bounties: Array.isArray(s.bounties) ? s.bounties : []
    };
    localStorage.setItem(LOCAL_CLAN_STATE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

const skillsOrder = [
  "overall",
  "attack",
  "defence",
  "strength",
  "hitpoints",
  "ranged",
  "prayer",
  "magic",
  "cooking",
  "woodcutting",
  "fletching",
  "fishing",
  "firemaking",
  "crafting",
  "smithing",
  "mining",
  "herblore",
  "agility",
  "thieving",
  "slayer",
  "farming",
  "runecraft",
  "hunter",
  "construction"
];

/** Skills shown on each player card (excludes "overall" — total is shown in the card header). */
const SKILL_KEYS = skillsOrder.filter((k) => k !== "overall");

const clanSelect = document.getElementById("clan-select");
const clanMembersList = document.getElementById("clan-members-list");
const playerInputTemplate = document.getElementById("player-input-template");
const clanTitle = document.getElementById("clan-title");
const refreshAllBtn = document.getElementById("refresh-all");
const skillCards = document.getElementById("skill-cards");
const clanTabCards = document.getElementById("clan-tab-cards");
const clanTabHighscores = document.getElementById("clan-tab-highscores");
const clanPanelCards = document.getElementById("clan-panel-cards");
const clanPanelHighscores = document.getElementById("clan-panel-highscores");
const clanHighscoresRoot = document.getElementById("clan-highscores-root");
const pageDashboard = document.getElementById("page-dashboard");
const pageCalculators = document.getElementById("page-calculators");
const navLinks = document.querySelectorAll("[data-nav-page]");
const bountyMount = document.getElementById("bounty-mount");
const bountyModal = document.getElementById("bounty-modal");
const bountyModalTitleInput = document.getElementById("bounty-modal-title-input");
const bountyModalDescriptionInput = document.getElementById("bounty-modal-description");
const bountyModalAs = document.getElementById("bounty-modal-as");
const bountyModalSubmit = document.getElementById("bounty-modal-submit");
const bountyModalCancel = document.getElementById("bounty-modal-cancel");
const bountyModalX = document.getElementById("bounty-modal-x");

const btnNewClan = document.getElementById("btn-new-clan");
const newClanModal = document.getElementById("new-clan-modal");
const newClanNameInput = document.getElementById("new-clan-name");
const newClanPlayersGrid = document.getElementById("new-clan-players-grid");
const newClanSubmit = document.getElementById("new-clan-submit");
const newClanCancel = document.getElementById("new-clan-cancel");
const newClanModalX = document.getElementById("new-clan-modal-x");

/** @type {{ id: string, name: string, playerCount: number }[]} */
let clanList = [];
let selectedClanId = null;
let state = emptyClanState();

async function fetchClanList() {
  try {
    const response = await fetch(apiUrl("/api/clans"));
    if (!response.ok) throw new Error("Failed to list clans");
    const data = await response.json();
    clanList = Array.isArray(data.clans) ? data.clans : [];
  } catch {
    clanList = [];
  }
}

function persistSelectedClanId(id) {
  selectedClanId = id;
  try {
    if (id) localStorage.setItem(SELECTED_CLAN_ID_KEY, id);
    else localStorage.removeItem(SELECTED_CLAN_ID_KEY);
  } catch {
    /* ignore */
  }
}

async function loadClanDetail(id) {
  try {
    const response = await fetch(apiUrl(`/api/clans/${encodeURIComponent(id)}`));
    if (!response.ok) throw new Error("Failed to load clan");
    const data = await response.json();
    state = {
      id: data.id,
      name: data.name || "",
      players: Array.isArray(data.players) ? data.players.slice(0, MAX_PLAYERS) : [],
      bounties: Array.isArray(data.bounties) ? data.bounties : []
    };
    writeLocalClanState(state);
  } catch {
    const local = readLocalClanState();
    if (local && local.clanId === id) {
      state = {
        id: local.clanId,
        name: local.name,
        players: local.players,
        bounties: local.bounties
      };
    } else {
      state = { id, name: "", players: [], bounties: [] };
    }
  }
}

async function selectClanById(id, options = {}) {
  const { refreshHiscores = false } = options;
  if (!id) return;
  persistSelectedClanId(id);
  await loadClanDetail(id);
  render();
  if (refreshHiscores && state.players.length) {
    await refreshAllPlayers();
    render();
  }
}

async function saveState() {
  if (!state.id) {
    throw new Error("No clan selected");
  }
  const response = await fetch(apiUrl(`/api/clans/${encodeURIComponent(state.id)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: state.name,
      players: state.players,
      bounties: state.bounties
    })
  });
  if (!response.ok) {
    throw new Error("Failed to save clan data");
  }
  const saved = await response.json();
  state = {
    id: saved.id,
    name: saved.name || "",
    players: Array.isArray(saved.players) ? saved.players.slice(0, MAX_PLAYERS) : [],
    bounties: Array.isArray(saved.bounties) ? saved.bounties : []
  };
  writeLocalClanState(state);
  const idx = clanList.findIndex((c) => c.id === state.id);
  if (idx >= 0) {
    clanList[idx] = { id: state.id, name: state.name, playerCount: state.players.length };
  }
}

function initNewClanPlayerGrid() {
  if (!newClanPlayersGrid || !playerInputTemplate) return;
  newClanPlayersGrid.innerHTML = "";
  for (let i = 0; i < MAX_PLAYERS; i += 1) {
    const clone = playerInputTemplate.content.cloneNode(true);
    clone.querySelector(".index").textContent = String(i + 1);
    const input = clone.querySelector(".player-name");
    input.dataset.index = String(i);
    input.value = "";
    newClanPlayersGrid.appendChild(clone);
  }
}

function closeNewClanModal() {
  if (newClanModal && typeof newClanModal.close === "function" && newClanModal.open) {
    newClanModal.close();
  }
}

function openNewClanModal() {
  if (!newClanModal) return;
  if (newClanNameInput) newClanNameInput.value = "";
  initNewClanPlayerGrid();
  if (typeof newClanModal.showModal === "function") {
    newClanModal.showModal();
    newClanNameInput?.focus();
  }
}

function initNewClanModal() {
  if (!newClanModal) return;

  newClanModal.addEventListener("click", (e) => {
    if (e.target === newClanModal) closeNewClanModal();
  });
  newClanCancel?.addEventListener("click", () => closeNewClanModal());
  newClanModalX?.addEventListener("click", () => closeNewClanModal());

  btnNewClan?.addEventListener("click", () => openNewClanModal());

  newClanSubmit?.addEventListener("click", async () => {
    const clanName = (newClanNameInput?.value || "").trim().slice(0, 40);
    if (!clanName) return;
    const names = [...(newClanPlayersGrid?.querySelectorAll(".player-name") || [])]
      .map((input) => normalizePlayerName(input.value))
      .filter(Boolean);
    const uniqueNames = [...new Set(names)].slice(0, MAX_PLAYERS);
    const players = uniqueNames.map((name) => ({
      name,
      message: "",
      updatedAt: null,
      totalLevel: 0,
      skills: {}
    }));

    try {
      const response = await fetch(apiUrl("/api/clans"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: clanName, players })
      });
      if (!response.ok) throw new Error("Create failed");
      const created = await response.json();
      closeNewClanModal();
      await fetchClanList();
      persistSelectedClanId(created.id);
      state = {
        id: created.id,
        name: created.name || "",
        players: Array.isArray(created.players) ? created.players.slice(0, MAX_PLAYERS) : [],
        bounties: Array.isArray(created.bounties) ? created.bounties : []
      };
      writeLocalClanState(state);
      render();
      if (state.players.length) {
        await refreshAllPlayers();
        render();
      }
    } catch {
      /* keep modal open */
    }
  });
}

function formatSkillName(key) {
  const labels = {
    hitpoints: "Hitpoints",
    runecraft: "Runecraft"
  };
  return labels[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

function playerHasSkillData(player) {
  if (!player.skills || typeof player.skills !== "object") return false;
  return SKILL_KEYS.some((k) => Object.prototype.hasOwnProperty.call(player.skills, k));
}

function playerStatusLine(player) {
  if (player.fetchStatus === "error") return "Could not fetch hiscores";
  if (player.fetchStatus === "loading") return "Syncing…";
  if (player.updatedAt) return `Updated ${new Date(player.updatedAt).toLocaleString()}`;
  return "Not synced yet — use Sync";
}

function parseHiscoresCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const skills = {};

  for (let i = 0; i < skillsOrder.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const [, level] = line.split(",");
    skills[skillsOrder[i]] = Number(level) || 0;
  }

  return {
    totalLevel: skills.overall || 0,
    skills
  };
}

async function fetchHiscores(playerName) {
  const response = await fetch(
    apiUrl(`/api/hiscores?player=${encodeURIComponent(playerName)}`)
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch hiscores (${response.status})`);
  }
  const csv = await response.text();
  return parseHiscoresCsv(csv);
}

async function refreshPlayer(index) {
  const player = state.players[index];
  if (!player) return;

  player.fetchStatus = "loading";
  render();

  try {
    const data = await fetchHiscores(player.name);
    player.totalLevel = data.totalLevel;
    player.skills = data.skills;
    player.updatedAt = new Date().toISOString();
    player.fetchStatus = "ok";
  } catch {
    player.fetchStatus = "error";
  }

  try {
    await saveState();
  } catch {
    player.fetchStatus = "error";
    writeLocalClanState(state);
  }
  render();
}

async function refreshAllPlayers() {
  for (let i = 0; i < state.players.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await refreshPlayer(i);
  }
}

function renderClanTitle() {
  if (!clanTitle) return;
  clanTitle.textContent = state.name ? state.name : "Clan";
}

function ensureBounties() {
  if (!Array.isArray(state.bounties)) state.bounties = [];
}

function getActingAs() {
  try {
    return localStorage.getItem(actingStorageKey()) || "";
  } catch {
    return "";
  }
}

function setActingAs(name) {
  try {
    if (name) localStorage.setItem(actingStorageKey(), name);
    else localStorage.removeItem(actingStorageKey());
  } catch {
    /* ignore */
  }
}

function actingMemberValid() {
  const name = getActingAs();
  return Boolean(name && state.players.some((p) => p.name === name));
}

function bountyStateLabel(s) {
  if (s === "in_progress") return "In Progress";
  if (s === "closed") return "Closed";
  return "Open";
}

function sortActiveBounties(list) {
  const order = { open: 0, in_progress: 1 };
  return [...list].sort((a, b) => {
    const ao = order[a.state] ?? 9;
    const bo = order[b.state] ?? 9;
    if (ao !== bo) return ao - bo;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

async function persistBounties() {
  ensureBounties();
  try {
    await saveState();
  } catch {
    writeLocalClanState(state);
    render();
  }
}

function closeBountyModal() {
  if (bountyModal && typeof bountyModal.close === "function" && bountyModal.open) {
    bountyModal.close();
  }
}

function openBountyModal() {
  if (!bountyModal || !actingMemberValid()) return;
  const requester = getActingAs();
  if (bountyModalAs) bountyModalAs.textContent = `You are requesting as ${requester}.`;
  if (bountyModalTitleInput) bountyModalTitleInput.value = "";
  if (bountyModalDescriptionInput) bountyModalDescriptionInput.value = "";
  if (typeof bountyModal.showModal === "function") {
    bountyModal.showModal();
    bountyModalTitleInput?.focus();
  }
}

function initBountyModal() {
  if (!bountyModal) return;

  bountyModal.addEventListener("click", (e) => {
    if (e.target === bountyModal) closeBountyModal();
  });

  bountyModalCancel?.addEventListener("click", () => closeBountyModal());
  bountyModalX?.addEventListener("click", () => closeBountyModal());

  bountyModalSubmit?.addEventListener("click", async () => {
    if (!actingMemberValid()) return;
    const t = bountyModalTitleInput?.value.trim() || "";
    const d = bountyModalDescriptionInput?.value.trim() || "";
    if (!t || !d) return;
    const now = new Date().toISOString();
    const requester = getActingAs();
    ensureBounties();
    state.bounties.push({
      id: crypto.randomUUID(),
      title: t,
      description: d,
      requester,
      owner: null,
      state: "open",
      createdAt: now,
      updatedAt: now
    });
    closeBountyModal();
    await persistBounties();
    render();
  });
}

function renderClanSelect() {
  if (!clanSelect) return;
  const cur = selectedClanId || state.id || "";
  clanSelect.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = clanList.length ? "Select a clan…" : "No clans yet — use New clan";
  clanSelect.appendChild(ph);
  clanList.forEach((c) => {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.name?.trim() ? c.name : "(Unnamed)";
    clanSelect.appendChild(o);
  });
  const valid = cur && clanList.some((c) => c.id === cur);
  clanSelect.value = valid ? cur : "";
}

function renderClanMembersList() {
  if (!clanMembersList) return;
  clanMembersList.innerHTML = "";
  if (!state.id) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Select a clan to see its roster.";
    clanMembersList.appendChild(p);
    return;
  }
  if (!state.players.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "This clan has no members yet. Edit the roster in a future update, or recreate the clan with New clan.";
    clanMembersList.appendChild(p);
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "clan-members-list__items";
  state.players.forEach((pl) => {
    const li = document.createElement("li");
    li.textContent = pl.name;
    ul.appendChild(li);
  });
  clanMembersList.appendChild(ul);
}

function renderBountyBoard() {
  if (!bountyMount) return;
  bountyMount.innerHTML = "";
  ensureBounties();

  if (!state.id) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Select a clan to use the bounty board.";
    bountyMount.appendChild(p);
    return;
  }

  if (!state.players.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "This clan needs at least one member for the bounty board.";
    bountyMount.appendChild(p);
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "bounty-toolbar";

  const actingWrap = document.createElement("label");
  actingWrap.className = "bounty-acting";
  actingWrap.innerHTML = "<span>You are</span>";
  const actingSelect = document.createElement("select");
  actingSelect.className = "bounty-acting-select";
  actingSelect.setAttribute("aria-label", "Acting clan member");
  const optPlaceholder = document.createElement("option");
  optPlaceholder.value = "";
  optPlaceholder.textContent = "Select member…";
  actingSelect.appendChild(optPlaceholder);
  state.players.forEach((pl) => {
    const opt = document.createElement("option");
    opt.value = pl.name;
    opt.textContent = pl.name;
    actingSelect.appendChild(opt);
  });
  const stored = getActingAs();
  actingSelect.value = state.players.some((p) => p.name === stored) ? stored : "";
  if (!actingSelect.value) setActingAs("");
  actingSelect.addEventListener("change", () => {
    setActingAs(actingSelect.value);
    render();
  });
  actingWrap.appendChild(actingSelect);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "bounty-add-btn";
  addBtn.textContent = "+";
  addBtn.title = "New bounty";
  addBtn.disabled = !actingMemberValid();
  addBtn.addEventListener("click", () => {
    if (!actingMemberValid()) return;
    openBountyModal();
  });

  toolbar.append(actingWrap, addBtn);
  bountyMount.appendChild(toolbar);

  const activeList = state.bounties.filter((b) => b.state !== "closed");
  const sortedActive = sortActiveBounties(activeList);

  if (!sortedActive.length) {
    const empty = document.createElement("p");
    empty.className = "muted bounty-empty";
    empty.textContent = "No open bounties. Use + to add a task.";
    bountyMount.appendChild(empty);
  } else {
    const listEl = document.createElement("div");
    listEl.className = "bounty-list bounty-list--active";
    sortedActive.forEach((b) => {
      listEl.appendChild(renderBountyCard(b));
    });
    bountyMount.appendChild(listEl);
  }

  const closedList = state.bounties.filter((b) => b.state === "closed");
  closedList.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  const details = document.createElement("details");
  details.className = "bounty-closed-details";
  const summary = document.createElement("summary");
  summary.className = "bounty-closed-summary";
  summary.textContent = `Closed (${closedList.length})`;
  details.appendChild(summary);

  if (closedList.length === 0) {
    const none = document.createElement("p");
    none.className = "muted";
    none.style.margin = "8px 0 0";
    none.textContent = "No closed tasks yet.";
    details.appendChild(none);
  } else {
    const closedWrap = document.createElement("div");
    closedWrap.className = "bounty-list bounty-list--closed";
    closedList.forEach((b) => {
      const row = document.createElement("div");
      row.className = "bounty-closed-row";
      row.innerHTML = `<span class="bounty-closed-title">${escapeHtml(b.title)}</span><span class="muted">${escapeHtml(b.owner || "—")} · req ${escapeHtml(b.requester)}</span>`;
      closedWrap.appendChild(row);
    });
    details.appendChild(closedWrap);
  }

  bountyMount.appendChild(details);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBountyCard(b) {
  const acting = getActingAs();
  const card = document.createElement("article");
  card.className = "bounty-card";

  const head = document.createElement("div");
  head.className = "bounty-card__head";
  const h = document.createElement("h4");
  h.className = "bounty-card__title";
  h.textContent = b.title;
  const badge = document.createElement("span");
  badge.className = `bounty-state bounty-state--${b.state}`;
  badge.textContent = bountyStateLabel(b.state);
  head.append(h, badge);

  const desc = document.createElement("p");
  desc.className = "bounty-card__desc";
  desc.textContent = b.description;

  const meta = document.createElement("div");
  meta.className = "bounty-card__meta";
  meta.innerHTML = `<span><strong>Requester</strong> ${escapeHtml(b.requester)}</span><span><strong>Owner</strong> ${b.owner ? escapeHtml(b.owner) : "<em>Unassigned</em>"}</span>`;

  const actions = document.createElement("div");
  actions.className = "bounty-card__actions";

  if (b.state === "open") {
    const claim = document.createElement("button");
    claim.type = "button";
    claim.textContent = "Claim";
    claim.disabled = !actingMemberValid();
    claim.title = actingMemberValid() ? "Take ownership" : "Select who you are first";
    claim.addEventListener("click", async () => {
      if (!actingMemberValid()) return;
      const i = state.bounties.findIndex((x) => x.id === b.id);
      if (i < 0) return;
      state.bounties[i] = {
        ...state.bounties[i],
        owner: acting,
        state: "in_progress",
        updatedAt: new Date().toISOString()
      };
      await persistBounties();
      render();
    });
    actions.appendChild(claim);
  }

  if (b.state === "in_progress") {
    const complete = document.createElement("button");
    complete.type = "button";
    complete.textContent = "Mark complete";
    const canClose = acting && (acting === b.owner || acting === b.requester);
    complete.disabled = !canClose;
    complete.title = canClose ? "Close this bounty" : "Only the owner or requester can close";
    complete.addEventListener("click", async () => {
      if (!acting || (acting !== b.owner && acting !== b.requester)) return;
      const i = state.bounties.findIndex((x) => x.id === b.id);
      if (i < 0) return;
      state.bounties[i] = {
        ...state.bounties[i],
        state: "closed",
        updatedAt: new Date().toISOString()
      };
      await persistBounties();
      render();
    });
    actions.appendChild(complete);
  }

  card.append(head, desc, meta, actions);
  return card;
}

function renderSkillCards() {
  if (!skillCards) return;
  skillCards.innerHTML = "";

  if (!state.id || !state.players.length) {
    skillCards.innerHTML =
      '<p class="muted">Select a clan with at least one member to see player cards here.</p>';
    return;
  }

  const ranked = [...state.players].sort((a, b) => (b.totalLevel || 0) - (a.totalLevel || 0));

  ranked.forEach((player, rankIdx) => {
    const index = state.players.findIndex((p) => p.name === player.name);
    const card = document.createElement("article");
    card.className = "player-skill-card";

    const statusStrip = document.createElement("div");
    statusStrip.className = "player-skill-card__status-strip";
    const statusLabel = document.createElement("span");
    statusLabel.className = "player-skill-card__status-label";
    statusLabel.textContent = "Status";
    const statusInput = document.createElement("textarea");
    statusInput.className = "player-skill-card__status-input";
    statusInput.placeholder = "What are you working on in OSRS? Visible to the whole clan.";
    statusInput.value = player.message || "";
    statusInput.rows = 2;
    statusInput.addEventListener("change", () => {
      if (index < 0) return;
      state.players[index].message = statusInput.value.trim().slice(0, 240);
      saveState().catch(() => {
        writeLocalClanState(state);
      });
    });
    statusStrip.append(statusLabel, statusInput);

    const header = document.createElement("div");
    header.className = "player-skill-card__header";

    const titleBlock = document.createElement("div");
    const nameRow = document.createElement("div");
    nameRow.className = "player-skill-card__name-row";
    const rank = document.createElement("span");
    rank.className = "player-skill-card__rank";
    rank.textContent = `#${rankIdx + 1}`;
    const nameEl = document.createElement("h3");
    nameEl.className = "player-skill-card__name";
    nameEl.textContent = player.name;
    nameRow.append(rank, nameEl);

    const metaEl = document.createElement("p");
    metaEl.className = "status";
    metaEl.style.margin = "4px 0 0";
    metaEl.textContent = playerStatusLine(player);
    titleBlock.append(nameRow, metaEl);

    const actions = document.createElement("div");
    actions.className = "player-skill-card__actions";

    const total = document.createElement("span");
    total.className = "pill";
    total.textContent = `Total: ${player.totalLevel || 0}`;

    const sync = document.createElement("button");
    sync.type = "button";
    sync.textContent = player.fetchStatus === "loading" ? "Syncing…" : "Sync";
    sync.disabled = player.fetchStatus === "loading";
    sync.addEventListener("click", () => {
      if (index >= 0) refreshPlayer(index);
    });

    actions.append(total, sync);
    header.append(titleBlock, actions);

    const meters = document.createElement("div");
    meters.className = "skill-meters";

    if (!playerHasSkillData(player)) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.style.margin = "0";
      empty.textContent = "Sync hiscores to load per-skill levels.";
      meters.appendChild(empty);
    } else {
      SKILL_KEYS.forEach((key) => {
        const level = Number(player.skills[key]) || 0;
        const row = document.createElement("div");
        row.className = "skill-meter";

        const label = document.createElement("span");
        label.className = "skill-meter__label";
        label.textContent = formatSkillName(key);
        label.title = formatSkillName(key);

        const track = document.createElement("div");
        track.className = "skill-meter__track";
        const fill = document.createElement("div");
        fill.className = "skill-meter__fill";
        const cap = 99;
        const pct = cap > 0 ? (Math.min(level, cap) / cap) * 100 : 0;
        fill.style.width = `${pct}%`;
        track.appendChild(fill);

        const num = document.createElement("span");
        num.className = "skill-meter__level";
        num.textContent = String(level);

        row.append(label, track, num);
        meters.appendChild(row);
      });
    }

    card.append(statusStrip, header, meters);
    skillCards.appendChild(card);
  });
}

function renderClanHighscoreTable() {
  if (!clanHighscoresRoot) return;
  clanHighscoresRoot.innerHTML = "";

  if (!state.id || !state.players.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Select a clan with members to see the highscore table.";
    clanHighscoresRoot.appendChild(p);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "clan-highscores-scroll";

  const table = document.createElement("table");
  table.className = "clan-highscores-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Skill", "Highest", "#1", "#2", "#3", "#4", "#5"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  const rowDefs = [
    {
      label: "Total level",
      getLevel: (p) => Number(p.totalLevel) || 0
    },
    ...SKILL_KEYS.map((key) => ({
      label: formatSkillName(key),
      getLevel: (p) => Number(p.skills?.[key]) || 0
    }))
  ];

  rowDefs.forEach((def) => {
    const ranked = state.players
      .map((p) => ({ name: p.name, level: def.getLevel(p) }))
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    const highest = ranked.length ? ranked[0].level : 0;

    const tr = document.createElement("tr");
    const tdSkill = document.createElement("td");
    tdSkill.textContent = def.label;
    const tdHigh = document.createElement("td");
    tdHigh.textContent = String(highest);
    tdHigh.className = "clan-highscores-table__num";
    tr.append(tdSkill, tdHigh);

    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      const td = document.createElement("td");
      td.className = "clan-highscores-table__rank";
      const entry = ranked[i];
      if (entry) {
        td.textContent = `${entry.name} (${entry.level})`;
      } else {
        td.textContent = "—";
        td.classList.add("muted");
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  clanHighscoresRoot.appendChild(wrap);
}

function setClanViewTab(which) {
  const isCards = which === "cards";
  clanTabCards?.setAttribute("aria-selected", String(isCards));
  clanTabHighscores?.setAttribute("aria-selected", String(!isCards));
  clanTabCards?.classList.toggle("is-active", isCards);
  clanTabHighscores?.classList.toggle("is-active", !isCards);
  if (clanPanelCards) clanPanelCards.hidden = !isCards;
  if (clanPanelHighscores) clanPanelHighscores.hidden = isCards;
}

function initClanTabs() {
  clanTabCards?.addEventListener("click", () => setClanViewTab("cards"));
  clanTabHighscores?.addEventListener("click", () => setClanViewTab("highscores"));
}

function render() {
  renderClanSelect();
  renderClanMembersList();
  renderClanTitle();
  renderSkillCards();
  renderClanHighscoreTable();
  renderBountyBoard();
}

function setActivePage(pageId) {
  const showDashboard = pageId === "dashboard";
  if (pageDashboard) {
    pageDashboard.hidden = !showDashboard;
    pageDashboard.classList.toggle("page--active", showDashboard);
  }
  if (pageCalculators) {
    pageCalculators.hidden = showDashboard;
    pageCalculators.classList.toggle("page--active", !showDashboard);
  }
  navLinks.forEach((link) => {
    const isActive = link.getAttribute("data-nav-page") === pageId;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function initClanSelect() {
  clanSelect?.addEventListener("change", async () => {
    const id = clanSelect.value;
    if (!id) return;
    if (id === selectedClanId && state.id === id) return;
    await selectClanById(id, { refreshHiscores: true });
  });
}

refreshAllBtn?.addEventListener("click", () => {
  refreshAllPlayers();
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const page = link.getAttribute("data-nav-page");
    if (page === "dashboard" || page === "calculators") setActivePage(page);
  });
});

async function boot() {
  await fetchClanList();

  let storedId = null;
  try {
    storedId = localStorage.getItem(SELECTED_CLAN_ID_KEY);
  } catch {
    storedId = null;
  }

  const pick =
    storedId && clanList.some((c) => c.id === storedId)
      ? storedId
      : clanList[0]?.id || null;

  if (pick) {
    await selectClanById(pick, { refreshHiscores: true });
  } else {
    persistSelectedClanId(null);
    state = emptyClanState();
    render();
  }

  initNewClanModal();
  initBountyModal();
  initClanTabs();
  initClanSelect();
}

boot();
