"use strict";

/*
 * Dashboard-controlled bot configuration.
 * ---------------------------------------
 * Lahat ng control (Banat ON/OFF, Messenger command switches, GC Auto Lock,
 * Auto Change GC Name) ay galing dito at sine-save sa JSON file para hindi
 * mawala kapag nag-restart ang server.
 *
 * File location: BANAT_CONFIG_PATH env var, o ./banat-config.json
 */

const fs = require("fs");
const path = require("path");

const COMMAND_KEYS = ["on", "off", "toggle", "status", "help"];
const DEFAULT_RENAME_INTERVAL_MINUTES = 2;
const MIN_RENAME_INTERVAL_MINUTES = 1;
const MAX_RENAME_INTERVAL_MINUTES = 1440;
const MAX_ROTATION_NAMES = 50;
const MAX_GC_NAME_LENGTH = 250;

const COMMAND_ALIASES = {
  on: "on", enable: "on", start: "on",
  off: "off", disable: "off", stop: "off",
  toggle: "toggle",
  status: "status",
  help: "help"
};

function getConfigPath() {
  return path.resolve(String(process.env.BANAT_CONFIG_PATH || path.join(process.cwd(), "banat-config.json")));
}

function defaultConfig() {
  return {
    // Master Banat mode (dating !banat on / !banat off)
    banatEnabled: /^(1|true|yes|on)$/i.test(process.env.BANAT_DEFAULT_ON || "false"),
    // Kung papayagan pa ang mga !banat command na i-type sa Messenger.
    // Default: lahat naka-OFF -> hindi na sasagot ang bot sa !banat commands sa Messenger.
    messengerCommands: { on: false, off: false, toggle: false, status: false, help: false },
    gcLock: {
      enabled: false,
      name: "",          // GC name (o thread ID) na inilagay sa dashboard
      threadID: null,    // na-resolve na thread ID
      matchedName: null, // pangalan ng GC noong na-match
      resolvedAt: null
    },
    gcRename: {
      enabled: false,
      intervalMinutes: DEFAULT_RENAME_INTERVAL_MINUTES,
      mode: "pattern",           // "pattern" | "rotation"
      pattern: "{name} #{n}",
      names: [],
      counter: 0,
      rotationIndex: 0,
      lastRenamedAt: null,
      lastName: null,
      lastError: null
    },
    updatedAt: null
  };
}

function toBool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function clampInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RENAME_INTERVAL_MINUTES;
  return Math.min(MAX_RENAME_INTERVAL_MINUTES, Math.max(MIN_RENAME_INTERVAL_MINUTES, Math.round(n)));
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_GC_NAME_LENGTH);
}

function normalizeNames(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return list.map(cleanName).filter(Boolean).slice(0, MAX_ROTATION_NAMES);
}

function normalizeConfig(raw) {
  const base = defaultConfig();
  const src = raw && typeof raw === "object" ? raw : {};
  const cmds = src.messengerCommands && typeof src.messengerCommands === "object" ? src.messengerCommands : {};
  const lock = src.gcLock && typeof src.gcLock === "object" ? src.gcLock : {};
  const ren = src.gcRename && typeof src.gcRename === "object" ? src.gcRename : {};

  const messengerCommands = {};
  for (const key of COMMAND_KEYS) messengerCommands[key] = toBool(cmds[key], base.messengerCommands[key]);

  return {
    banatEnabled: toBool(src.banatEnabled, base.banatEnabled),
    messengerCommands,
    gcLock: {
      enabled: toBool(lock.enabled, false),
      name: cleanName(lock.name),
      threadID: lock.threadID ? String(lock.threadID) : null,
      matchedName: lock.matchedName ? String(lock.matchedName) : null,
      resolvedAt: lock.resolvedAt || null
    },
    gcRename: {
      enabled: toBool(ren.enabled, false),
      intervalMinutes: clampInterval(ren.intervalMinutes ?? DEFAULT_RENAME_INTERVAL_MINUTES),
      mode: ren.mode === "rotation" ? "rotation" : "pattern",
      pattern: cleanName(ren.pattern) || base.gcRename.pattern,
      names: normalizeNames(ren.names),
      counter: Math.max(0, Math.floor(Number(ren.counter) || 0)),
      rotationIndex: Math.max(0, Math.floor(Number(ren.rotationIndex) || 0)),
      lastRenamedAt: ren.lastRenamedAt || null,
      lastName: ren.lastName || null,
      lastError: ren.lastError || null
    },
    updatedAt: src.updatedAt || null
  };
}

function loadConfig() {
  try {
    const file = getConfigPath();
    if (!fs.existsSync(file)) return defaultConfig();
    return normalizeConfig(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (err) {
    console.error("[BANAT] failed to read config, using defaults:", err?.message || err);
    return defaultConfig();
  }
}

function saveConfig(config) {
  const next = normalizeConfig({ ...config, updatedAt: new Date().toISOString() });
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("[BANAT] failed to save config:", err?.message || err);
  }
  return next;
}

/** "!banat on" -> "on", "!banat enable" -> "on", "!banat" -> "status", unknown -> null */
function parseBanatSubcommand(body) {
  const parts = String(body || "").trim().split(/\s+/);
  const sub = (parts[1] || "status").toLowerCase();
  return COMMAND_ALIASES[sub] || null;
}

function isMessengerCommandAllowed(config, sub) {
  if (!sub) return false;
  return Boolean(config?.messengerCommands?.[sub]);
}

function sameGcName(a, b) {
  return cleanName(a).toLowerCase() === cleanName(b).toLowerCase() && cleanName(a) !== "";
}

/** Thread ID kung puro numero ang nilagay sa dashboard, para pwedeng i-lock gamit ang ID. */
function lockTargetAsThreadID(config) {
  const name = cleanName(config?.gcLock?.name);
  return /^\d{6,}$/.test(name) ? name : null;
}

/**
 * Kapag naka-ON ang GC Auto Lock, ang naka-lock na GC lang ang sasagutin.
 * Habang hindi pa nahahanap ang GC, walang sasagutin ang bot.
 */
function isThreadAllowed(config, threadID) {
  const lock = config?.gcLock;
  if (!lock || !lock.enabled || !cleanName(lock.name)) return true;
  const id = String(threadID || "");
  if (!id) return false;
  if (lock.threadID) return lock.threadID === id;
  const directID = lockTargetAsThreadID(config);
  return directID ? directID === id : false;
}

function renderPattern(pattern, { name, n, now }) {
  const d = now instanceof Date ? now : new Date(now || Date.now());
  const pad = v => String(v).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return cleanName(
    String(pattern || "{name} #{n}")
      .replace(/\{name\}/gi, cleanName(name))
      .replace(/\{n\}/gi, String(n))
      .replace(/\{time\}/gi, time)
      .replace(/\{date\}/gi, date)
  );
}

/**
 * Kinukuwenta ang susunod na GC name.
 * Returns { name, patch } kung saan ang patch ay ia-apply sa gcRename state pagka-successful.
 */
function buildNextGcName(config, now = new Date()) {
  const ren = config.gcRename;
  // Base name: ang totoong pangalan ng GC noong na-lock (bago pa palitan ng bot).
  // Kung hindi pa alam, ang inilagay sa dashboard.
  const baseName = config.gcLock.matchedName ||
    (lockTargetAsThreadID(config) ? "GC" : config.gcLock.name);

  if (ren.mode === "rotation") {
    if (!ren.names.length) return null;
    const index = ren.rotationIndex % ren.names.length;
    return { name: ren.names[index], patch: { rotationIndex: (index + 1) % ren.names.length } };
  }

  const n = ren.counter + 1;
  const name = renderPattern(ren.pattern, { name: baseName, n, now });
  if (!name) return null;
  return { name, patch: { counter: n } };
}

function isRenameDue(config, nowMs = Date.now()) {
  const ren = config.gcRename;
  if (!ren.enabled || !config.gcLock.enabled || !config.gcLock.threadID) return false;
  if (!ren.lastRenamedAt) return true;
  const last = Date.parse(ren.lastRenamedAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= ren.intervalMinutes * 60 * 1000;
}

function nextRenameAt(config) {
  const ren = config.gcRename;
  if (!ren.enabled || !config.gcLock.enabled || !config.gcLock.threadID) return null;
  if (!ren.lastRenamedAt) return new Date().toISOString();
  return new Date(Date.parse(ren.lastRenamedAt) + ren.intervalMinutes * 60 * 1000).toISOString();
}

module.exports = {
  COMMAND_KEYS,
  DEFAULT_RENAME_INTERVAL_MINUTES,
  MIN_RENAME_INTERVAL_MINUTES,
  getConfigPath,
  defaultConfig,
  normalizeConfig,
  normalizeNames,
  cleanName,
  clampInterval,
  loadConfig,
  saveConfig,
  parseBanatSubcommand,
  isMessengerCommandAllowed,
  sameGcName,
  lockTargetAsThreadID,
  isThreadAllowed,
  renderPattern,
  buildNextGcName,
  isRenameDue,
  nextRenameAt
};
