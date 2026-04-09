/**
 * Vercel build step: writes api-config.js from API_BASE_URL (no trailing slash).
 * Example: API_BASE_URL=https://your-api.onrender.com
 */
const fs = require("node:fs");
const path = require("node:path");

const outPath = path.join(__dirname, "..", "api-config.js");
const base = (process.env.API_BASE_URL || "").trim().replace(/\/$/, "");
const contents = `window.__API_BASE__ = ${JSON.stringify(base)};\n`;
fs.writeFileSync(outPath, contents, "utf8");
console.log("api-config.js:", base || "(empty — same-origin; set API_BASE_URL on Vercel)");
