import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  ListChecks,
  Lock,
  PenLine,
  Power,
  RefreshCw,
  Repeat,
  Search,
  Shuffle,
  UserCheck,
  Zap
} from "lucide-react";
import {
  fetchControls,
  fetchGroupThreads,
  renameGcNowRequest,
  resolveGcLockRequest,
  resolveTargetUserRequest,
  setBanatModeRequest,
  updateFastAttackRequest,
  updateGcLockRequest,
  updateGcRenameRequest,
  updateMessengerCommandsRequest,
  updateTargetUserRequest
} from "../api";
import type { BanatCommandKey, BotControlsResponse, GroupThread } from "../types";

interface CommandControlsProps {
  token: string;
  botRunning: boolean;
}

type Feedback = { kind: "success" | "error"; text: string } | null;

const COMMAND_ROWS: Array<{ key: BanatCommandKey; command: string; description: string }> = [
  { key: "on", command: "!banat on", description: "I-ON ang Banat mode — sasagot ang bot sa bawat mensahe." },
  { key: "off", command: "!banat off", description: "I-OFF ang Banat mode — sasagot lang kapag direktang tinawag." },
  { key: "toggle", command: "!banat toggle", description: "Baliktarin ang kasalukuyang mode (ON ↔ OFF)." },
  { key: "status", command: "!banat status", description: "Tingnan kung ON o OFF ang Banat mode." },
  { key: "help", command: "!banat help", description: "Ipakita ang listahan at gamit ng bawat command." }
];

const PATTERN_TOKENS = [
  { token: "{name}", meaning: "pangalan ng GC na naka-lock" },
  { token: "{n}", meaning: "counter (1, 2, 3…)" },
  { token: "{time}", meaning: "oras (HH:MM)" },
  { token: "{date}", meaning: "petsa (YYYY-MM-DD)" }
];

function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-blue-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function countdown(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const diff = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  if (diff === 0) return "ngayon na";
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function CommandControls({ token, botRunning }: CommandControlsProps) {
  const [data, setData] = useState<BotControlsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [now, setNow] = useState(Date.now());

  const [draftsReady, setDraftsReady] = useState(false);
  const [gcName, setGcName] = useState("");
  const [renameMode, setRenameMode] = useState<"pattern" | "rotation">("pattern");
  const [pattern, setPattern] = useState("{name} #{n}");
  const [namesText, setNamesText] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(2);
  const [targetProfileUrl, setTargetProfileUrl] = useState("");
  const [fastAttackSeconds, setFastAttackSeconds] = useState(2);

  const [threads, setThreads] = useState<GroupThread[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchControls(token);
      setData(res);
      setLoadError(null);
      if (!draftsReady) {
        setGcName(res.config.gcLock.name || "");
        setRenameMode(res.config.gcRename.mode);
        setPattern(res.config.gcRename.pattern);
        setNamesText(res.config.gcRename.names.join("\n"));
        setIntervalMinutes(res.config.gcRename.intervalMinutes);
        setTargetProfileUrl(res.config.targetUser?.profileUrl || "");
        setFastAttackSeconds(res.config.fastAttack?.intervalSeconds ?? 2);
        setDraftsReady(true);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Hindi makuha ang controls.");
    }
  }, [token, draftsReady]);

  const fastAttackActive = Boolean(data?.runtime?.fast_attack_active);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, fastAttackActive ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [load, fastAttackActive]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const run = async (key: string, fn: () => Promise<BotControlsResponse>, success: string) => {
    setBusy(key);
    setFeedback(null);
    try {
      const res = await fn();
      setData(res);
      setFeedback({ kind: "success", text: success });
    } catch (err) {
      setFeedback({ kind: "error", text: err instanceof Error ? err.message : "May error." });
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        {loadError ? (
          <span className="text-red-700">{loadError}</span>
        ) : (
          "Kinukuha ang controls…"
        )}
      </section>
    );
  }

  const { config, runtime } = data;
  const banatOn = config.banatEnabled;
  const lock = config.gcLock;
  const ren = config.gcRename;
  const tgt = config.targetUser;
  const fa = config.fastAttack;
  const faRuntime = runtime.fast_attack;
  const renameDraftChanged =
    renameMode !== ren.mode ||
    pattern !== ren.pattern ||
    namesText.split("\n").map((n) => n.trim()).filter(Boolean).join("\n") !== ren.names.join("\n") ||
    Number(intervalMinutes) !== ren.intervalMinutes;

  const saveRenameSettings = (extra: { enabled?: boolean } = {}) =>
    run(
      "rename-save",
      () =>
        updateGcRenameRequest(token, {
          mode: renameMode,
          pattern,
          names: namesText.split("\n"),
          intervalMinutes: Number(intervalMinutes) || 2,
          ...extra
        }),
      extra.enabled === undefined
        ? "Na-save ang Auto Change GC Name settings."
        : extra.enabled
        ? `Auto Change GC Name ON — every ${Number(intervalMinutes) || 2} minuto.`
        : "Auto Change GC Name OFF."
    );

  return (
    <div className="mt-6 space-y-6">
      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${
            feedback.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {feedback.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {!botRunning && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Offline ang bot. Mase-save pa rin ang settings, pero ang paghanap ng GC at pagpalit ng GC name ay
            gagana lang kapag Online na ang bot.
          </span>
        </div>
      )}

      {/* 1. Command Toggles */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Power className="h-4.5 w-4.5 text-blue-600" /> Command Toggles
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Dito mo na kokontrolin ang Banat — hindi na kailangang mag-message sa Messenger.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-2.5">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                banatOn ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
              }`}
            >
              Banat: {banatOn ? "ON 🟢" : "OFF 🔴"}
            </span>
            <Switch
              label="Banat mode"
              checked={banatOn}
              disabled={busy === "banat"}
              onChange={(next) =>
                run("banat", () => setBanatModeRequest(token, next ? "on" : "off"), next ? "Banat is ON." : "Banat is OFF.")
              }
            />
          </div>
        </div>

        <div className="mt-2 hidden grid-cols-12 gap-3 px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
          <span className="col-span-5">Command</span>
          <span className="col-span-4">Dashboard action</span>
          <span className="col-span-3 text-right">Pwede sa Messenger?</span>
        </div>

        <ul className="divide-y divide-slate-100">
          {COMMAND_ROWS.map((row) => (
            <li key={row.key} className="grid grid-cols-1 items-center gap-3 py-3.5 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-900">
                  {row.command}
                </code>
                <p className="mt-1 text-xs text-slate-600">{row.description}</p>
              </div>
              <div className="sm:col-span-4">
                {row.key === "on" || row.key === "off" || row.key === "toggle" ? (
                  <button
                    type="button"
                    disabled={busy === `cmd-${row.key}` || (row.key === "on" && banatOn) || (row.key === "off" && !banatOn)}
                    onClick={() =>
                      run(
                        `cmd-${row.key}`,
                        () => setBanatModeRequest(token, row.key as "on" | "off" | "toggle"),
                        row.key === "toggle" ? `Na-toggle: Banat is ${banatOn ? "OFF" : "ON"}.` : `Banat is ${row.key.toUpperCase()}.`
                      )
                    }
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {row.key === "toggle" ? <Repeat className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                    {row.key === "on" ? "Turn ON" : row.key === "off" ? "Turn OFF" : "Toggle"}
                  </button>
                ) : row.key === "status" ? (
                  <span className="text-xs text-slate-700">
                    {banatOn ? "banat: ON 🟢" : "banat: OFF 🔴"}
                    {lock.enabled && lock.name ? ` · GC: ${lock.matchedName || lock.name}` : " · lahat ng GC"}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowHelp((v) => !v)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50"
                  >
                    <HelpCircle className="h-3.5 w-3.5" /> {showHelp ? "Itago ang help" : "Ipakita ang help"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 sm:col-span-3 sm:justify-end">
                <span className="text-xs text-slate-500 sm:hidden">Pwede sa Messenger?</span>
                <Switch
                  label={`Payagan ang ${row.command} sa Messenger`}
                  checked={config.messengerCommands[row.key]}
                  disabled={busy === `msg-${row.key}`}
                  onChange={(next) =>
                    run(
                      `msg-${row.key}`,
                      () => updateMessengerCommandsRequest(token, { [row.key]: next }),
                      next
                        ? `Gagana na ulit ang ${row.command} kapag tinype sa Messenger.`
                        : `Hindi na sasagot ang bot sa ${row.command} sa Messenger.`
                    )
                  }
                />
              </div>
            </li>
          ))}
        </ul>

        {showHelp && (
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-xs leading-relaxed text-blue-900">
            <p className="font-semibold">Paano gumagana:</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>
                <b>Banat ON</b> — sasagot ang bot sa bawat mensahe sa mga GC na pinapayagan (o sa naka-lock na GC lang kung
                naka-ON ang GC Auto Lock).
              </li>
              <li>
                <b>Banat OFF</b> — sasagot lang kapag direktang tinawag o ni-reply-an ang bot.
              </li>
              <li>
                <b>Pwede sa Messenger?</b> — kapag naka-OFF (default), tahimik ang bot kapag may nag-type ng command sa
                Messenger. I-ON lang kung gusto mong gumana ulit ang command doon.
              </li>
            </ul>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 2. GC Auto Lock */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Lock className="h-4 w-4 text-blue-600" /> GC Auto Lock
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Sasagot lang ang bot sa GC na ito. Hindi na sasagutin ang ibang group chats.
              </p>
            </div>
            <Switch
              label="GC Auto Lock"
              checked={lock.enabled}
              disabled={busy === "lock" || (!lock.enabled && !gcName.trim())}
              onChange={(next) =>
                run(
                  "lock",
                  () => updateGcLockRequest(token, { enabled: next, name: gcName }),
                  next ? `Naka-lock na sa "${gcName.trim()}".` : "GC Auto Lock OFF — sasagot na ulit sa lahat ng GC."
                )
              }
            />
          </div>

          <label htmlFor="gc-lock-name" className="mt-4 block text-sm font-medium text-slate-800">
            Pangalan ng GC
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="gc-lock-name"
              type="text"
              value={gcName}
              onChange={(e) => setGcName(e.target.value)}
              placeholder="hal. Tropa ng Banat (o thread ID)"
              className="block w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
            <button
              type="button"
              disabled={busy === "lock-save" || !gcName.trim() || gcName.trim() === lock.name}
              onClick={() =>
                run(
                  "lock-save",
                  () => updateGcLockRequest(token, { enabled: true, name: gcName }),
                  `Na-save at naka-lock sa "${gcName.trim()}".`
                )
              }
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              I-save
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Eksaktong pangalan ng GC (hindi case-sensitive). Pwede ring thread ID kung puro numero.
          </p>

          <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Status</dt>
              <dd className="text-right font-medium text-slate-900">
                {!lock.enabled || !lock.name
                  ? "OFF — sumasagot sa lahat ng GC"
                  : lock.threadID
                  ? "Naka-lock ✅"
                  : "Hinahanap pa ang GC… (walang sasagutin habang hindi nakikita)"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Thread ID</dt>
              <dd className="font-mono text-slate-900">{lock.threadID || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Kasalukuyang GC name</dt>
              <dd className="text-right text-slate-900">{runtime.gc_current_name || "—"}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!botRunning || !lock.enabled || busy === "resolve"}
              onClick={() => run("resolve", () => resolveGcLockRequest(token), "Tapos ang paghahanap ng GC.")}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" /> Hanapin ang GC ngayon
            </button>
            <button
              type="button"
              disabled={!botRunning || busy === "threads"}
              onClick={async () => {
                setBusy("threads");
                setFeedback(null);
                try {
                  setThreads(await fetchGroupThreads(token));
                } catch (err) {
                  setFeedback({ kind: "error", text: err instanceof Error ? err.message : "May error." });
                } finally {
                  setBusy(null);
                }
              }}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ListChecks className="h-3.5 w-3.5" /> Pumili sa listahan ng GC
            </button>
          </div>

          {threads && (
            <ul className="mt-3 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {threads.length === 0 ? (
                <li className="px-3 py-2.5 text-xs text-slate-500">Walang nakitang group chat.</li>
              ) : (
                threads.map((t) => (
                  <li key={t.threadID}>
                    <button
                      type="button"
                      onClick={() => setGcName(t.name || t.threadID)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs hover:bg-slate-50"
                    >
                      <span className="truncate font-medium text-slate-900">{t.name || "(walang pangalan)"}</span>
                      <span className="shrink-0 font-mono text-slate-500">{t.threadID}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </section>

        {/* 3. Auto Change GC Name */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <PenLine className="h-4 w-4 text-blue-600" /> Auto Change GC Name
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Papalitan ang pangalan ng naka-lock na GC every {ren.intervalMinutes} minuto.
              </p>
            </div>
            <Switch
              label="Auto Change GC Name"
              checked={ren.enabled}
              disabled={busy === "rename-save"}
              onChange={(next) => saveRenameSettings({ enabled: next })}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {(
              [
                ["pattern", "Naming pattern", PenLine],
                ["rotation", "Rotation list", Shuffle]
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRenameMode(mode)}
                className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                  renameMode === mode
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {renameMode === "pattern" ? (
            <div className="mt-4">
              <label htmlFor="gc-pattern" className="block text-sm font-medium text-slate-800">
                Pattern
              </label>
              <input
                id="gc-pattern"
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                className="mt-1.5 block w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PATTERN_TOKENS.map((t) => (
                  <button
                    key={t.token}
                    type="button"
                    title={t.meaning}
                    onClick={() => setPattern((p) => `${p}${p.endsWith(" ") || !p ? "" : " "}${t.token}`)}
                    className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-100"
                  >
                    {t.token}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {PATTERN_TOKENS.map((t) => `${t.token} = ${t.meaning}`).join(" · ")}
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <label htmlFor="gc-names" className="block text-sm font-medium text-slate-800">
                Mga pangalan (isa bawat linya)
              </label>
              <textarea
                id="gc-names"
                rows={5}
                value={namesText}
                onChange={(e) => setNamesText(e.target.value)}
                placeholder={"Tropa ng Banat\nBanat Squad\nMga Hugot Lords"}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
              <p className="mt-1.5 text-xs text-slate-500">Paikot-ikot ang bot sa listahan, isa-isa.</p>
            </div>
          )}

          <div className="mt-4 flex items-end gap-3">
            <div>
              <label htmlFor="gc-interval" className="block text-sm font-medium text-slate-800">
                Every (minuto)
              </label>
              <input
                id="gc-interval"
                type="number"
                min={1}
                max={1440}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                className="mt-1.5 block w-24 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
            <button
              type="button"
              disabled={!renameDraftChanged || busy === "rename-save"}
              onClick={() => saveRenameSettings()}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              I-save ang settings
            </button>
          </div>

          <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Susunod na pangalan</dt>
              <dd className="text-right font-medium text-slate-900">{runtime.preview_next_name || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Susunod na palit</dt>
              <dd className="tabular-nums text-slate-900">
                {ren.enabled ? countdown(runtime.next_rename_at, now) : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Huling palit</dt>
              <dd className="text-right text-slate-900">
                {ren.lastName ? `"${ren.lastName}" · ${formatTime(ren.lastRenamedAt)}` : "—"}
              </dd>
            </div>
            {ren.lastError && (
              <div className="flex justify-between gap-3 text-red-700">
                <dt>Huling error</dt>
                <dd className="text-right">{ren.lastError}</dd>
              </div>
            )}
          </dl>

          {ren.enabled && !lock.threadID && (
            <p className="mt-3 text-xs text-amber-800">
              Hihintayin munang ma-lock ang GC bago magsimulang magpalit ng pangalan.
            </p>
          )}

          <button
            type="button"
            disabled={!botRunning || !lock.threadID || busy === "rename-now"}
            onClick={() => run("rename-now", () => renameGcNowRequest(token), "Napalitan ang GC name.")}
            className="mt-4 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Palitan ngayon
          </button>
        </section>
      </div>

      {/* 4. Auto Target User & 5. Fast Attack */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 4. Auto Target User */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <UserCheck className="h-4 w-4 text-blue-600" /> Auto Target User
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Ilagay ang Facebook profile link. Siya lang ang automatic na re-reply-an ng bot kapag nag-chat siya sa targeted GC.
              </p>
            </div>
            <Switch
              label="Auto Target User"
              checked={Boolean(tgt?.enabled)}
              disabled={busy === "target-user" || (!tgt?.enabled && !targetProfileUrl.trim())}
              onChange={(next) =>
                run(
                  "target-user",
                  () => updateTargetUserRequest(token, { enabled: next, profileUrl: targetProfileUrl }),
                  next
                    ? "Auto Target User ON — siya lang ang sasagutin ng bot sa GC."
                    : "Auto Target User OFF — balik sa normal na reply rules."
                )
              }
            />
          </div>

          <label htmlFor="target-user-url" className="mt-4 block text-sm font-medium text-slate-800">
            Facebook Profile Link
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="target-user-url"
              type="text"
              value={targetProfileUrl}
              onChange={(e) => setTargetProfileUrl(e.target.value)}
              placeholder="https://www.facebook.com/profile.php?id=1000... o /username"
              className="block w-full min-h-[44px] rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
            <button
              type="button"
              disabled={
                busy === "target-save" ||
                !targetProfileUrl.trim() ||
                (targetProfileUrl.trim() === (tgt?.profileUrl || "") && Boolean(tgt?.enabled))
              }
              onClick={() =>
                run(
                  "target-save",
                  () => updateTargetUserRequest(token, { enabled: true, profileUrl: targetProfileUrl }),
                  "Na-save at naka-ON ang Auto Target User."
                )
              }
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              I-save
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Suportado: <code className="font-mono">facebook.com/profile.php?id=...</code>,{" "}
            <code className="font-mono">facebook.com/username</code>, o numeric UID.
          </p>

          <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Status</dt>
              <dd className="text-right font-medium text-slate-900">
                {!tgt?.enabled || !tgt?.profileUrl
                  ? "OFF — lahat ng allowed messages sinasagot"
                  : tgt.userID
                  ? "Naka-target ✅ (siya lang ang re-reply-an)"
                  : tgt.username
                  ? "Naka-set ang username (ima-match sa GC / pag-chat)"
                  : "Naghihintay ng valid profile link"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Target UID</dt>
              <dd className="font-mono text-slate-900">{tgt?.userID || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Username / Pangalan</dt>
              <dd className="text-right text-slate-900">
                {tgt?.matchedName || tgt?.username || "—"}
              </dd>
            </div>
            {tgt?.lastError && (
              <div className="flex justify-between gap-3 text-red-700">
                <dt>Paalala</dt>
                <dd className="text-right">{tgt.lastError}</dd>
              </div>
            )}
          </dl>

          {tgt?.enabled && !lock.enabled && (
            <p className="mt-3 text-xs text-amber-800">
              Tip: I-ON din ang <b>GC Auto Lock</b> sa itaas kung gusto mong sa iisang targeted GC lang gumana ang auto-reply.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!botRunning || !tgt?.profileUrl || busy === "target-resolve"}
              onClick={() => run("target-resolve", () => resolveTargetUserRequest(token), "Na-check ang target user profile.")}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" /> I-verify ang User ngayon
            </button>
          </div>
        </section>

        {/* 5. Fast Attack */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Zap className="h-4 w-4 text-blue-600" /> Fast Attack
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Basta-basta lang magcha-chat ang bot sa targeted GC every {fa?.intervalSeconds ?? 2} seconds kahit walang nagcha-chat at walang ni-rereply-an.
              </p>
            </div>
            <Switch
              label="Fast Attack"
              checked={Boolean(fa?.enabled)}
              disabled={busy === "fast-attack"}
              onChange={(next) =>
                run(
                  "fast-attack",
                  () =>
                    updateFastAttackRequest(token, {
                      enabled: next,
                      intervalSeconds: Number(fastAttackSeconds) || 2
                    }),
                  next
                    ? `Fast Attack ON — magcha-chat every ${Number(fastAttackSeconds) || 2}s sa targeted GC.`
                    : "Fast Attack OFF."
                )
              }
            />
          </div>

          <div className="mt-4 flex items-end gap-3">
            <div>
              <label htmlFor="fast-attack-interval" className="block text-sm font-medium text-slate-800">
                Every (segundo)
              </label>
              <input
                id="fast-attack-interval"
                type="number"
                min={1}
                max={60}
                value={fastAttackSeconds}
                onChange={(e) => setFastAttackSeconds(Number(e.target.value))}
                className="mt-1.5 block w-24 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
            <button
              type="button"
              disabled={Number(fastAttackSeconds) === (fa?.intervalSeconds ?? 2) || busy === "fast-attack-save"}
              onClick={() =>
                run(
                  "fast-attack-save",
                  () => updateFastAttackRequest(token, { intervalSeconds: Number(fastAttackSeconds) || 2 }),
                  `Na-save: every ${Number(fastAttackSeconds) || 2} segundo.`
                )
              }
              className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              I-save ang bilis
            </button>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Default: <b>2 seconds</b>. Hindi ito nag-q-quote o nagre-reply sa kahit sinong chat — tuloy-tuloy lang na nagse-send ng bagong banat message.
          </p>

          <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Status</dt>
              <dd className="text-right font-medium text-slate-900">
                {!fa?.enabled
                  ? "OFF"
                  : runtime.fast_attack_active
                  ? `ACTIVE ⚡ (every ${fa.intervalSeconds}s)`
                  : !botRunning
                  ? "Naka-ON (naghihintay maging Online ang bot)"
                  : "Naghihintay ma-lock ang targeted GC"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Targeted GC</dt>
              <dd className="text-right text-slate-900">
                {lock.enabled && lock.threadID
                  ? `${lock.matchedName || lock.name} (${lock.threadID})`
                  : lock.enabled && lock.name
                  ? `${lock.name} (hinahanap pa…)`
                  : "Walang naka-lock na GC"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Naipadalang messages</dt>
              <dd className="font-mono tabular-nums text-slate-900">{faRuntime?.sentCount ?? 0}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Huling message</dt>
              <dd className="max-w-[240px] truncate text-right text-slate-900">
                {faRuntime?.lastMessage ? `"${faRuntime.lastMessage}" · ${formatTime(faRuntime.lastSentAt)}` : "—"}
              </dd>
            </div>
            {faRuntime?.lastError && (
              <div className="flex justify-between gap-3 text-red-700">
                <dt>Huling error</dt>
                <dd className="text-right">{faRuntime.lastError}</dd>
              </div>
            )}
          </dl>

          {fa?.enabled && (!lock.enabled || !lock.threadID) && (
            <p className="mt-3 text-xs text-amber-800">
              I-ON at i-lock muna ang targeted GC sa <b>GC Auto Lock</b> sa itaas para magsimulang mag-send ang Fast Attack.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
