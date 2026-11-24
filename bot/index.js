"use strict";

/*
 * BANAT-ONLY MESSENGER BOT
 * ------------------------
 * No AI. No games. No economy. No RPG. No music. No database.
 *
 * CONTROL (DASHBOARD):
 *   Lahat ng control ay nasa admin dashboard na (tab: "Commands & GC"):
 *   - Banat ON / OFF / Toggle / Status / Help
 *   - Messenger command switches (default: naka-OFF lahat, kaya hindi na
 *     sasagot ang bot kapag may nag-type ng !banat ... sa Messenger)
 *   - GC Auto Lock: sasagot lang ang bot sa GC na nakalagay sa dashboard
 *   - Auto Change GC Name: papalitan ang pangalan ng naka-lock na GC
 *     every 2 minutes (configurable)
 *
 *   Naka-save ang settings sa banat-config.json (o BANAT_CONFIG_PATH).
 *   BANAT_DEFAULT_ON=true = naka-ON ang Banat mode sa unang takbo.
 */

const fs = require("fs");
const path = require("path");
const { login } = require("ws3-fca");
const { getTriggerReply, getBanatConversationReply } = require("./triggers");
const { sendBanatReplyWithTyping } = require("./banat-human");
const { classifyBanatTarget, setBanatConversationMode, isBanatConversationModeActive } = require("./banat-targeting");
const botConfigLib = require("./bot-config");

const PORT = Number(process.env.PORT || 10000);
const THREAD_NAME_CACHE_MS = 5 * 60 * 1000;
const RENAME_TICK_MS = 10 * 1000;
const GLOBAL_SEND_LIMIT = Math.max(1, Number(process.env.BANAT_GLOBAL_SEND_LIMIT || 2));
const THREAD_COOLDOWN_MS = Math.max(0, Number(process.env.BANAT_THREAD_COOLDOWN_MS || 12000));
const RETRY_DELAYS = [1500, 4000, 8000];

const activeThreads = new Set();
const threadQueues = new Map();
const threadLastSent = new Map();
const threadCooldown = new Map();
const events = [];

let globalActive = 0;
let botUserID = "";
let botPaused = false;
let messengerConnected = false;
let loginInProgress = false;
let loginError = null;
let lastConnectedAt = null;
let lastDisconnectedAt = null;

let configuredBotName = "";
let configuredFacebookUid = "";
let facebookUserName = null;
let activeCookieString = "";
let cookieCount = 0;
let currentApi = null;
let activeListenerEmitter = null;
let sessionGeneration = 0;

// Dashboard-controlled settings (persisted)
let botConfig = botConfigLib.loadConfig();
const threadNameCache = new Map(); // threadID -> { name, isGroup, participants, checkedAt }
const pendingThreadLookups = new Map();
let renameInFlight = false;
let renameTimer = null;

// Fast Attack loop state
let fastAttackTimer = null;
let fastAttackInFlight = false;
let fastAttackStats = {
  sentCount: 0,
  lastSentAt: null,
  lastMessage: null,
  lastError: null
};

function pushEvent(type, message, details = null) {
  events.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    message,
    details,
    timestamp: new Date().toISOString()
  });
  if (events.length > 100) events.length = 100;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function hasEnvOrFileSession() {
  if (String(process.env.FB_COOKIES || process.env.FB_APPSTATE || "").trim()) return true;
  for (const file of ["appstate.json", "cookies.json"]) {
    if (fs.existsSync(path.join(process.cwd(), file))) return true;
  }
  return false;
}

function readSession() {
  if (activeCookieString) {
    return activeCookieString;
  }

  const raw = process.env.FB_COOKIES || process.env.FB_APPSTATE;

  if (raw) {
    const trimmed = String(raw).trim();

    // ws3-fca 2.0.1 accepts a cookie/header string.
    // If env contains JSON appstate, parse it first and convert it below.
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return trimmed;
    }
  }

  for (const file of ["appstate.json", "cookies.json"]) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  throw new Error(
    "No Facebook session found. Upload JSON cookies in the dashboard or provide FB_COOKIES/appstate.json."
  );
}

function extractCookieEntries(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return extractCookieEntries(JSON.parse(trimmed));
      } catch (err) {
        throw new Error("Invalid JSON format in Facebook cookies: " + err.message);
      }
    }
    const pairs = trimmed
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const eqIdx = part.indexOf("=");
        if (eqIdx <= 0) return null;
        return {
          key: part.slice(0, eqIdx).trim(),
          value: part.slice(eqIdx + 1).trim()
        };
      })
      .filter(Boolean);
    return pairs.length ? pairs : null;
  }

  const entries =
    Array.isArray(value) ? value :
    Array.isArray(value?.appState) ? value.appState :
    Array.isArray(value?.cookies) ? value.cookies :
    null;

  if (!entries) return null;

  const normalized = entries
    .map(cookie => {
      const key = cookie?.key ?? cookie?.name;
      const val = cookie?.value;
      if (key == null || val == null) return null;
      return {
        key: String(key).trim(),
        value: String(val)
      };
    })
    .filter(Boolean);

  return normalized.length ? normalized : null;
}

function normalizeSession(value) {
  // ws3-fca 2.0.1 expects the saved Facebook session as a cookie string,
  // not { appState: [...] }. Convert exported cookie/appstate JSON into
  // the header format that version accepts.
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("Facebook cookie session is empty.");
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
      return trimmed;
    }
  }

  const entries = extractCookieEntries(value);

  if (!entries) {
    throw new Error(
      "Facebook session must be a cookie string or a JSON array of cookie/appState entries."
    );
  }

  const parts = entries.map(c => c.key + "=" + c.value);

  if (!parts.length) {
    throw new Error("Facebook session contains no valid cookie entries.");
  }

  return parts.join("; ");
}

function inspectCookieEntries(rawCookies) {
  const entries = extractCookieEntries(rawCookies);
  if (!entries || !entries.length) {
    throw new Error("Hindi valid ang JSON cookies. Dapat itong JSON array ng cookies o appState mula sa naka-login na Facebook browser tab.");
  }
  const map = new Map();
  for (const item of entries) {
    if (item.key) map.set(item.key, item.value);
  }
  const cUser = String(map.get("c_user") || map.get("i_user") || "").trim();
  const xs = String(map.get("xs") || "").trim();
  if (!cUser || !xs) {
    throw new Error("Kulang ang required Facebook login cookies (c_user o xs). Siguraduhing naka-login ang Facebook account sa kabilang tab bago i-export ang JSON cookies.");
  }
  return {
    entries,
    cookieString: entries.map(c => `${c.key}=${c.value}`).join("; "),
    cookieCount: entries.length,
    cUser
  };
}

function enqueue(threadID, job) {
  const key = String(threadID);
  const current = threadQueues.get(key) || Promise.resolve();
  const next = current.catch(() => {}).then(job).finally(() => {
    if (threadQueues.get(key) === next) threadQueues.delete(key);
  });
  threadQueues.set(key, next);
  return next;
}

async function acquireGlobalSlot() {
  while (globalActive >= GLOBAL_SEND_LIMIT) await sleep(150);
  globalActive++;
}

function releaseGlobalSlot() { globalActive = Math.max(0, globalActive - 1); }

function is1545012(error) {
  const text = JSON.stringify(error || "");
  return /1545012|temporarily unavailable|message could not be sent/i.test(text);
}

function trafficSendMessage(api, message, threadID, callback, replyToMessageID = null) {
  const key = String(threadID);
  return enqueue(key, async () => {
    const now = Date.now();
    const cooldownUntil = Number(threadCooldown.get(key) || 0);
    if (cooldownUntil > now) {
      callback(new Error(`thread cooldown active for ${cooldownUntil - now}ms`));
      return;
    }

    const sinceLast = now - Number(threadLastSent.get(key) || 0);
    if (sinceLast < THREAD_COOLDOWN_MS) await sleep(THREAD_COOLDOWN_MS - sinceLast);

    await acquireGlobalSlot();
    try {
      let lastError = null;
      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        try {
          const result = await new Promise((resolve, reject) => {
            let settled = false;
            const done = (err, info) => {
              if (settled) return;
              settled = true;
              err ? reject(err) : resolve(info);
            };
            try {
              let returned;
              if (replyToMessageID) returned = api.sendMessage(message, threadID, done, replyToMessageID);
              else returned = api.sendMessage(message, threadID, done);
              if (returned && typeof returned.then === "function") returned.then(info => done(null, info)).catch(done);
            } catch (e) { reject(e); }
          });
          threadLastSent.set(key, Date.now());
          callback(null, result);
          return;
        } catch (error) {
          lastError = error;
          if (!is1545012(error) || attempt >= RETRY_DELAYS.length) break;
          threadCooldown.set(key, Date.now() + Math.min(15000, RETRY_DELAYS[attempt]));
          await sleep(RETRY_DELAYS[attempt]);
          threadCooldown.delete(key);
        }
      }
      if (is1545012(lastError)) threadCooldown.set(key, Date.now() + 5 * 60 * 1000);
      callback(lastError);
    } finally {
      releaseGlobalSlot();
    }
  });
}

function isBanatCommand(body) {
  return /^!banat(?:\s|$)/i.test(String(body || "").trim());
}

function commandSendMessage(api, message, threadID, replyToMessageID = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, info) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(info);
    };

    try {
      const returned = replyToMessageID
        ? api.sendMessage(message, threadID, done, replyToMessageID)
        : api.sendMessage(message, threadID, done);

      if (returned && typeof returned.then === "function") {
        returned.then(info => done(null, info)).catch(done);
      }
    } catch (error) {
      done(error);
    }
  });
}

function sendCommandReply(api, event, message) {
  const threadID = String(event.threadID);
  commandSendMessage(api, message, threadID, event.messageID || null)
    .then(() => {
      console.log(`[BANAT] command reply sent: ${message}`);
      pushEvent("command", `Replied to !banat command in thread ${threadID}`);
    })
    .catch(error => console.error("[BANAT] command reply failed:", error?.message || error));
}

function handleBanatCommand(api, event, body) {
  const threadID = String(event.threadID);
  const sub = botConfigLib.parseBanatSubcommand(body);

  // Dashboard na ang control. Kapag naka-OFF ang switch ng command sa dashboard,
  // tahimik lang ang bot (walang reply sa Messenger).
  if (!botConfigLib.isMessengerCommandAllowed(botConfig, sub)) {
    console.log(`[BANAT] ignored messenger command "${body}" in ${threadID} (disabled in dashboard)`);
    pushEvent("command-ignored", `Hindi pinansin ang "${String(body).slice(0, 40)}" sa thread ${threadID} (naka-OFF sa dashboard)`);
    return true;
  }

  if (sub === "on") {
    setBanatConversationMode(threadID, true, event.senderID);
    activeThreads.add(threadID);
    console.log(`[BANAT] activated thread ${threadID} by ${event.senderID || "unknown"}`);
    sendCommandReply(api, event, "banat is on. say whatever u want 😭");
    return true;
  }

  if (sub === "off") {
    setBanatConversationMode(threadID, false);
    activeThreads.delete(threadID);
    console.log(`[BANAT] deactivated thread ${threadID}`);
    sendCommandReply(api, event, "banat off. peace 😭");
    return true;
  }

  if (sub === "toggle") {
    const next = !isBanatConversationModeActive(threadID);
    setBanatConversationMode(threadID, next, event.senderID);
    if (next) activeThreads.add(threadID);
    else activeThreads.delete(threadID);
    console.log(`[BANAT] toggled thread ${threadID}: ${next ? "ON" : "OFF"}`);
    sendCommandReply(api, event, next ? "banat is on 😭" : "banat is off");
    return true;
  }

  if (sub === "status") {
    const on = botConfig.banatEnabled || activeThreads.has(threadID) || isBanatConversationModeActive(threadID);
    sendCommandReply(api, event, on ? "banat: ON 🟢" : "banat: OFF 🔴");
    return true;
  }

  if (sub === "help") {
    const allowed = botConfigLib.COMMAND_KEYS.filter(k => botConfig.messengerCommands[k]).map(k => `!banat ${k}`);
    sendCommandReply(api, event, allowed.join(" · "));
    return true;
  }

  return true;
}

/* ------------------------------------------------------------------ */
/* Messenger API helpers                                               */
/* ------------------------------------------------------------------ */

function callFcaApi(fnName, ...args) {
  return new Promise((resolve, reject) => {
    const api = currentApi;
    if (!api || typeof api[fnName] !== "function") {
      reject(new Error(`Messenger API "${fnName}" is unavailable. I-start muna ang bot.`));
      return;
    }
    let settled = false;
    const done = (err, data) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve(data);
    };
    try {
      const returned = api[fnName](...args, done);
      if (returned && typeof returned.then === "function") returned.then(d => done(null, d)).catch(done);
    } catch (err) {
      done(err);
    }
  });
}

function errorText(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return String(err.error || err.message || JSON.stringify(err));
}

async function getThreadMeta(threadID, { force = false } = {}) {
  const key = String(threadID);
  const cached = threadNameCache.get(key);
  if (!force && cached && Date.now() - cached.checkedAt < THREAD_NAME_CACHE_MS) return cached;
  if (pendingThreadLookups.has(key)) return pendingThreadLookups.get(key);

  const lookup = callFcaApi("getThreadInfo", key)
    .then(info => {
      const participants = Array.isArray(info?.userInfo)
        ? info.userInfo
            .map(u => ({
              id: String(u?.id || ""),
              name: String(u?.name || ""),
              vanity: String(u?.vanity || ""),
              url: String(u?.url || u?.profileUrl || "")
            }))
            .filter(u => u.id)
        : (cached?.participants || []);
      const meta = {
        name: String(info?.threadName || info?.name || ""),
        isGroup: Boolean(info?.isGroup),
        participants,
        checkedAt: Date.now()
      };
      threadNameCache.set(key, meta);
      return meta;
    })
    .catch(err => {
      console.error(`[BANAT] getThreadInfo failed for ${key}:`, errorText(err));
      const meta = {
        name: cached?.name || "",
        isGroup: Boolean(cached?.isGroup),
        participants: cached?.participants || [],
        checkedAt: Date.now()
      };
      threadNameCache.set(key, meta);
      return meta;
    })
    .finally(() => pendingThreadLookups.delete(key));

  pendingThreadLookups.set(key, lookup);
  return lookup;
}

async function getThreadParticipants(threadID, { force = false } = {}) {
  const meta = await getThreadMeta(threadID, { force });
  return Array.isArray(meta?.participants) ? meta.participants : [];
}

function lockThread(threadID, name) {
  botConfig = botConfigLib.saveConfig({
    ...botConfig,
    gcLock: {
      ...botConfig.gcLock,
      threadID: String(threadID),
      matchedName: name || null,
      resolvedAt: new Date().toISOString()
    }
  });
  pushEvent("gc-lock", `Naka-lock na ang bot sa GC "${name || threadID}" (${threadID})`);
  console.log(`[BANAT] GC lock resolved -> ${threadID} (${name || "?"})`);
  syncFastAttackLoop();
  if (botConfig.targetUser.enabled && !botConfig.targetUser.userID && currentApi) {
    resolveTargetUser({ force: true }).catch(() => {});
  }
}

/** Hinahanap ang GC (by name o thread ID) sa listahan ng group chats ng bot. */
async function resolveGcLock() {
  const lock = botConfig.gcLock;
  if (!lock.enabled || !lock.name) return getControls();
  if (!currentApi) throw new Error("Offline ang bot. I-start muna ang bot bago hanapin ang GC.");

  const directID = botConfigLib.lockTargetAsThreadID(botConfig);
  if (directID) {
    const meta = await getThreadMeta(directID);
    lockThread(directID, meta.name || null);
    return getControls();
  }

  const threads = await listGroupThreads();
  const match = threads.find(t => botConfigLib.sameGcName(t.name, lock.name));
  if (match) {
    lockThread(match.threadID, match.name);
  } else {
    pushEvent("gc-lock", `Hindi pa nakita ang GC "${lock.name}". Ila-lock ito kapag may nag-message doon.`);
  }
  return getControls();
}

async function listGroupThreads() {
  const list = await callFcaApi("getThreadList", 50, null, ["INBOX"]);
  const threads = (Array.isArray(list) ? list : [])
    .filter(t => t && t.isGroup)
    .map(t => ({ threadID: String(t.threadID), name: String(t.name || t.threadName || "") }));
  for (const t of threads) {
    threadNameCache.set(t.threadID, { name: t.name, isGroup: true, checkedAt: Date.now() });
  }
  return threads;
}

/** Kapag naka-lock pero hindi pa resolved, tingnan kung ito na ang GC na hinahanap. */
async function tryMatchLockedThread(threadID) {
  const lock = botConfig.gcLock;
  if (!lock.enabled || !lock.name || lock.threadID) return botConfigLib.isThreadAllowed(botConfig, threadID);

  const directID = botConfigLib.lockTargetAsThreadID(botConfig);
  if (directID) {
    if (directID !== String(threadID)) return false;
    const meta = await getThreadMeta(threadID);
    lockThread(threadID, meta.name || null);
    return true;
  }

  const meta = await getThreadMeta(threadID);
  if (meta.isGroup && botConfigLib.sameGcName(meta.name, lock.name)) {
    lockThread(threadID, meta.name);
    return true;
  }
  return false;
}

function handleThreadEvent(event) {
  if (event?.logMessageType === "log:thread-name" && event.threadID) {
    const name = String(event?.logMessageData?.name || "");
    threadNameCache.set(String(event.threadID), { name, isGroup: true, checkedAt: Date.now() });
  }
}

/* ------------------------------------------------------------------ */
/* Auto Change GC Name                                                 */
/* ------------------------------------------------------------------ */

async function renameLockedGc({ force = false } = {}) {
  if (renameInFlight) return getControls();
  const lock = botConfig.gcLock;
  if (!lock.enabled || !lock.threadID) {
    throw new Error("Wala pang naka-lock na GC. I-set at hanapin muna ang GC sa GC Auto Lock.");
  }
  if (!currentApi || !messengerConnected) throw new Error("Offline ang bot. I-start muna ang bot.");
  if (!force && !botConfigLib.isRenameDue(botConfig)) return getControls();

  const next = botConfigLib.buildNextGcName(botConfig, new Date());
  if (!next) {
    throw new Error(botConfig.gcRename.mode === "rotation"
      ? "Walang laman ang rotation list. Maglagay ng kahit isang pangalan."
      : "Walang laman ang naming pattern.");
  }

  renameInFlight = true;
  const threadID = lock.threadID;
  try {
    await callFcaApi("setTitle", next.name, threadID);
    botConfig = botConfigLib.saveConfig({
      ...botConfig,
      gcRename: {
        ...botConfig.gcRename,
        ...next.patch,
        lastRenamedAt: new Date().toISOString(),
        lastName: next.name,
        lastError: null
      }
    });
    threadNameCache.set(threadID, { name: next.name, isGroup: true, checkedAt: Date.now() });
    pushEvent("gc-rename", `Pinalitan ang GC name -> "${next.name}"`);
  } catch (err) {
    const msg = errorText(err);
    botConfig = botConfigLib.saveConfig({
      ...botConfig,
      gcRename: { ...botConfig.gcRename, lastRenamedAt: new Date().toISOString(), lastError: msg }
    });
    pushEvent("error", `Hindi napalitan ang GC name: ${msg}`);
    console.error("[BANAT] setTitle failed:", msg);
    if (force) throw new Error(msg);
  } finally {
    renameInFlight = false;
  }
  return getControls();
}

function ensureRenameTimer() {
  if (renameTimer) return;
  renameTimer = setInterval(() => {
    if (!messengerConnected || botPaused || !currentApi) return;
    if (!botConfigLib.isRenameDue(botConfig)) return;
    renameLockedGc().catch(err => console.error("[BANAT] auto rename error:", errorText(err)));
  }, RENAME_TICK_MS);
  if (typeof renameTimer.unref === "function") renameTimer.unref();
}

/* ------------------------------------------------------------------ */
/* Auto Target User & Fast Attack                                      */
/* ------------------------------------------------------------------ */

async function resolveShareProfileUrl(shareUrl) {
  if (!shareUrl || typeof fetch !== "function") return null;
  try {
    const headers = { "User-Agent": "Mozilla/5.0" };
    if (activeCookieString) headers.Cookie = activeCookieString;
    const res = await fetch(shareUrl, {
      method: "GET",
      redirect: "follow",
      headers,
      signal: AbortSignal.timeout(5000)
    });
    if (res?.url && res.url !== shareUrl) {
      const parsed = botConfigLib.parseFacebookProfileInput(res.url);
      if (parsed.valid && (parsed.userID || parsed.username)) {
        return parsed;
      }
    }
  } catch (_) {}
  return null;
}

async function resolveTargetUser({ force = false } = {}) {
  const tgt = botConfig.targetUser;
  if (!tgt.profileUrl) return getControls();

  let parsed = botConfigLib.parseFacebookProfileInput(tgt.profileUrl);
  if (!parsed.valid) {
    botConfig = botConfigLib.saveConfig({
      ...botConfig,
      targetUser: { ...tgt, lastError: parsed.error || "Hindi valid ang Facebook profile link." }
    });
    return getControls();
  }

  let userID = parsed.userID || tgt.userID || null;
  let username = parsed.username || tgt.username || null;
  let matchedName = tgt.matchedName || null;

  if (parsed.isShareLink && !userID && !username) {
    const resolvedShare = await resolveShareProfileUrl(tgt.profileUrl);
    if (resolvedShare) {
      userID = resolvedShare.userID || null;
      username = resolvedShare.username || null;
    }
  }

  if (userID && currentApi) {
    if (botConfig.gcLock.threadID) {
      const participants = await getThreadParticipants(botConfig.gcLock.threadID, { force });
      const found = participants.find(p => p.id === String(userID));
      if (found) {
        matchedName = found.name || matchedName;
        if (!username && found.vanity) username = found.vanity;
      }
    }
    if (!matchedName) {
      try {
        const info = await callFcaApi("getUserInfo", String(userID));
        const rec = info?.[String(userID)] || info;
        if (rec?.name) matchedName = String(rec.name);
        if (!username && rec?.vanity) username = String(rec.vanity);
      } catch (_) {}
    }

    botConfig = botConfigLib.saveConfig({
      ...botConfig,
      targetUser: {
        ...tgt,
        userID: String(userID),
        username,
        matchedName,
        resolvedAt: new Date().toISOString(),
        lastError: null
      }
    });
    pushEvent("target-user", `Target user resolved: ${matchedName || userID} (${userID})`);
    return getControls();
  }

  if (username && currentApi && botConfig.gcLock.threadID) {
    const participants = await getThreadParticipants(botConfig.gcLock.threadID, { force });
    const wanted = username.toLowerCase();
    const match = participants.find(p => {
      if (p.vanity && p.vanity.toLowerCase() === wanted) return true;
      const fromUrl = botConfigLib.extractUsernameFromProfileUrl(p.url);
      return Boolean(fromUrl && fromUrl.toLowerCase() === wanted);
    });

    if (match) {
      botConfig = botConfigLib.saveConfig({
        ...botConfig,
        targetUser: {
          ...tgt,
          userID: match.id,
          username,
          matchedName: match.name || null,
          resolvedAt: new Date().toISOString(),
          lastError: null
        }
      });
      pushEvent("target-user", `Target user matched sa GC: ${match.name || username} (${match.id})`);
      return getControls();
    }
  }

  botConfig = botConfigLib.saveConfig({
    ...botConfig,
    targetUser: {
      ...tgt,
      userID,
      username,
      matchedName,
      lastError: parsed.isShareLink && !userID && !username
        ? "Hindi ma-resolve ang /share/ link. Mas mainam gamitin ang profile.php?id=... o facebook.com/username link."
        : null
    }
  });
  return getControls();
}

async function updateTargetUser({ enabled, profileUrl } = {}) {
  const prev = botConfig.targetUser;
  const nextUrl = typeof profileUrl === "string" ? botConfigLib.cleanProfileUrl(profileUrl) : prev.profileUrl;
  const nextEnabled = typeof enabled === "boolean" ? enabled : prev.enabled;

  if (nextUrl) {
    const parsed = botConfigLib.parseFacebookProfileInput(nextUrl);
    if (!parsed.valid) {
      throw new Error(parsed.error || "Hindi valid ang Facebook profile link.");
    }
  }
  if (nextEnabled && !nextUrl) {
    throw new Error("Ilagay muna ang Facebook profile link o UID ng target user.");
  }

  const urlChanged = nextUrl !== prev.profileUrl;
  const parsed = botConfigLib.parseFacebookProfileInput(nextUrl);

  botConfig = botConfigLib.saveConfig({
    ...botConfig,
    targetUser: {
      enabled: nextEnabled,
      profileUrl: nextUrl,
      userID: urlChanged ? (parsed.userID || null) : prev.userID,
      username: urlChanged ? (parsed.username || null) : prev.username,
      matchedName: urlChanged ? null : prev.matchedName,
      resolvedAt: urlChanged ? (parsed.userID ? new Date().toISOString() : null) : prev.resolvedAt,
      lastError: null
    }
  });

  pushEvent(
    "target-user",
    nextEnabled
      ? `Auto Target User ON: ${nextUrl}`
      : "Auto Target User OFF — normal reply targeting active"
  );

  if (nextEnabled && currentApi) {
    try {
      await resolveTargetUser({ force: true });
    } catch (err) {
      pushEvent("error", `Target user lookup failed: ${errorText(err)}`);
    }
  }

  return getControls();
}

function fastSendMessage(api, message, threadID) {
  const key = String(threadID);
  const now = Date.now();
  const cooldownUntil = Number(threadCooldown.get(key) || 0);
  if (cooldownUntil > now) {
    return Promise.reject(new Error(`Thread cooldown active (${Math.ceil((cooldownUntil - now) / 1000)}s remaining)`));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, info) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(info);
    };
    try {
      const returned = api.sendMessage(message, threadID, done);
      if (returned && typeof returned.then === "function") {
        returned.then(info => done(null, info)).catch(done);
      }
    } catch (err) {
      done(err);
    }
  });
}

async function runFastAttackTick() {
  if (fastAttackInFlight) return;
  if (!botConfig.fastAttack.enabled) return;
  if (!messengerConnected || botPaused || !currentApi) return;
  if (!botConfig.gcLock.enabled || !botConfig.gcLock.threadID) return;

  const threadID = String(botConfig.gcLock.threadID);
  const msg = getBanatConversationReply("", threadID);
  if (!msg) return;

  fastAttackInFlight = true;
  try {
    await fastSendMessage(currentApi, msg, threadID);
    fastAttackStats = {
      sentCount: fastAttackStats.sentCount + 1,
      lastSentAt: new Date().toISOString(),
      lastMessage: msg,
      lastError: null
    };
    pushEvent("fast-attack", `Fast Attack sent in GC ${threadID}: "${msg.slice(0, 60)}"`);
  } catch (err) {
    const msgErr = errorText(err);
    fastAttackStats = {
      ...fastAttackStats,
      lastError: msgErr
    };
    if (is1545012(err)) {
      threadCooldown.set(threadID, Date.now() + 30 * 1000);
    }
    pushEvent("error", `Fast Attack send error: ${msgErr}`);
    console.error("[BANAT] fast attack error:", msgErr);
  } finally {
    fastAttackInFlight = false;
  }
}

function syncFastAttackLoop() {
  if (fastAttackTimer) {
    clearInterval(fastAttackTimer);
    fastAttackTimer = null;
  }

  const ready = Boolean(
    botConfig.fastAttack.enabled &&
      messengerConnected &&
      !botPaused &&
      currentApi &&
      botConfig.gcLock.enabled &&
      botConfig.gcLock.threadID
  );

  if (!ready) return;

  const intervalMs = botConfigLib.clampFastAttackSeconds(botConfig.fastAttack.intervalSeconds) * 1000;
  setTimeout(() => {
    runFastAttackTick().catch(() => {});
  }, 150);
  fastAttackTimer = setInterval(() => {
    runFastAttackTick().catch(() => {});
  }, intervalMs);
  if (typeof fastAttackTimer.unref === "function") fastAttackTimer.unref();
}

async function updateFastAttack({ enabled, intervalSeconds } = {}) {
  const prev = botConfig.fastAttack;
  const nextEnabled = typeof enabled === "boolean" ? enabled : prev.enabled;
  const nextInterval =
    intervalSeconds !== undefined
      ? botConfigLib.clampFastAttackSeconds(intervalSeconds)
      : prev.intervalSeconds;

  botConfig = botConfigLib.saveConfig({
    ...botConfig,
    fastAttack: {
      enabled: nextEnabled,
      intervalSeconds: nextInterval
    }
  });

  if (nextEnabled && botConfig.gcLock.enabled && botConfig.gcLock.name && !botConfig.gcLock.threadID && currentApi) {
    try {
      await resolveGcLock();
    } catch (err) {
      pushEvent("error", `GC lookup failed: ${errorText(err)}`);
    }
  }

  if (!nextEnabled) {
    fastAttackStats = { ...fastAttackStats, lastError: null };
  }

  syncFastAttackLoop();
  pushEvent(
    "fast-attack",
    nextEnabled
      ? `Fast Attack ON — magcha-chat every ${nextInterval}s sa targeted GC`
      : "Fast Attack OFF"
  );
  return getControls();
}

/* ------------------------------------------------------------------ */
/* Dashboard controls                                                  */
/* ------------------------------------------------------------------ */

function getControls() {
  const lock = botConfig.gcLock;
  const fastAttackActive = Boolean(
    botConfig.fastAttack.enabled &&
      messengerConnected &&
      !botPaused &&
      lock.enabled &&
      lock.threadID
  );
  return {
    ok: true,
    config: botConfig,
    runtime: {
      bot_running: messengerConnected && !botPaused,
      banat_status: botConfig.banatEnabled ? "ON" : "OFF",
      thread_overrides: activeThreads.size,
      gc_lock_active: Boolean(lock.enabled && lock.name),
      gc_lock_resolved: Boolean(lock.enabled && lock.threadID),
      gc_current_name: lock.threadID ? (threadNameCache.get(lock.threadID)?.name || botConfig.gcRename.lastName || lock.matchedName) : null,
      next_rename_at: messengerConnected && !botPaused ? botConfigLib.nextRenameAt(botConfig) : null,
      preview_next_name: lock.enabled && lock.name ? (botConfigLib.buildNextGcName(botConfig)?.name || null) : null,
      target_user_active: botConfigLib.isTargetUserRestricted(botConfig),
      target_user_resolved: Boolean(botConfig.targetUser.enabled && botConfig.targetUser.userID),
      fast_attack_active: fastAttackActive,
      fast_attack: {
        active: fastAttackActive,
        sentCount: fastAttackStats.sentCount,
        lastSentAt: fastAttackStats.lastSentAt,
        lastMessage: fastAttackStats.lastMessage,
        lastError: fastAttackStats.lastError
      },
      config_path: botConfigLib.getConfigPath()
    }
  };
}

function clearThreadOverrides() {
  for (const threadID of activeThreads) setBanatConversationMode(threadID, false);
  activeThreads.clear();
}

function setBanatMode(action) {
  const current = botConfig.banatEnabled;
  let next = current;
  if (action === "on") next = true;
  else if (action === "off") next = false;
  else if (action === "toggle") next = !current;
  else throw new Error("Invalid action. Gamitin ang on, off, o toggle.");

  if (!next) clearThreadOverrides();
  botConfig = botConfigLib.saveConfig({ ...botConfig, banatEnabled: next });
  pushEvent("command", `Banat mode ${next ? "ON" : "OFF"} (dashboard)`);
  return getControls();
}

function updateMessengerCommands(patch = {}) {
  const nextCmds = { ...botConfig.messengerCommands };
  for (const key of botConfigLib.COMMAND_KEYS) {
    if (typeof patch[key] === "boolean") nextCmds[key] = patch[key];
  }
  botConfig = botConfigLib.saveConfig({ ...botConfig, messengerCommands: nextCmds });
  pushEvent("command", "Na-update ang Messenger command switches (dashboard)");
  return getControls();
}

async function updateGcLock({ enabled, name } = {}) {
  const prev = botConfig.gcLock;
  const nextName = typeof name === "string" ? botConfigLib.cleanName(name) : prev.name;
  const nextEnabled = typeof enabled === "boolean" ? enabled : prev.enabled;
  if (nextEnabled && !nextName) throw new Error("Ilagay muna ang pangalan ng GC na ila-lock.");

  const nameChanged = nextName !== prev.name;
  botConfig = botConfigLib.saveConfig({
    ...botConfig,
    gcLock: {
      enabled: nextEnabled,
      name: nextName,
      threadID: nameChanged ? null : prev.threadID,
      matchedName: nameChanged ? null : prev.matchedName,
      resolvedAt: nameChanged ? null : prev.resolvedAt
    },
    gcRename: nameChanged
      ? { ...botConfig.gcRename, counter: 0, rotationIndex: 0, lastRenamedAt: null, lastName: null, lastError: null }
      : botConfig.gcRename
  });
  pushEvent("gc-lock", nextEnabled ? `GC Auto Lock ON: "${nextName}"` : "GC Auto Lock OFF — sasagot na ulit sa lahat ng GC");
  syncFastAttackLoop();

  if (nextEnabled && !botConfig.gcLock.threadID && currentApi) {
    try { await resolveGcLock(); } catch (err) { pushEvent("error", `GC lookup failed: ${errorText(err)}`); }
  }
  return getControls();
}

function updateGcRename(patch = {}) {
  const prev = botConfig.gcRename;
  const next = { ...prev };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (patch.mode === "pattern" || patch.mode === "rotation") next.mode = patch.mode;
  if (typeof patch.pattern === "string") next.pattern = patch.pattern;
  if (patch.names !== undefined) {
    next.names = botConfigLib.normalizeNames(patch.names);
    next.rotationIndex = 0;
  }
  if (patch.intervalMinutes !== undefined) next.intervalMinutes = botConfigLib.clampInterval(patch.intervalMinutes);
  if (next.enabled && next.mode === "rotation" && !botConfigLib.normalizeNames(next.names).length) {
    throw new Error("Maglagay ng kahit isang pangalan sa rotation list.");
  }
  botConfig = botConfigLib.saveConfig({ ...botConfig, gcRename: next });
  if (typeof patch.enabled === "boolean" && patch.enabled !== prev.enabled) {
    pushEvent("gc-rename", next.enabled ? `Auto Change GC Name ON (every ${next.intervalMinutes} min)` : "Auto Change GC Name OFF");
  }
  return getControls();
}

async function sendBanat(api, event, text) {
  return sendBanatReplyWithTyping(api, text, String(event.threadID), event.messageID || null, {
    trafficSendMessage,
    incomingText: event.body || ""
  });
}

function onMessage(api, event) {
  if (!event) return;
  if (event.type === "event") { handleThreadEvent(event); return; }
  if (event.type && event.type !== "message") return;
  if (botPaused) return;
  if (event.senderID && botUserID && String(event.senderID) === String(botUserID)) return;

  const body = String(event.body || "").trim();
  if (!body) return;

  const threadID = String(event.threadID);
  const lock = botConfig.gcLock;

  // GC Auto Lock: naka-lock pero hindi pa nahahanap ang GC -> tingnan kung ito na.
  if (lock.enabled && lock.name && !lock.threadID) {
    tryMatchLockedThread(threadID)
      .then(matched => { if (matched) handleAllowedMessage(api, event, body, threadID); })
      .catch(err => console.error("[BANAT] GC lock match error:", errorText(err)));
    return;
  }

  // Ibang GC -> hindi sasagutin.
  if (!botConfigLib.isThreadAllowed(botConfig, threadID)) return;

  handleAllowedMessage(api, event, body, threadID);
}

async function resolveAndHandleTargetUserMessage(api, event, body, threadID, senderID) {
  try {
    let participant = null;
    const participants = await getThreadParticipants(threadID);
    participant = participants.find(p => p.id === senderID) || null;

    if (!participant || (!participant.vanity && !participant.url)) {
      const info = await callFcaApi("getUserInfo", senderID).catch(() => null);
      const rec = info?.[senderID] || info;
      if (rec) {
        participant = {
          id: senderID,
          name: String(rec.name || participant?.name || ""),
          vanity: String(rec.vanity || ""),
          url: String(rec.profileUrl || rec.url || "")
        };
      }
    }

    if (!botConfigLib.matchesTargetUser(botConfig, senderID, participant)) {
      return;
    }

    if (!botConfig.targetUser.userID) {
      botConfig = botConfigLib.saveConfig({
        ...botConfig,
        targetUser: {
          ...botConfig.targetUser,
          userID: senderID,
          matchedName: participant?.name || botConfig.targetUser.matchedName || null,
          resolvedAt: new Date().toISOString(),
          lastError: null
        }
      });
      pushEvent("target-user", `Auto-matched target user UID: ${participant?.name || senderID} (${senderID})`);
    }

    const reply = getTriggerReply(body, threadID) || getBanatConversationReply(body, threadID);
    if (reply) {
      sendBanat(api, event, reply)
        .then(ok => { if (ok) pushEvent("reply", `Sent auto-target reply in thread ${threadID} (UID ${senderID})`); })
        .catch(error => console.error("[BANAT] target-user reply error:", error));
    }
  } catch (err) {
    console.error("[BANAT] target user check failed:", errorText(err));
  }
}

function handleAllowedMessage(api, event, body, threadID) {
  if (isBanatCommand(body)) { handleBanatCommand(api, event, body); return; }

  // Auto Target User mode: kapag naka-ON, siya lang ang r-replyan sa targeted GC
  if (botConfigLib.isTargetUserRestricted(botConfig)) {
    const senderID = String(event.senderID || "").trim();
    if (!senderID) return;

    if (botConfig.targetUser.userID) {
      if (String(botConfig.targetUser.userID) !== senderID) return;
      console.log(`[BANAT] auto-target-user message in ${threadID} from ${senderID}`);
      const reply = getTriggerReply(body, threadID) || getBanatConversationReply(body, threadID);
      if (reply) {
        sendBanat(api, event, reply)
          .then(ok => { if (ok) pushEvent("reply", `Sent auto-target reply in thread ${threadID} (UID ${senderID})`); })
          .catch(error => console.error("[BANAT] target-user reply error:", error));
      }
      return;
    }

    resolveAndHandleTargetUserMessage(api, event, body, threadID, senderID);
    return;
  }

  const active = botConfig.banatEnabled || activeThreads.has(threadID) || isBanatConversationModeActive(threadID);
  const target = classifyBanatTarget({ event, body, botID: botUserID });

  if (active) {
    console.log(`[BANAT] active message in ${threadID} from ${event.senderID || "unknown"}`);
    const reply = getTriggerReply(body, threadID) || getBanatConversationReply(body, threadID);
    if (reply) {
      sendBanat(api, event, reply)
        .then(ok => { if (ok) pushEvent("reply", `Sent banat reply in thread ${threadID}`); })
        .catch(error => console.error("[BANAT] reply error:", error));
    } else {
      console.warn(`[BANAT] no reply generated for active message in ${threadID}`);
    }
    return;
  }

  if (target.shouldRespond) {
    const reply = getTriggerReply(body, threadID) || getBanatConversationReply(body, threadID);
    if (reply) {
      sendBanat(api, event, reply)
        .then(ok => { if (ok) pushEvent("reply", `Sent targeted banat reply in thread ${threadID}`); })
        .catch(error => console.error("[BANAT]", error));
    }
  }
}

function cleanupCurrentSession() {
  if (activeListenerEmitter && typeof activeListenerEmitter.removeAllListeners === "function") {
    try { activeListenerEmitter.removeAllListeners(); } catch (_) {}
  }
  activeListenerEmitter = null;
  if (currentApi && typeof currentApi.logout === "function") {
    // Do not call logout() because it invalidates the browser cookie tab!
  }
  currentApi = null;
}

function start(api, gen = sessionGeneration) {
  if (gen !== sessionGeneration) return;

  let detectedUid = "";
  try { detectedUid = String(api.getCurrentUserID?.() || "").trim(); } catch (_) {}

  if (configuredFacebookUid && detectedUid && detectedUid !== configuredFacebookUid) {
    messengerConnected = false;
    botPaused = true;
    loginInProgress = false;
    loginError = `Facebook UID mismatch: ang inilagay na UID (${configuredFacebookUid}) ay hindi tugma sa naka-login na session (${detectedUid}).`;
    pushEvent("error", loginError);
    return;
  }

  currentApi = api;
  botUserID = detectedUid || configuredFacebookUid || "";
  if (!configuredFacebookUid && botUserID) {
    configuredFacebookUid = botUserID;
  }

  messengerConnected = true;
  botPaused = false;
  loginInProgress = false;
  loginError = null;
  lastConnectedAt = new Date().toISOString();

  if (typeof api.getUserInfo === "function" && botUserID) {
    try {
      api.getUserInfo(botUserID, (err, info) => {
        if (!err && info && info[botUserID]?.name) {
          facebookUserName = String(info[botUserID].name);
        }
      });
    } catch (_) {}
  }

  ensureRenameTimer();
  syncFastAttackLoop();
  if (botConfig.gcLock.enabled && botConfig.gcLock.name && !botConfig.gcLock.threadID) {
    setTimeout(() => {
      if (gen !== sessionGeneration) return;
      resolveGcLock().catch(err => pushEvent("error", `GC lookup failed: ${errorText(err)}`));
    }, 3000);
  }
  if (botConfig.targetUser.enabled && botConfig.targetUser.profileUrl && !botConfig.targetUser.userID) {
    setTimeout(() => {
      if (gen !== sessionGeneration) return;
      resolveTargetUser({ force: true }).catch(() => {});
    }, 3500);
  }

  try {
    const maybeEmitter = api.listenMqtt((error, event) => {
      if (gen !== sessionGeneration) return;
      if (error) {
        const msg = String(error?.error || error?.message || error || "Messenger listener error");
        console.error("[BANAT] listener error:", error);
        pushEvent("error", `Listener error: ${msg}`);
        if (/not logged in|checkpoint|suspended|blocked/i.test(msg)) {
          messengerConnected = false;
          loginError = msg;
          lastDisconnectedAt = new Date().toISOString();
        }
        return;
      }
      try {
        onMessage(api, event);
      } catch (e) {
        console.error("[BANAT] message handler error:", e);
      }
    });
    if (maybeEmitter && typeof maybeEmitter.then === "function") {
      maybeEmitter.then(em => { activeListenerEmitter = em; }).catch(() => {});
    } else {
      activeListenerEmitter = maybeEmitter;
    }
  } catch (listenErr) {
    messengerConnected = false;
    botPaused = true;
    loginError = String(listenErr?.message || listenErr);
    pushEvent("error", `Failed to start MQTT listener: ${loginError}`);
    return;
  }

  pushEvent("connected", `Bot online${botUserID ? ` (UID: ${botUserID})` : ""}`);
  console.log(`[BANAT] online${botUserID ? ` as ${botUserID}` : ""}`);
}

function loginBot() {
  const gen = ++sessionGeneration;
  cleanupCurrentSession();

  let cookie;
  try {
    cookie = normalizeSession(readSession());
  } catch (err) {
    messengerConnected = false;
    botPaused = true;
    loginInProgress = false;
    loginError = String(err?.message || err);
    pushEvent("error", loginError);
    return Promise.resolve(getStatus());
  }

  loginInProgress = true;
  loginError = null;
  messengerConnected = false;
  pushEvent("connecting", "Sinusubukang i-login ang Facebook session...");
  console.log("[BANAT] logging in with saved Facebook session...");
  console.log(`[BANAT] session format: cookie string (${cookie.length} chars)`);

  return new Promise(resolve => {
    try {
      login(cookie, (error, api) => {
        if (gen !== sessionGeneration) {
          resolve(getStatus());
          return;
        }
        if (error || !api) {
          messengerConnected = false;
          botPaused = true;
          loginInProgress = false;
          const rawMsg = typeof error === "string"
            ? error
            : error?.error || error?.message || JSON.stringify(error) || "Facebook login failed";
          loginError = String(rawMsg);
          lastDisconnectedAt = new Date().toISOString();
          pushEvent("error", `Login failed: ${loginError}`);
          console.error("[BANAT] login failed:", error);
          resolve(getStatus());
          return;
        }
        start(api, gen);
        resolve(getStatus());
      });
    } catch (syncErr) {
      messengerConnected = false;
      botPaused = true;
      loginInProgress = false;
      loginError = String(syncErr?.message || syncErr);
      lastDisconnectedAt = new Date().toISOString();
      pushEvent("error", `Login failed: ${loginError}`);
      resolve(getStatus());
    }
  });
}

function configureSession({ botName, facebookUid, cookies } = {}) {
  if (typeof botName === "string") {
    configuredBotName = botName.trim();
  }

  if (typeof facebookUid === "string") {
    const cleanUid = facebookUid.trim();
    if (cleanUid && !/^\d+$/.test(cleanUid)) {
      throw new Error("Ang Facebook UID ay dapat puro numero lamang (hal. 100012345678901).");
    }
    configuredFacebookUid = cleanUid;
  }

  if (cookies !== undefined && cookies !== null && String(cookies).trim() !== "") {
    const inspected = inspectCookieEntries(cookies);
    if (configuredFacebookUid && inspected.cUser !== configuredFacebookUid) {
      throw new Error(
        `Hindi tugma ang Facebook UID (${configuredFacebookUid}) sa c_user (${inspected.cUser}) ng uploaded JSON cookies.`
      );
    }
    if (!configuredFacebookUid) {
      configuredFacebookUid = inspected.cUser;
    }
    activeCookieString = inspected.cookieString;
    cookieCount = inspected.cookieCount;
    loginError = null;
    pushEvent("session", `Na-save ang JSON cookies (${cookieCount} entries, UID: ${configuredFacebookUid})`);
  }

  return getStatus();
}

async function startBot(options = {}) {
  if (options && (options.botName !== undefined || options.facebookUid !== undefined || options.cookies !== undefined)) {
    configureSession(options);
  }

  if (loginInProgress) {
    return getStatus();
  }

  const hasNewCookies = Boolean(options && options.cookies && String(options.cookies).trim() !== "");

  if (messengerConnected && currentApi && !hasNewCookies) {
    botPaused = false;
    loginError = null;
    syncFastAttackLoop();
    pushEvent("started", `Bot started${configuredBotName ? ` (${configuredBotName})` : ""}`);
    return getStatus();
  }

  if (!activeCookieString && !hasEnvOrFileSession()) {
    messengerConnected = false;
    botPaused = true;
    loginError = "Walang naka-save na JSON cookies. Mag-upload ng JSON cookies mula sa naka-login na Facebook session sa kabilang tab.";
    throw new Error(loginError);
  }

  return loginBot();
}

function stopBot() {
  botPaused = true;
  syncFastAttackLoop();
  if (messengerConnected) {
    lastDisconnectedAt = new Date().toISOString();
    pushEvent("stopped", "Bot paused/stopped by admin");
  } else {
    pushEvent("stopped", "Bot stopped");
  }
  return getStatus();
}

function disconnectBot({ clearSession = false } = {}) {
  sessionGeneration++;
  cleanupCurrentSession();
  messengerConnected = false;
  botPaused = true;
  loginInProgress = false;
  syncFastAttackLoop();
  lastDisconnectedAt = new Date().toISOString();
  if (clearSession) {
    activeCookieString = "";
    cookieCount = 0;
    botUserID = "";
    facebookUserName = null;
  }
  pushEvent("disconnected", clearSession ? "Session cleared and bot disconnected" : "Bot disconnected");
  return getStatus();
}

function getStatus() {
  return {
    ok: true,
    bot_name: configuredBotName || null,
    facebook_uid: botUserID || configuredFacebookUid || null,
    configured_facebook_uid: configuredFacebookUid || null,
    facebook_connected: messengerConnected,
    facebook_user_name: facebookUserName || configuredBotName || null,
    session_active: messengerConnected,
    has_saved_session: Boolean(activeCookieString || hasEnvOrFileSession()),
    cookie_count: cookieCount,
    bot_running: messengerConnected && !botPaused,
    paused: botPaused,
    login_in_progress: loginInProgress,
    login_error: loginError,
    last_connected_at: lastConnectedAt,
    last_disconnected_at: lastDisconnectedAt,
    active_threads_count: activeThreads.size,
    banat_enabled: botConfig.banatEnabled,
    gc_lock_enabled: Boolean(botConfig.gcLock.enabled && botConfig.gcLock.name),
    gc_lock_thread_id: botConfig.gcLock.threadID,
    gc_rename_enabled: botConfig.gcRename.enabled,
    target_user_enabled: botConfigLib.isTargetUserRestricted(botConfig),
    fast_attack_enabled: Boolean(botConfig.fastAttack.enabled),
    updated_at: new Date().toISOString()
  };
}

function getEvents() {
  return events.slice(0, 80);
}

if (require.main === module) {
  try {
    require("./dashboard-api")(PORT, getStatus, {
      setPaused: (paused) => { botPaused = paused; syncFastAttackLoop(); },
      getPaused: () => botPaused,
      startBot,
      stopBot,
      configureSession,
      disconnectBot,
      getEvents,
      getControls,
      setBanatMode,
      updateMessengerCommands,
      updateGcLock,
      updateGcRename,
      renameLockedGc,
      resolveGcLock,
      updateTargetUser,
      resolveTargetUser,
      updateFastAttack,
      listGroupThreads
    });
  } catch (error) {
    console.error("[BANAT] dashboard API failed:", error);
  }

  if (hasEnvOrFileSession()) {
    loginBot();
  } else {
    console.log("[BANAT] No FB_COOKIES or appstate.json at startup. Waiting for dashboard session upload.");
  }
}

module.exports = {
  trafficSendMessage,
  onMessage,
  handleBanatCommand,
  getStatus,
  getEvents,
  configureSession,
  startBot,
  stopBot,
  disconnectBot,
  loginBot,
  getControls,
  setBanatMode,
  updateMessengerCommands,
  updateGcLock,
  updateGcRename,
  renameLockedGc,
  resolveGcLock,
  updateTargetUser,
  resolveTargetUser,
  updateFastAttack,
  listGroupThreads,
  setPaused: (paused) => { botPaused = Boolean(paused); syncFastAttackLoop(); },
  getPaused: () => botPaused
};
