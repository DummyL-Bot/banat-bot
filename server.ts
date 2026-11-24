import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const botController = require(path.resolve(__dirname, "bot", "index.js"));
const { createDashboardHandlers } = require(path.resolve(__dirname, "bot", "dashboard-api.js"));

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CLAIM_STORE_PATH = path.resolve("/tmp", "banat-admin-credential.json");

interface ClaimedAdminRecord {
  username: string;
  salt: string;
  hash: string;
  claimedAt: string;
}

const activeSessions = new Map<string, { username: string; expiresAt: number }>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function getConfiguredAdminUsername(): string {
  return String(process.env.ADMIN_USERNAME || "admin").trim() || "admin";
}

function getConfiguredAdminPassword(): string {
  return String(process.env.ADMIN_PASSWORD || "").trim();
}

function readClaimedAdmin(): ClaimedAdminRecord | null {
  try {
    if (!fs.existsSync(CLAIM_STORE_PATH)) return null;
    const raw = fs.readFileSync(CLAIM_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as ClaimedAdminRecord;
    if (parsed && parsed.username && parsed.salt && parsed.hash) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function constantTimeMatch(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function verifyScryptPassword(password: string, salt: string, storedHex: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHex, "hex");
  return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
}

function needsFirstRunSetup(): boolean {
  if (getConfiguredAdminPassword()) return false;
  return !readClaimedAdmin();
}

function issueSessionToken(username: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  activeSessions.set(token, {
    username,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function verifyBearerSession(req: express.Request): { username: string } | null {
  const authHeader = String(req.headers.authorization || "");
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  const session = activeSessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    activeSessions.delete(token);
    return null;
  }
  return { username: session.username };
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 12) return false;
  entry.count += 1;
  return true;
}

function clearRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

async function startServer() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "2mb" }));

  // Periodic expired session cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [token, sess] of activeSessions.entries()) {
      if (sess.expiresAt < now) activeSessions.delete(token);
    }
  }, 15 * 60 * 1000).unref();

  // Health probe
  app.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, service: "banat-only-console" });
  });

  // Single-admin auth state (no public sign-up)
  app.get("/api/auth/state", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = verifyBearerSession(req);
    res.json({
      ok: true,
      authenticated: Boolean(session),
      username: session?.username || null,
      adminUsername: getConfiguredAdminUsername(),
      needsSetup: needsFirstRunSetup()
    });
  });

  // One-time admin password claim (only active when ADMIN_PASSWORD env var is unset and no claimed hash exists)
  app.post("/api/auth/claim", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (getConfiguredAdminPassword() || readClaimedAdmin()) {
      return res.status(403).json({
        ok: false,
        error: "Admin access is already configured. Please sign in."
      });
    }

    const username = String(req.body?.username || getConfiguredAdminUsername()).trim();
    const password = String(req.body?.password || "");
    const expectedUsername = getConfiguredAdminUsername();

    if (username.toLowerCase() !== expectedUsername.toLowerCase()) {
      return res.status(400).json({
        ok: false,
        error: `Single-admin username must be "${expectedUsername}".`
      });
    }
    if (password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: "Password must be at least 8 characters."
      });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    const record: ClaimedAdminRecord = {
      username: expectedUsername,
      salt,
      hash,
      claimedAt: new Date().toISOString()
    };

    try {
      fs.writeFileSync(CLAIM_STORE_PATH, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    } catch {
      return res.status(409).json({
        ok: false,
        error: "Admin access was already claimed. Please sign in."
      });
    }

    const token = issueSessionToken(expectedUsername);
    return res.json({
      ok: true,
      token,
      username: expectedUsername,
      needsSetup: false
    });
  });

  // Single-admin login
  app.post("/api/auth/login", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const clientIp = req.ip || "unknown";
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        ok: false,
        error: "Too many login attempts. Please wait a few minutes and try again."
      });
    }

    if (needsFirstRunSetup()) {
      return res.status(409).json({
        ok: false,
        needsSetup: true,
        error: "Admin password is not configured yet. Complete initial setup first."
      });
    }

    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const envPassword = getConfiguredAdminPassword();
    const expectedUsername = getConfiguredAdminUsername();

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Username and password are required." });
    }

    if (envPassword) {
      const userOk = constantTimeMatch(username.toLowerCase(), expectedUsername.toLowerCase());
      const passOk = constantTimeMatch(password, envPassword);
      if (!userOk || !passOk) {
        return res.status(401).json({ ok: false, error: "Invalid admin credentials." });
      }
      clearRateLimit(clientIp);
      const token = issueSessionToken(expectedUsername);
      return res.json({ ok: true, token, username: expectedUsername });
    }

    const claimed = readClaimedAdmin();
    if (!claimed) {
      return res.status(409).json({ ok: false, needsSetup: true, error: "Admin setup required." });
    }

    const userOk = constantTimeMatch(username.toLowerCase(), claimed.username.toLowerCase());
    const passOk = verifyScryptPassword(password, claimed.salt, claimed.hash);
    if (!userOk || !passOk) {
      return res.status(401).json({ ok: false, error: "Invalid admin credentials." });
    }

    clearRateLimit(clientIp);
    const token = issueSessionToken(claimed.username);
    return res.json({ ok: true, token, username: claimed.username });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const authHeader = String(req.headers.authorization || "");
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) activeSessions.delete(match[1].trim());
    res.json({ ok: true });
  });

  // Mount existing bot dashboard API endpoints on the exact same origin/port
  const dashboardHandlers = createDashboardHandlers(
    botController.getStatus,
    {
      setPaused: botController.setPaused,
      getPaused: botController.getPaused,
      startBot: botController.startBot,
      stopBot: botController.stopBot,
      configureSession: botController.configureSession,
      disconnectBot: botController.disconnectBot,
      getEvents: botController.getEvents,
      getControls: botController.getControls,
      setBanatMode: botController.setBanatMode,
      updateMessengerCommands: botController.updateMessengerCommands,
      updateGcLock: botController.updateGcLock,
      updateGcRename: botController.updateGcRename,
      renameLockedGc: botController.renameLockedGc,
      resolveGcLock: botController.resolveGcLock,
      updateTargetUser: botController.updateTargetUser,
      resolveTargetUser: botController.resolveTargetUser,
      updateFastAttack: botController.updateFastAttack,
      listGroupThreads: botController.listGroupThreads
    },
    (req: express.Request) => Boolean(verifyBearerSession(req))
  );

  const ROOT_EXPORT_FILES = [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "index.html",
    "metadata.json",
    ".env.example",
    ".gitignore",
    "server.ts"
  ];
  const EXPORT_DIRS = ["src", "bot"];
  const BLOCKED_NAMES = new Set(["node_modules", ".git", "dist", ".env", "appstate.json", "cookies.json", "server.js", "banat-config.json"]);

  interface CollectedRepoFile {
    path: string;
    directory: string;
    name: string;
    size: number;
    content: string;
  }

  function collectDirectoryFiles(rootDir: string, relDir: string, out: CollectedRepoFile[]) {
    const absDir = path.resolve(rootDir, relDir);
    if (!absDir.startsWith(rootDir + path.sep) || !fs.existsSync(absDir)) return;
    const entries = fs.readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (BLOCKED_NAMES.has(entry.name) || entry.name.startsWith(".env.")) continue;
      const relPath = path.posix.join(relDir.replace(/\\/g, "/"), entry.name);
      const absPath = path.resolve(rootDir, relPath);
      if (!absPath.startsWith(rootDir + path.sep)) continue;
      if (entry.isDirectory()) {
        collectDirectoryFiles(rootDir, relPath, out);
      } else if (entry.isFile()) {
        const buf = fs.readFileSync(absPath);
        out.push({
          path: relPath,
          directory: path.posix.dirname(relPath),
          name: entry.name,
          size: buf.length,
          content: buf.toString("utf8")
        });
      }
    }
  }

  function collectAllowedRepoFiles(rootDir: string): CollectedRepoFile[] {
    const files: CollectedRepoFile[] = [];
    for (const fileName of ROOT_EXPORT_FILES) {
      const absFile = path.resolve(rootDir, fileName);
      if (absFile.startsWith(rootDir + path.sep) && fs.existsSync(absFile) && fs.statSync(absFile).isFile()) {
        const buf = fs.readFileSync(absFile);
        files.push({
          path: fileName,
          directory: "/",
          name: fileName,
          size: buf.length,
          content: buf.toString("utf8")
        });
      }
    }
    for (const dirName of EXPORT_DIRS) {
      collectDirectoryFiles(rootDir, dirName, files);
    }
    return files;
  }

  app.get("/api/dashboard/repo-files", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!verifyBearerSession(req)) {
      return res.status(401).json({ ok: false, error: "Admin authorization required" });
    }
    try {
      const rootDir = path.resolve(__dirname);
      const files = collectAllowedRepoFiles(rootDir);
      return res.json({
        ok: true,
        totalFiles: files.length,
        files
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to read repository files"
      });
    }
  });

  app.get("/api/dashboard/export-source", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!verifyBearerSession(req)) {
      return res.status(401).json({ ok: false, error: "Admin authorization required" });
    }

    try {
      const rootDir = path.resolve(__dirname);
      const files = collectAllowedRepoFiles(rootDir);
      const zip = new JSZip();

      for (const file of files) {
        zip.file(file.path, file.content);
      }

      const buffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="banat-bot-console-source.zip"');
      res.setHeader("Content-Length", String(buffer.length));
      return res.end(buffer);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to generate ZIP archive"
      });
    }
  });

  app.all("/api/dashboard/*", (req, res) => {
    dashboardHandlers.handleRequest(req, res, req.path, req.body || {});
  });

  const distDir = path.resolve(__dirname, "dist");
  const isCompiledServer = path.basename(__filename) === "server.js" && fs.existsSync(path.join(distDir, "index.html"));
  const isProduction = process.env.NODE_ENV === "production" || isCompiledServer;

  // Serve Vite middleware in dev or built static assets in production on the same origin
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[BANAT] Unified dashboard + bot server listening on :${PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[BANAT] Server failed on port ${PORT}:`, err.message);
    process.exit(1);
  });

  // If FB_COOKIES / FB_APPSTATE / appstate.json already exists on boot, attempt initial login
  if (
    String(process.env.FB_COOKIES || process.env.FB_APPSTATE || "").trim() ||
    fs.existsSync(path.join(process.cwd(), "appstate.json")) ||
    fs.existsSync(path.join(process.cwd(), "cookies.json"))
  ) {
    botController.loginBot().catch((err: unknown) => {
      console.error("[BANAT] Auto-login at startup failed:", err);
    });
  }
}

startServer().catch((err) => {
  console.error("Failed to start unified server:", err);
  process.exit(1);
});
