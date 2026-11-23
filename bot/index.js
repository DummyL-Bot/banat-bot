"use strict";

/*
 * BANAT-ONLY MESSENGER BOT
 * ------------------------
 * No AI. No games. No economy. No RPG. No music. No database.
 *
 * ACTIVATION:
 *   Send: !banat on
 *
 * OTHER COMMANDS:
 *   !banat off
 *   !banat toggle
 *   !banat status
 *   !banat help
 *
 * After "!banat on", Banat stays active for that thread until "!banat off".
 * BANAT_DEFAULT_ON=true can be used to start every thread in active mode.
 */

const fs = require("fs");
const path = require("path");
const { login } = require("ws3-fca");
const { getTriggerReply, getBanatConversationReply } = require("./triggers");
const { sendBanatReplyWithTyping } = require("./banat-human");
const { classifyBanatTarget, setBanatConversationMode, isBanatConversationModeActive } = require("./banat-targeting");

const PORT = Number(process.env.PORT || 10000);
const DEFAULT_ON = /^(1|true|yes|on)$/i.test(process.env.BANAT_DEFAULT_ON || "false");
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
  const parts = String(body).trim().split(/\s+/);
  const sub = (parts[1] || "status").toLowerCase();

  if (sub === "on" || sub === "enable" || sub === "start") {
    setBanatConversationMode(threadID, true, event.senderID);
    activeThreads.add(threadID);
    console.log(`[BANAT] activated thread ${threadID} by ${event.senderID || "unknown"}`);
    sendCommandReply(api, event, "banat is on. say whatever u want 😭");
    return true;
  }

  if (sub === "off" || sub === "disable" || sub === "stop") {
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
    const on = activeThreads.has(threadID) || isBanatConversationModeActive(threadID);
    sendCommandReply(api, event, on ? "banat: ON 🟢" : "banat: OFF 🔴");
    return true;
  }

  if (sub === "help") {
    sendCommandReply(api, event, "!banat on · !banat off · !banat toggle · !banat status");
    return true;
  }

  sendCommandReply(api, event, "unknown banat command. use !banat help");
  return true;
}

async function sendBanat(api, event, text) {
  return sendBanatReplyWithTyping(api, text, String(event.threadID), event.messageID || null, {
    trafficSendMessage,
    incomingText: event.body || ""
  });
}

function onMessage(api, event) {
  if (!event) return;
  if (event.type && event.type !== "message") return;
  if (botPaused) return;
  if (event.senderID && botUserID && String(event.senderID) === String(botUserID)) return;

  const body = String(event.body || "").trim();
  if (!body) return;
  if (isBanatCommand(body)) { handleBanatCommand(api, event, body); return; }

  const threadID = String(event.threadID);
  const active = activeThreads.has(threadID) || isBanatConversationModeActive(threadID);
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

  if (DEFAULT_ON) console.log("[BANAT] BANAT_DEFAULT_ON enabled.");

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
        if (DEFAULT_ON && event?.threadID && event?.senderID && String(event.senderID) !== botUserID) {
          const key = String(event.threadID);
          if (!activeThreads.has(key)) {
            activeThreads.add(key);
            setBanatConversationMode(key, true, event.senderID);
          }
        }
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
    updated_at: new Date().toISOString()
  };
}

function getEvents() {
  return events.slice(0, 80);
}

if (require.main === module) {
  try {
    require("./dashboard-api")(PORT, getStatus, {
      setPaused: (paused) => { botPaused = paused; },
      getPaused: () => botPaused,
      startBot,
      stopBot,
      configureSession,
      disconnectBot,
      getEvents
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
  setPaused: (paused) => { botPaused = Boolean(paused); },
  getPaused: () => botPaused
};
