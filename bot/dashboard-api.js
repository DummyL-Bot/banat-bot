"use strict";

const http = require("http");
const crypto = require("crypto");

function createDashboardHandlers(getStatus, controls = {}, authVerifier = null) {
  const key = String(process.env.ECLIPSE_DASHBOARD_API_KEY || "").trim();

  const isAuthorized = (req) => {
    if (typeof authVerifier === "function" && authVerifier(req)) {
      return true;
    }
    if (!key) return false;
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    const supplied = String(req.headers["x-eclipse-dashboard-key"] || bearer);
    const a = Buffer.from(supplied);
    const b = Buffer.from(key);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const runtime = () => ({
    watchdog: { ok: true },
    traffic: {},
    music: {},
    database: null,
    uptime_seconds: Math.floor(process.uptime()),
    node_version: process.version,
    memory: process.memoryUsage()
  });

  const handleRequest = async (req, res, pathname, body = {}) => {
    const send = (status, payload) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(payload));
    };

    if (!isAuthorized(req)) {
      return send(401, { ok: false, error: "Admin authorization required" });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/status") {
      return send(200, getStatus());
    }

    if (req.method === "GET" && pathname === "/api/dashboard/snapshot") {
      return send(200, { ok: true, snapshot: getStatus(), degraded: false });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/health") {
      return send(200, { ok: true, runtime: runtime() });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/events") {
      const eventsList = typeof controls.getEvents === "function" ? controls.getEvents() : [];
      return send(200, { ok: true, events: eventsList });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/analytics") {
      return send(200, {
        ok: true,
        analytics: {
          generated_at: new Date().toISOString(),
          hours: 24,
          economy: [],
          rpg: [],
          battles: [],
          moderation: []
        }
      });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/user") {
      return send(200, {
        ok: true,
        inspector: {
          generated_at: new Date().toISOString(),
          user: null,
          rpg: null,
          inventory: [],
          equipment: [],
          skills: [],
          spells: [],
          pets: [],
          transactions: [],
          moderation: []
        }
      });
    }

    if (req.method === "POST" && pathname === "/api/dashboard/connect-session") {
      if (typeof controls.configureSession !== "function") {
        return send(501, { ok: false, error: "Session configuration is unavailable" });
      }
      try {
        const status = controls.configureSession({
          botName: body?.botName ?? body?.bot_name,
          facebookUid: body?.facebookUid ?? body?.facebook_uid,
          cookies: body?.cookies
        });
        if (body?.autoStart && typeof controls.startBot === "function") {
          const started = await controls.startBot();
          return send(started.login_error ? 400 : 200, {
            ...started,
            ok: !started.login_error,
            error: started.login_error || undefined,
            message: started.bot_running
              ? "Na-save ang session at online na ang bot."
              : started.login_in_progress
              ? "Na-save ang session at kumokonekta na sa Facebook..."
              : started.login_error || "Hindi nakakonekta sa Facebook."
          });
        }
        return send(200, {
          ...status,
          ok: true,
          message: "Na-verify at na-save ang Bot Name, Facebook UID, at JSON cookies."
        });
      } catch (err) {
        return send(400, { ok: false, error: String(err?.message || err), status: getStatus() });
      }
    }

    if (req.method === "POST" && pathname === "/api/dashboard/bot/start") {
      try {
        if (typeof controls.startBot === "function") {
          const hasPayload = body && (body.botName !== undefined || body.bot_name !== undefined || body.facebookUid !== undefined || body.facebook_uid !== undefined || body.cookies !== undefined);
          const nextStatus = await controls.startBot(
            hasPayload
              ? {
                  botName: body?.botName ?? body?.bot_name,
                  facebookUid: body?.facebookUid ?? body?.facebook_uid,
                  cookies: body?.cookies
                }
              : undefined
          );
          if (nextStatus.login_error) {
            return send(400, {
              ...nextStatus,
              ok: false,
              error: nextStatus.login_error
            });
          }
          return send(200, {
            ...nextStatus,
            ok: true,
            message: nextStatus.bot_running
              ? "Online na ang bot at aktibo na ang auto-banat listener."
              : nextStatus.login_in_progress
              ? "Sinusubukang mag-login sa Facebook..."
              : "Hindi pa kumpirmadong online ang bot."
          });
        }

        if (typeof controls.setPaused !== "function") {
          return send(501, { ok: false, error: "Bot start control is unavailable" });
        }
        controls.setPaused(false);
        const st = getStatus();
        return send(200, { ...st, ok: true, bot_running: Boolean(st.facebook_connected) });
      } catch (err) {
        return send(400, {
          ...getStatus(),
          ok: false,
          error: String(err?.message || err)
        });
      }
    }

    if (req.method === "POST" && pathname === "/api/dashboard/bot/stop") {
      if (typeof controls.stopBot === "function") {
        const nextStatus = controls.stopBot();
        return send(200, {
          ...nextStatus,
          ok: true,
          bot_running: false,
          message: "Naka-stop na ang bot."
        });
      }
      if (typeof controls.setPaused !== "function") {
        return send(501, { ok: false, error: "Bot stop control is unavailable" });
      }
      controls.setPaused(true);
      return send(200, { ...getStatus(), ok: true, bot_running: false, message: "Naka-stop na ang bot." });
    }

    if (req.method === "POST" && pathname === "/api/dashboard/reconnect") {
      if (typeof controls.startBot !== "function") {
        return send(501, { ok: false, error: "Reconnect is unavailable" });
      }
      try {
        const nextStatus = await controls.startBot();
        if (nextStatus.login_error) {
          return send(400, { ...nextStatus, ok: false, error: nextStatus.login_error });
        }
        return send(200, { ...nextStatus, ok: true, message: "Reconnected." });
      } catch (err) {
        return send(400, { ...getStatus(), ok: false, error: String(err?.message || err) });
      }
    }

    if (req.method === "POST" && pathname === "/api/dashboard/disconnect") {
      if (typeof controls.disconnectBot !== "function") {
        return send(501, { ok: false, error: "Disconnect is unavailable" });
      }
      const nextStatus = controls.disconnectBot({ clearSession: Boolean(body?.clearSession) });
      return send(200, {
        ...nextStatus,
        ok: true,
        message: body?.clearSession ? "Disconnected at binura ang active session." : "Na-disconnect ang bot session."
      });
    }

    /* ---------------- Commands & GC controls ---------------- */

    const controlsUnavailable = (name) =>
      send(501, { ok: false, error: `${name} is unavailable on this bot build.` });

    const runControl = async (fn) => {
      try {
        const result = await fn();
        return send(200, { ...result, ok: true });
      } catch (err) {
        const fallback = typeof controls.getControls === "function" ? controls.getControls() : {};
        return send(400, { ...fallback, ok: false, error: String(err?.message || err) });
      }
    };

    if (req.method === "GET" && pathname === "/api/dashboard/controls") {
      if (typeof controls.getControls !== "function") return controlsUnavailable("Controls");
      return send(200, controls.getControls());
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/banat") {
      if (typeof controls.setBanatMode !== "function") return controlsUnavailable("Banat mode control");
      return runControl(() => controls.setBanatMode(String(body?.action || "").toLowerCase()));
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/commands") {
      if (typeof controls.updateMessengerCommands !== "function") return controlsUnavailable("Command switches");
      return runControl(() => controls.updateMessengerCommands(body?.commands || body || {}));
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/gc-lock") {
      if (typeof controls.updateGcLock !== "function") return controlsUnavailable("GC Auto Lock");
      return runControl(() => controls.updateGcLock({
        enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
        name: typeof body?.name === "string" ? body.name : undefined
      }));
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/gc-lock/resolve") {
      if (typeof controls.resolveGcLock !== "function") return controlsUnavailable("GC lookup");
      return runControl(() => controls.resolveGcLock());
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/gc-rename") {
      if (typeof controls.updateGcRename !== "function") return controlsUnavailable("Auto Change GC Name");
      return runControl(() => controls.updateGcRename({
        enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
        mode: body?.mode,
        pattern: typeof body?.pattern === "string" ? body.pattern : undefined,
        names: body?.names,
        intervalMinutes: body?.intervalMinutes
      }));
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/gc-rename/now") {
      if (typeof controls.renameLockedGc !== "function") return controlsUnavailable("GC rename");
      return runControl(() => controls.renameLockedGc({ force: true }));
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/target-user") {
      if (typeof controls.updateTargetUser !== "function") return controlsUnavailable("Auto Target User");
      return runControl(() => controls.updateTargetUser({
        enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
        profileUrl: typeof body?.profileUrl === "string" ? body.profileUrl : undefined
      }));
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/target-user/resolve") {
      if (typeof controls.resolveTargetUser !== "function") return controlsUnavailable("Target user lookup");
      return runControl(() => controls.resolveTargetUser({ force: true }));
    }

    if (req.method === "POST" && pathname === "/api/dashboard/controls/fast-attack") {
      if (typeof controls.updateFastAttack !== "function") return controlsUnavailable("Fast Attack");
      return runControl(() => controls.updateFastAttack({
        enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
        intervalSeconds: body?.intervalSeconds
      }));
    }

    if (req.method === "GET" && pathname === "/api/dashboard/threads") {
      if (typeof controls.listGroupThreads !== "function") return controlsUnavailable("Thread list");
      try {
        const threads = await controls.listGroupThreads();
        return send(200, { ok: true, threads });
      } catch (err) {
        return send(400, { ok: false, threads: [], error: String(err?.message || err) });
      }
    }

    if (req.method === "POST" && ["/api/dashboard/music/pause", "/api/dashboard/music/resume"].includes(pathname)) {
      return send(501, { ok: false, error: "This action is not supported by the standalone Banat test bot." });
    }

    return send(404, { ok: false, error: "Unsupported dashboard endpoint" });
  };

  return { handleRequest, isAuthorized };
}

function startDashboardApi(port, getStatus, controls = {}) {
  const key = String(process.env.ECLIPSE_DASHBOARD_API_KEY || "").trim();
  const origin = String(process.env.ECLIPSE_DASHBOARD_ORIGIN || "*");
  const { handleRequest } = createDashboardHandlers(getStatus, controls);

  const send = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ECLIPSE-DASHBOARD-KEY");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/" || url.pathname === "/health") {
      return send(res, 200, { ok: true, service: "banat-only", dashboard_api: Boolean(key) });
    }

    if (!url.pathname.startsWith("/api/dashboard/")) {
      return send(res, 404, { ok: false, error: "Not found" });
    }

    if (!key) {
      return send(res, 503, { ok: false, error: "Set ECLIPSE_DASHBOARD_API_KEY on this service" });
    }

    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      let body = {};
      if (raw.trim()) {
        try { body = JSON.parse(raw); } catch (_) {}
      }
      handleRequest(req, res, url.pathname, body);
    });
  });

  server.listen(port, () => console.log("[BANAT] health + dashboard API server :" + port));
  return server;
}

module.exports = startDashboardApi;
module.exports.createDashboardHandlers = createDashboardHandlers;
