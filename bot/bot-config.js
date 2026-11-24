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

const DEFAULT_FAST_ATTACK_SECONDS = 2;
const MIN_FAST_ATTACK_SECONDS = 1;
const MAX_FAST_ATTACK_SECONDS = 60;
const MAX_PROFILE_URL_LENGTH = 500;

const RESERVED_FB_PATHS = new Set([
  "watch", "groups", "events", "marketplace", "gaming", "reel", "reels",
  "stories", "photo", "photos", "posts", "settings", "help", "login",
  "recover", "pages", "bookmarks", "friends", "messages", "notifications",
  "home.php", "index.php", "sharer.php", "dialog"
]);

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
    targetUser: {
      enabled: false,
      profileUrl: "",
      userID: null,
      username: null,
      matchedName: null,
      resolvedAt: null,
      lastError: null
    },
    fastAttack: {
      enabled: false,
      intervalSeconds: DEFAULT_FAST_ATTACK_SECONDS
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

function clampFastAttackSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_FAST_ATTACK_SECONDS;
  return Math.min(MAX_FAST_ATTACK_SECONDS, Math.max(MIN_FAST_ATTACK_SECONDS, Math.round(n)));
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_GC_NAME_LENGTH);
}

function cleanProfileUrl(value) {
  return String(value || "").trim().slice(0, MAX_PROFILE_URL_LENGTH);
}

function normalizeNames(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/\r?\n/);
  return list.map(cleanName).filter(Boolean).slice(0, MAX_ROTATION_NAMES);
}

function isFacebookHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "fb.com" ||
    host.endsWith(".fb.com") ||
    host === "messenger.com" ||
    host.endsWith(".messenger.com")
  );
}

function extractUsernameFromProfileUrl(rawUrl) {
  const str = cleanProfileUrl(rawUrl);
  if (!str) return null;
  try {
    const withProto = /^https?:\/\//i.test(str) ? str : `https://${str}`;
    const u = new URL(withProto);
    if (!isFacebookHost(u.hostname)) return null;
    const segments = u.pathname.split("/").filter(Boolean);
    if (!segments.length) return null;
    const first = segments[0].toLowerCase();
    if (first === "profile.php" || first === "people" || first === "user" || first === "share" || RESERVED_FB_PATHS.has(first)) {
      return null;
    }
    if (/^\d{5,}$/.test(segments[0])) return null;
    return segments[0];
  } catch {
    return null;
  }
}

function parseFacebookProfileInput(raw) {
  const trimmed = cleanProfileUrl(raw);
  if (!trimmed) {
    return { valid: false, profileUrl: "", userID: null, username: null, isShareLink: false, error: null };
  }

  if (/^\d{5,}$/.test(trimmed)) {
    return { valid: true, profileUrl: trimmed, userID: trimmed, username: null, isShareLink: false, error: null };
  }

  if (trimmed.startsWith("@")) {
    const uname = trimmed.slice(1).trim();
    if (!uname || /\s|\//.test(uname)) {
      return { valid: false, profileUrl: trimmed, userID: null, username: null, isShareLink: false, error: "Hindi valid ang Facebook username." };
    }
    return { valid: true, profileUrl: trimmed, userID: null, username: uname, isShareLink: false, error: null };
  }

  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /(?:^|\.)(?:facebook|fb|messenger)\.com/i.test(trimmed);
  if (looksLikeUrl) {
    let parsed;
    try {
      const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      parsed = new URL(withProto);
    } catch {
      return { valid: false, profileUrl: trimmed, userID: null, username: null, isShareLink: false, error: "Hindi valid ang Facebook profile link." };
    }

    if (!isFacebookHost(parsed.hostname)) {
      return { valid: false, profileUrl: trimmed, userID: null, username: null, isShareLink: false, error: "Dapat Facebook link (facebook.com o fb.com) ang ilagay." };
    }

    // Unwrap l.facebook.com/l.php?u=...
    if (parsed.hostname.toLowerCase().startsWith("l.") && parsed.searchParams.get("u")) {
      return parseFacebookProfileInput(parsed.searchParams.get("u"));
    }

    const idParam = String(parsed.searchParams.get("id") || "").trim();
    if (/^\d{5,}$/.test(idParam)) {
      return { valid: true, profileUrl: trimmed, userID: idParam, username: null, isShareLink: false, error: null };
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (!segments.length) {
      return { valid: false, profileUrl: trimmed, userID: null, username: null, isShareLink: false, error: "Walang profile username o UID sa Facebook link." };
    }

    const firstLower = segments[0].toLowerCase();
    if (firstLower === "profile.php") {
      return { valid: false, profileUrl: trimmed, userID: null, username: null, isShareLink: false, error: "Walang valid id= UID sa profile.php link." };
    }

    if (firstLower === "people" && segments.length >= 3 && /^\d{5,}$/.test(segments[2])) {
      return { valid: true, profileUrl: trimmed, userID: segments[2], username: null, isShareLink: false, error: null };
    }

    if (firstLower === "user" && segments[1] && /^\d{5,}$/.test(segments[1])) {
      return { valid: true, profileUrl: trimmed, userID: segments[1], username: null, isShareLink: false, error: null };
    }

    if (firstLower === "share") {
      return { valid: true, profileUrl: trimmed, userID: null, username: null, isShareLink: true, error: null };
    }

    if (/^\d{5,}$/.test(segments[0])) {
      return { valid: true, profileUrl: trimmed, userID: segments[0], username: null, isShareLink: false, error: null };
    }

    if (RESERVED_FB_PATHS.has(firstLower)) {
      return { valid: false, profileUrl: trimmed, userID: null, username: null, isShareLink: false, error: "Hindi mukhang Facebook profile link ang URL na ito." };
    }

    return { valid: true, profileUrl: trimmed, userID: null, username: segments[0], isShareLink: false, error: null };
  }

  if (!/\s|\//.test(trimmed)) {
    return { valid: true, profileUrl: trimmed, userID: null, username: trimmed, isShareLink: false, error: null };
  }

  return {
    valid: false,
    profileUrl: trimmed,
    userID: null,
    username: null,
    isShareLink: false,
    error: "Ilagay ang valid na Facebook profile link (hal. https://www.facebook.com/username o profile.php?id=1000...)."
  };
}

function normalizeConfig(raw) {
  const base = defaultConfig();
  const src = raw && typeof raw === "object" ? raw : {};
  const cmds = src.messengerCommands && typeof src.messengerCommands === "object" ? src.messengerCommands : {};
  const lock = src.gcLock && typeof src.gcLock === "object" ? src.gcLock : {};
  const ren = src.gcRename && typeof src.gcRename === "object" ? src.gcRename : {};
  const tgt = src.targetUser && typeof src.targetUser === "object" ? src.targetUser : {};
  const fa = src.fastAttack && typeof src.fastAttack === "object" ? src.fastAttack : {};

  const messengerCommands = {};
  for (const key of COMMAND_KEYS) messengerCommands[key] = toBool(cmds[key], base.messengerCommands[key]);

  const rawProfileUrl = cleanProfileUrl(tgt.profileUrl);
  const parsedProfile = parseFacebookProfileInput(rawProfileUrl);

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
    targetUser: {
      enabled: toBool(tgt.enabled, false),
      profileUrl: rawProfileUrl,
      userID: tgt.userID ? String(tgt.userID) : (parsedProfile.userID || null),
      username: tgt.username ? String(tgt.username) : (parsedProfile.username || null),
      matchedName: tgt.matchedName ? String(tgt.matchedName) : null,
      resolvedAt: tgt.resolvedAt || null,
      lastError: tgt.lastError || null
    },
    fastAttack: {
      enabled: toBool(fa.enabled, false),
      intervalSeconds: clampFastAttackSeconds(fa.intervalSeconds ?? DEFAULT_FAST_ATTACK_SECONDS)
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

function isTargetUserRestricted(config) {
  const t = config?.targetUser;
  return Boolean(t && t.enabled && cleanProfileUrl(t.profileUrl));
}

function matchesTargetUser(config, senderID, participantInfo = null) {
  if (!isTargetUserRestricted(config)) return true;
  const sid = String(senderID || "").trim();
  if (!sid) return false;
  const t = config.targetUser;
  if (t.userID) return String(t.userID) === sid;
  if (t.username && participantInfo) {
    const wanted = String(t.username).toLowerCase();
    const vanity = String(participantInfo.vanity || "").trim().toLowerCase();
    if (vanity && vanity === wanted) return true;
    const fromUrl = extractUsernameFromProfileUrl(participantInfo.url || participantInfo.profileUrl || "");
    if (fromUrl && fromUrl.toLowerCase() === wanted) return true;
  }
  return false;
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
  DEFAULT_FAST_ATTACK_SECONDS,
  MIN_FAST_ATTACK_SECONDS,
  MAX_FAST_ATTACK_SECONDS,
  getConfigPath,
  defaultConfig,
  normalizeConfig,
  normalizeNames,
  cleanName,
  cleanProfileUrl,
  clampInterval,
  clampFastAttackSeconds,
  parseFacebookProfileInput,
  extractUsernameFromProfileUrl,
  loadConfig,
  saveConfig,
  parseBanatSubcommand,
  isMessengerCommandAllowed,
  sameGcName,
  lockTargetAsThreadID,
  isThreadAllowed,
  isTargetUserRestricted,
  matchesTargetUser,
  renderPattern,
  buildNextGcName,
  isRenameDue,
  nextRenameAt
};
