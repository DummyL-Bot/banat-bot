import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileJson,
  Info,
  LogOut,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Upload
} from "lucide-react";
import {
  connectBotSession,
  disconnectBotRequest,
  downloadSourceZip,
  fetchDashboardEvents,
  fetchDashboardHealth,
  fetchDashboardStatus,
  startBotRequest,
  stopBotRequest
} from "../api";
import type { BotEvent, BotStatus } from "../types";
import { BotGuide } from "./BotGuide";
import { RepoExplorer } from "./RepoExplorer";

interface DashboardProps {
  token: string;
  adminUsername: string;
  onLogout: () => void;
}

interface ParsedCookiePreview {
  valid: boolean;
  count: number;
  cUser: string | null;
  hasXs: boolean;
  error: string | null;
}

function inspectCookieText(raw: string): ParsedCookiePreview | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    let entries: Array<{ key?: string; name?: string; value?: string }> | null = null;
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.appState)
        ? parsed.appState
        : Array.isArray(parsed?.cookies)
        ? parsed.cookies
        : null;
    } else {
      entries = trimmed
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const idx = p.indexOf("=");
          if (idx <= 0) return null;
          return { key: p.slice(0, idx).trim(), value: p.slice(idx + 1).trim() };
        })
        .filter((x): x is { key: string; value: string } => Boolean(x));
    }

    if (!entries || !entries.length) {
      return {
        valid: false,
        count: 0,
        cUser: null,
        hasXs: false,
        error: "Walang nakitang cookie entries sa JSON."
      };
    }

    const map = new Map<string, string>();
    for (const item of entries) {
      const k = String(item?.key ?? item?.name ?? "").trim();
      const v = item?.value != null ? String(item.value) : "";
      if (k) map.set(k, v);
    }

    const cUser = map.get("c_user") || map.get("i_user") || null;
    const hasXs = Boolean(map.get("xs"));

    if (!cUser || !hasXs) {
      return {
        valid: false,
        count: entries.length,
        cUser,
        hasXs,
        error: "Kulang ng c_user o xs cookie. Siguraduhing naka-login ang Facebook account sa kabilang tab."
      };
    }

    return {
      valid: true,
      count: entries.length,
      cUser,
      hasXs,
      error: null
    };
  } catch {
    return {
      valid: false,
      count: 0,
      cUser: null,
      hasXs: false,
      error: "Invalid JSON format. I-upload o i-paste ang valid JSON cookies array."
    };
  }
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatUptime(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "—";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function Dashboard({ token, adminUsername, onLogout }: DashboardProps) {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [uptimeSeconds, setUptimeSeconds] = useState<number | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [botName, setBotName] = useState("");
  const [facebookUid, setFacebookUid] = useState("");
  const [cookiesText, setCookiesText] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [formInitialized, setFormInitialized] = useState(false);

  const [actionLoading, setActionLoading] = useState<"save" | "start" | "stop" | "disconnect" | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"console" | "activity" | "guides" | "repository">("console");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cookiePreview = useMemo(() => inspectCookieText(cookiesText), [cookiesText]);

  const loadAll = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        const [st, evRes, hlRes] = await Promise.all([
          fetchDashboardStatus(token),
          fetchDashboardEvents(token).catch(() => []),
          fetchDashboardHealth(token).catch(() => null)
        ]);
        setStatus(st);
        setEvents(evRes);
        if (hlRes?.runtime?.uptime_seconds != null) {
          setUptimeSeconds(hlRes.runtime.uptime_seconds);
        }
        if (!formInitialized) {
          if (st.bot_name) setBotName(st.bot_name);
          if (st.facebook_uid) setFacebookUid(st.facebook_uid);
          setFormInitialized(true);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Hindi makuha ang status mula sa backend.";
        setFeedback({ kind: "error", text: message });
        if (/authorization|401/i.test(message)) {
          onLogout();
        }
      } finally {
        setLoadingInitial(false);
        if (manual) setRefreshing(false);
      }
    },
    [token, formInitialized, onLogout]
  );

  useEffect(() => {
    loadAll(false);
  }, [loadAll]);

  // Poll backend status truthfully; faster while login_in_progress is true
  useEffect(() => {
    const intervalMs = status?.login_in_progress ? 1500 : 4000;
    const timer = window.setInterval(() => {
      loadAll(false);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [loadAll, status?.login_in_progress]);

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setFeedback(null);
    try {
      const content = await file.text();
      setCookiesText(content);
      setUploadedFileName(file.name);
      const parsed = inspectCookieText(content);
      if (parsed?.valid && parsed.cUser) {
        setFacebookUid((prev) => prev.trim() || parsed.cUser || "");
        setFeedback({
          kind: "success",
          text: `Na-load ang ${file.name} (${parsed.count} cookies · c_user: ${parsed.cUser}).`
        });
      } else if (parsed?.error) {
        setFeedback({ kind: "error", text: parsed.error });
      }
    } catch {
      setFeedback({ kind: "error", text: "Hindi mabasa ang napiling JSON file." });
    }
  };

  const handleSaveSession = async () => {
    setFeedback(null);
    if (!cookiesText.trim() && !status?.has_saved_session) {
      setFeedback({
        kind: "error",
        text: "Mag-upload o mag-paste muna ng valid JSON cookies mula sa naka-login na Facebook tab."
      });
      return;
    }
    if (cookiePreview && !cookiePreview.valid) {
      setFeedback({ kind: "error", text: cookiePreview.error || "Hindi valid ang JSON cookies." });
      return;
    }

    setActionLoading("save");
    try {
      const res = await connectBotSession(token, {
        botName: botName.trim(),
        facebookUid: facebookUid.trim(),
        cookies: cookiesText.trim()
      });
      setStatus(res);
      if (res.facebook_uid && !facebookUid.trim()) {
        setFacebookUid(res.facebook_uid);
      }
      setFeedback({
        kind: "success",
        text: res.message || "Na-save ang Bot Name, Facebook UID, at JSON cookies."
      });
      loadAll(false);
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Nabigong i-save ang session."
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartBot = async () => {
    setFeedback(null);
    if (!cookiesText.trim() && !status?.has_saved_session) {
      setFeedback({
        kind: "error",
        text: "Mag-upload muna ng JSON cookies mula sa naka-login na Facebook account bago i-start ang bot."
      });
      return;
    }
    if (cookiesText.trim() && cookiePreview && !cookiePreview.valid) {
      setFeedback({ kind: "error", text: cookiePreview.error || "Hindi valid ang JSON cookies." });
      return;
    }

    setActionLoading("start");
    try {
      const payload =
        cookiesText.trim() || botName.trim() || facebookUid.trim()
          ? {
              botName: botName.trim() || undefined,
              facebookUid: facebookUid.trim() || undefined,
              cookies: cookiesText.trim() || undefined
            }
          : undefined;

      const res = await startBotRequest(token, payload);
      setStatus(res);
      if (res.facebook_uid && !facebookUid.trim()) {
        setFacebookUid(res.facebook_uid);
      }

      if (res.facebook_connected && res.bot_running) {
        setFeedback({ kind: "success", text: res.message || "Online na ang bot." });
      } else if (res.login_in_progress) {
        setFeedback({
          kind: "success",
          text: "Kumokonekta sa Facebook... Hintayin ang kumpirmasyon ng backend status."
        });
      } else if (res.login_error) {
        setFeedback({ kind: "error", text: res.login_error });
      } else {
        setFeedback({
          kind: "error",
          text: "Hindi pa kumpirmadong online ang bot mula sa backend."
        });
      }
      loadAll(false);
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Nabigong i-start ang bot."
      });
      loadAll(false);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStopBot = async () => {
    setFeedback(null);
    setActionLoading("stop");
    try {
      const res = await stopBotRequest(token);
      setStatus(res);
      setFeedback({ kind: "success", text: res.message || "Naka-stop na ang bot." });
      loadAll(false);
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Nabigong i-stop ang bot."
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = async () => {
    setFeedback(null);
    setActionLoading("disconnect");
    try {
      const res = await disconnectBotRequest(token, true);
      setStatus(res);
      setCookiesText("");
      setUploadedFileName(null);
      setFeedback({ kind: "success", text: res.message || "Na-disconnect ang session." });
      loadAll(false);
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Nabigong i-disconnect ang session."
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadZip = async () => {
    setFeedback(null);
    setDownloadingZip(true);
    try {
      await downloadSourceZip(token);
      setFeedback({
        kind: "success",
        text: "Na-download ang banat-bot-console-source.zip."
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Nabigong i-download ang source ZIP."
      });
    } finally {
      setDownloadingZip(false);
    }
  };

  // Truthful status strictly from backend GET /api/dashboard/status
  const derivedState = useMemo(() => {
    if (!status) {
      return {
        key: "loading",
        label: "Checking",
        dotClass: "bg-slate-400",
        textClass: "text-slate-700",
        summary: "Kinukuha ang tunay na status mula sa backend..."
      };
    }
    if (status.login_in_progress) {
      return {
        key: "connecting",
        label: "Connecting",
        dotClass: "bg-amber-500",
        textClass: "text-amber-700",
        summary: "Sinusubukang mag-login sa Facebook..."
      };
    }
    if (status.facebook_connected && status.bot_running) {
      return {
        key: "online",
        label: "Online",
        dotClass: "bg-green-600",
        textClass: "text-green-700",
        summary: "Kumpirmadong konektado sa Messenger at aktibo ang auto-banat."
      };
    }
    if (status.login_error) {
      return {
        key: "error",
        label: "Error",
        dotClass: "bg-red-600",
        textClass: "text-red-700",
        summary: status.login_error
      };
    }
    if (status.facebook_connected && !status.bot_running) {
      return {
        key: "paused",
        label: "Paused / Offline",
        dotClass: "bg-amber-500",
        textClass: "text-amber-700",
        summary: "Nakakonekta ang session pero naka-stop ang bot replies."
      };
    }
    return {
      key: "offline",
      label: "Offline",
      dotClass: "bg-slate-400",
      textClass: "text-slate-700",
      summary: status.has_saved_session
        ? "May naka-save na session. Pindutin ang Start Bot para kumonekta."
        : "Walang aktibong Facebook session. Mag-upload ng JSON cookies."
    };
  }, [status]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Three-zone single-row Top Bar Contract */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 md:gap-8 px-4 py-3.5 sm:px-6">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("console");
            }}
            className="text-base font-semibold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Banat Console
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveTab("console")}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeTab === "console"
                  ? "text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Controls
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("activity")}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeTab === "activity"
                  ? "text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Activity Log
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("guides")}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeTab === "guides"
                  ? "text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Guides
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("repository")}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                activeTab === "repository"
                  ? "text-slate-900 underline underline-offset-8 decoration-2 decoration-blue-600"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Repository
            </button>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
        <nav
          aria-label="Mobile navigation"
          className="flex md:hidden items-center gap-4 overflow-x-auto border-t border-slate-100 px-4 py-2 text-xs font-medium"
        >
          {(
            [
              ["console", "Controls"],
              ["activity", "Activity Log"],
              ["guides", "Guides"],
              ["repository", "Repository"]
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`whitespace-nowrap shrink-0 py-1.5 transition-colors ${
                activeTab === key
                  ? "text-blue-600 font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
        {/* Status Summary Bar (Truthful backend state only) */}
        <section
          aria-label="Confirmed bot status"
          className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 rounded-full ${derivedState.dotClass}`}
                  />
                  <span className={`text-base font-semibold ${derivedState.textClass}`}>
                    {derivedState.label}
                  </span>
                </div>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="text-sm text-slate-600">
                  Admin: <strong className="font-medium text-slate-900">{adminUsername}</strong>
                </span>
                {status?.bot_name && (
                  <>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="text-sm text-slate-600">
                      Bot: <strong className="font-medium text-slate-900">{status.bot_name}</strong>
                    </span>
                  </>
                )}
                {status?.facebook_uid && (
                  <>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-mono text-xs text-slate-600 tabular-nums">
                      UID {status.facebook_uid}
                    </span>
                  </>
                )}
              </div>
              <p className="mt-1.5 text-sm text-slate-600">{derivedState.summary}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleStartBot}
                disabled={
                  actionLoading !== null ||
                  Boolean(status?.login_in_progress) ||
                  Boolean(status?.facebook_connected && status?.bot_running)
                }
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4" />
                <span>{actionLoading === "start" ? "Starting..." : "Start Bot"}</span>
              </button>

              <button
                type="button"
                onClick={handleStopBot}
                disabled={actionLoading !== null || !status?.bot_running}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Square className="h-4 w-4" />
                <span>{actionLoading === "stop" ? "Stopping..." : "Stop Bot"}</span>
              </button>

              <button
                type="button"
                onClick={() => loadAll(true)}
                disabled={refreshing}
                aria-label="Refresh status"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </section>

        {/* Clear success or error feedback */}
        {(feedback || (status?.login_error && derivedState.key === "error")) && (
          <div
            role="status"
            className={`mt-4 flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm ${
              feedback?.kind === "success"
                ? "border-green-200 bg-green-50 text-green-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            {feedback?.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {feedback?.kind === "success" ? "Success" : "Action / Connection Error"}
              </p>
              <p className="mt-0.5 break-words">
                {feedback ? feedback.text : status?.login_error}
              </p>
            </div>
          </div>
        )}

        {activeTab === "console" ? (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* Left Column: Bot Name, Facebook UID, JSON Cookies Upload */}
            <section className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Facebook Session &amp; JSON Cookies
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Ilagay ang Bot Name, Facebook UID, at i-upload ang exported JSON cookies ng account.
                </p>
              </div>

              <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <p className="font-medium">Kinakailangang naka-login sa kabilang browser tab</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-amber-900">
                    Siguraduhing naka-login ang Facebook account na gagamitin ng bot sa kabilang tab ng iyong browser habang ine-export at ginagamit ang JSON cookies (may <code className="font-mono">c_user</code> at <code className="font-mono">xs</code>) para gumana nang maayos ang Messenger session.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="bot-name" className="block text-sm font-medium text-slate-800">
                    Bot Name
                  </label>
                  <input
                    id="bot-name"
                    type="text"
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                    placeholder="Hal. Banat Bot"
                    className="mt-1.5 block w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                  />
                </div>

                <div>
                  <label htmlFor="facebook-uid" className="block text-sm font-medium text-slate-800">
                    Facebook UID
                  </label>
                  <input
                    id="facebook-uid"
                    type="text"
                    inputMode="numeric"
                    value={facebookUid}
                    onChange={(e) => setFacebookUid(e.target.value)}
                    placeholder="Hal. 100012345678901"
                    className="mt-1.5 block w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15 tabular-nums"
                  />
                </div>
              </div>

              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="json-cookies" className="block text-sm font-medium text-slate-800">
                    JSON Cookies
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        handleFileUpload(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload JSON File</span>
                    </button>
                    {cookiesText && (
                      <button
                        type="button"
                        onClick={() => {
                          setCookiesText("");
                          setUploadedFileName(null);
                        }}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-red-700 whitespace-nowrap"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Clear</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Dropzone + JSON Editor */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    handleFileUpload(file);
                  }}
                  className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3 transition-colors focus-within:border-blue-600 focus-within:bg-white"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <FileJson className="h-3.5 w-3.5 text-slate-500" />
                      <span>
                        {uploadedFileName
                          ? `File: ${uploadedFileName}`
                          : "I-drag ang cookies.json dito o i-paste sa ibaba"}
                      </span>
                    </div>
                    {cookiePreview && (
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          cookiePreview.valid ? "text-green-700" : "text-red-700"
                        }`}
                      >
                        {cookiePreview.valid
                          ? `${cookiePreview.count} cookies · c_user ${cookiePreview.cUser}`
                          : "Invalid / Incomplete cookies"}
                      </span>
                    )}
                  </div>

                  <textarea
                    id="json-cookies"
                    rows={7}
                    value={cookiesText}
                    onChange={(e) => setCookiesText(e.target.value)}
                    spellCheck={false}
                    placeholder='[{"key":"c_user","value":"1000..."},{"key":"xs","value":"..."}]'
                    className="block w-full rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                {cookiePreview && !cookiePreview.valid && cookiePreview.error && (
                  <p className="mt-2 text-xs text-red-700">{cookiePreview.error}</p>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleSaveSession}
                    disabled={actionLoading !== null}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    {actionLoading === "save" ? "Saving..." : "Save Session"}
                  </button>

                  {status?.has_saved_session && (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={actionLoading !== null}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {actionLoading === "disconnect" ? "Clearing..." : "Disconnect & Clear"}
                    </button>
                  )}
                </div>

                <span className="text-xs text-slate-500">
                  {status?.has_saved_session
                    ? `May naka-save na session${status.cookie_count ? ` · ${status.cookie_count} cookies` : ""}`
                    : "Walang naka-save na session"}
                </span>
              </div>
            </section>

            {/* Right Column: Confirmed Backend Status & Quick Activity */}
            <aside className="lg:col-span-5 space-y-6">
              <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
                  <h2 className="text-base font-semibold text-slate-900">
                    Backend Status Details
                  </h2>
                  <span className="font-mono text-xs text-slate-500">GET /api/dashboard/status</span>
                </div>

                {loadingInitial && !status ? (
                  <div className="mt-4 space-y-3">
                    <div className="h-8 rounded bg-slate-100" />
                    <div className="h-8 rounded bg-slate-100" />
                    <div className="h-8 rounded bg-slate-100" />
                  </div>
                ) : (
                  <dl className="mt-2 divide-y divide-slate-100 text-sm">
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">Facebook Connected</dt>
                      <dd
                        className={`font-medium ${
                          status?.facebook_connected ? "text-green-700" : "text-slate-700"
                        }`}
                      >
                        {status?.facebook_connected ? "Yes (Connected)" : "No"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">Bot Running</dt>
                      <dd
                        className={`font-medium ${
                          status?.bot_running ? "text-green-700" : "text-slate-700"
                        }`}
                      >
                        {status?.bot_running ? "Running" : "Stopped"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">Bot Name</dt>
                      <dd className="font-medium text-slate-900 truncate max-w-[200px]">
                        {status?.bot_name || status?.facebook_user_name || "—"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">Facebook UID</dt>
                      <dd className="font-mono text-xs text-slate-900 tabular-nums">
                        {status?.facebook_uid || "—"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">Active Banat Threads</dt>
                      <dd className="font-mono text-xs text-slate-900 tabular-nums">
                        {status?.active_threads_count ?? 0}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">Server Uptime</dt>
                      <dd className="font-mono text-xs text-slate-900 tabular-nums">
                        {formatUptime(uptimeSeconds)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">Last Connected</dt>
                      <dd className="font-mono text-xs text-slate-700 tabular-nums text-right">
                        {formatTime(status?.last_connected_at)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-slate-500">Last Updated</dt>
                      <dd className="font-mono text-xs text-slate-700 tabular-nums text-right">
                        {formatTime(status?.updated_at)}
                      </dd>
                    </div>
                  </dl>
                )}

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    disabled={downloadingZip}
                    className="inline-flex w-full min-h-[42px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{downloadingZip ? "Preparing ZIP..." : "Download Project Code (.zip)"}</span>
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
                  <h2 className="text-base font-semibold text-slate-900">Recent Events</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab("activity")}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                  >
                    View all
                  </button>
                </div>

                {events.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    Wala pang naitatalang events sa session na ito.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100 text-sm">
                    {events.slice(0, 5).map((ev) => (
                      <li key={ev.id} className="py-2.5">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="font-mono uppercase tracking-wide text-slate-600">
                            {ev.type}
                          </span>
                          <span className="font-mono tabular-nums">
                            {new Date(ev.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-800 break-words">{ev.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        ) : activeTab === "guides" ? (
          <BotGuide onDownloadZip={handleDownloadZip} downloadingZip={downloadingZip} />
        ) : activeTab === "repository" ? (
          <RepoExplorer
            token={token}
            onDownloadZip={handleDownloadZip}
            downloadingZip={downloadingZip}
          />
        ) : (
          /* Full Activity Log View */
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Bot Activity Log</h2>
                <p className="mt-0.5 text-sm text-slate-600">
                  Real-time log mula sa backend (<code className="font-mono text-xs">GET /api/dashboard/events</code>).
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadAll(true)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                <span>Refresh Log</span>
              </button>
            </div>

            {events.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-slate-600">Wala pang naitatalang events sa kasalukuyan.</p>
                <button
                  type="button"
                  onClick={() => setActiveTab("console")}
                  className="mt-3 inline-flex min-h-[40px] items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  Bumalik sa Controls
                </button>
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                      <th className="py-2.5 pr-4">Time</th>
                      <th className="py-2.5 pr-4">Type</th>
                      <th className="py-2.5">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {events.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 pr-4 font-mono text-xs text-slate-500 whitespace-nowrap tabular-nums">
                          {formatTime(ev.timestamp)}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs font-medium text-slate-700 whitespace-nowrap">
                          {ev.type}
                        </td>
                        <td className="py-2.5 text-slate-800 break-words">{ev.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
