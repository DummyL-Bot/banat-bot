import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, FileCode, Folder, RefreshCw, Search } from "lucide-react";
import { fetchRepoFiles } from "../api";
import type { RepoFileEntry } from "../types";

interface RepoExplorerProps {
  token: string;
  onDownloadZip: () => void;
  downloadingZip: boolean;
}

const FILE_PURPOSES: Record<string, string> = {
  "package.json": "Project dependencies (express, ws3-fca, react, vite) at start/build scripts.",
  "tsconfig.json": "TypeScript compiler configuration para sa client at server.",
  "vite.config.ts": "Vite + Tailwind v4 bundler configuration.",
  "index.html": "HTML entry point ng unified dashboard app.",
  "metadata.json": "App metadata at title descriptor.",
  ".env.example": "Template ng server environment variables (ADMIN_USERNAME, ADMIN_PASSWORD, etc.).",
  ".gitignore": "Mga ignored build/secret files sa Git.",
  "server.ts": "Unified Express server (port 3000) na nagse-serve ng dashboard UI, single-admin auth, at /api/dashboard/* endpoints.",
  "bot/package.json": "CommonJS marker para siguradong CommonJS ang pag-load ng Node sa mga bot/*.js files.",
  "bot/index.js": "Main Banat bot controller, ws3-fca Messenger login, dashboard controls (Banat mode, GC Auto Lock, Auto Change GC Name), at session/start/stop state.",
  "bot/bot-config.js": "Dashboard settings (Banat ON/OFF, Messenger command switches, GC lock, GC rename) na naka-save sa banat-config.json.",
  "bot/bot-config.test.js": "Tests para sa GC lock, 2-minute rename, at naka-OFF na Messenger commands (npm test).",
  "src/components/CommandControls.tsx": "Commands & GC tab: command toggles, GC Auto Lock, at Auto Change GC Name.",
  "bot/dashboard-api.js": "HTTP/API handlers para sa /api/dashboard/status, start, stop, connect-session, events, at disconnect.",
  "bot/triggers.js": "Orihinal na trigger groups (bot, trash-talk, jaiden) at lahat ng banat reply pools.",
  "bot/banat-human.js": "Human-like typing indicator, delay calculation, at reaction sender.",
  "bot/banat-abbreviations.js": "Tagalog/English shorthand abbreviations map para sa humanizer.",
  "bot/banat-memory.js": "Recent reply memory per thread para maiwasan ang paulit-ulit na sagot.",
  "bot/banat-randomizer.js": "Weighted randomizer para sa pagpili ng replies.",
  "bot/banat-social.js": "Social context & timing multiplier helper.",
  "bot/banat-targeting.js": "Thread conversation mode (!banat on/off) at direct-address/mention classifier.",
  "bot/english-vocabulary.js": "Vocabulary helpers para sa human-mimic.",
  "bot/human-delay.js": "Dynamic reading/thinking/typing delay calculator.",
  "bot/human-mimic.js": "Natural typo, spacing, at casing variation humanizer.",
  "bot/human-typing.js": "ws3-fca typing indicator wrapper.",
  "bot/slash-banats.js": "Slash command response pools.",
  "src/main.tsx": "React DOM entry point.",
  "src/App.tsx": "Root component na nagha-handle ng admin session state at login gate.",
  "src/index.css": "Tailwind v4 styles at typography tokens.",
  "src/types.ts": "TypeScript interfaces para sa auth, bot status, events, at repo files.",
  "src/api.ts": "Same-origin API client na gumagamit ng Bearer token sa memory.",
  "src/components/AdminLogin.tsx": "Single-admin sign-in at initial password claim screen (walang sign-up).",
  "src/components/Dashboard.tsx": "Main control console: status indicator, JSON cookies upload, start/stop controls, at activity log.",
  "src/components/BotGuide.tsx": "Step-by-step user guide, !banat commands reference, at trigger pools.",
  "src/components/RepoExplorer.tsx": "Repository structure overview at live code viewer para sa bawat file."
};

const DIR_DESCRIPTIONS: Record<string, string> = {
  "/": "Root configuration, unified Express entry point (server.ts), at HTML shell.",
  bot: "Standalone Banat Messenger bot core (CommonJS) — dito nakalagay ang ws3-fca logic, triggers, at replies.",
  src: "Frontend React + TypeScript entry files, API client, at shared types.",
  "src/components": "Modular UI views ng dashboard (AdminLogin, Dashboard, BotGuide, RepoExplorer)."
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function RepoExplorer({ token, onDownloadZip, downloadingZip }: RepoExplorerProps) {
  const [files, setFiles] = useState<RepoFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>("server.ts");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRepoFiles(token);
      setFiles(data.files);
      if (data.files.length > 0 && !data.files.some((f) => f.path === selectedPath)) {
        setSelectedPath(data.files[0].path);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hindi ma-load ang mga files ng repository.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.path.toLowerCase().includes(q) ||
        (FILE_PURPOSES[f.path] || "").toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  const groupedDirectories = useMemo(() => {
    const order = ["/", "bot", "src", "src/components"];
    const map = new Map<string, RepoFileEntry[]>();
    for (const dir of order) map.set(dir, []);
    for (const file of filteredFiles) {
      const list = map.get(file.directory) || [];
      list.push(file);
      map.set(file.directory, list);
    }
    return Array.from(map.entries()).filter(([, list]) => list.length > 0);
  }, [filteredFiles]);

  const selectedFile = useMemo(
    () => files.find((f) => f.path === selectedPath) || filteredFiles[0] || null,
    [files, filteredFiles, selectedPath]
  );

  const codeLines = useMemo(() => {
    if (!selectedFile) return [];
    return selectedFile.content.split("\n");
  }, [selectedFile]);

  const handleCopyCode = async () => {
    if (!selectedFile) return;
    try {
      await navigator.clipboard.writeText(selectedFile.content);
      setCopiedPath(selectedFile.path);
      window.setTimeout(() => {
        setCopiedPath((prev) => (prev === selectedFile.path ? null : prev));
      }, 2000);
    } catch {
      // Clipboard fallback ignored if blocked by browser permission
    }
  };

  return (
    <div className="mt-6 space-y-6">
      {/* Setup & Directory Structure Overview */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Repository Setup &amp; Directory Structure
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Kumpletong layout ng folders, filenames, at eksaktong source code para sa bawat file sa project.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={loadFiles}
              disabled={loading}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Reload Files</span>
            </button>
            <button
              type="button"
              onClick={onDownloadZip}
              disabled={downloadingZip}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{downloadingZip ? "Preparing ZIP..." : "Download Source (.zip)"}</span>
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Paano i-setup kapag ni-run locally o sa server
            </h3>
            <ol className="mt-3 space-y-2.5 text-sm text-slate-700">
              <li>
                <span className="font-mono text-xs font-semibold text-slate-900">1. Install dependencies:</span>{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
                  npm install
                </code>
              </li>
              <li>
                <span className="font-mono text-xs font-semibold text-slate-900">2. Set admin credentials (optional sa local):</span>{" "}
                Itakda ang{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
                  ADMIN_USERNAME
                </code>{" "}
                at{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
                  ADMIN_PASSWORD
                </code>{" "}
                sa environment variables (o i-claim sa unang pagbukas). Hindi kailangan ng Gemini API key.
              </li>
              <li>
                <span className="font-mono text-xs font-semibold text-slate-900">3. Development mode:</span>{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
                  npm run dev
                </code>{" "}
                (nagra-run ng <code className="font-mono text-xs">tsx server.ts</code> sa port <code className="font-mono text-xs">3000</code>).
              </li>
              <li>
                <span className="font-mono text-xs font-semibold text-slate-900">4. Production build &amp; start:</span>{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-900">
                  npm run build &amp;&amp; npm start
                </code>{" "}
                (nagbu-build ng <code className="font-mono text-xs">dist/</code> at <code className="font-mono text-xs">server.js</code>).
              </li>
            </ol>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Mga Directories sa Repository
            </h3>
            <dl className="mt-3 divide-y divide-slate-100 text-sm">
              {Object.entries(DIR_DESCRIPTIONS).map(([dir, desc]) => (
                <div key={dir} className="py-2 first:pt-0 last:pb-0">
                  <dt className="font-mono text-xs font-semibold text-slate-900">
                    {dir === "/" ? "/ (root)" : `${dir}/`}
                  </dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-slate-600">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Interactive Directory Tree + Full File Code Viewer */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left File Tree Sidebar */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/50 p-4">
            <div className="flex items-center justify-between gap-2 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Files &amp; Directories
              </h3>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {files.length} files
              </span>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search file name..."
                className="block w-full min-h-[38px] rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>

            {loading ? (
              <div className="space-y-2 py-4">
                <div className="h-7 rounded bg-slate-200/70" />
                <div className="h-7 rounded bg-slate-200/70" />
                <div className="h-7 rounded bg-slate-200/70" />
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {error}
              </div>
            ) : groupedDirectories.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">
                Walang tumugmang file sa "{searchQuery}".
              </p>
            ) : (
              <div className="max-h-[540px] space-y-4 overflow-y-auto pr-1">
                {groupedDirectories.map(([dir, dirFiles]) => (
                  <div key={dir}>
                    <div className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold text-slate-500">
                      <Folder className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-mono">{dir === "/" ? "/ (root)" : `${dir}/`}</span>
                    </div>
                    <ul className="space-y-0.5">
                      {dirFiles.map((file) => {
                        const isSelected = selectedFile?.path === file.path;
                        return (
                          <li key={file.path}>
                            <button
                              type="button"
                              onClick={() => setSelectedPath(file.path)}
                              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                                isSelected
                                  ? "bg-blue-600 text-white font-medium"
                                  : "text-slate-700 hover:bg-slate-200/70 hover:text-slate-900"
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <FileCode
                                  className={`h-3.5 w-3.5 shrink-0 ${
                                    isSelected ? "text-blue-100" : "text-slate-400"
                                  }`}
                                />
                                <span className="truncate font-mono">{file.name}</span>
                              </span>
                              <span
                                className={`shrink-0 font-mono text-[11px] tabular-nums ${
                                  isSelected ? "text-blue-100" : "text-slate-400"
                                }`}
                              >
                                {formatBytes(file.size)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right File Code Viewer */}
          <div className="lg:col-span-8 flex flex-col min-w-0">
            {selectedFile ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-900 break-all">
                        {selectedFile.path}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        {codeLines.length} lines
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        {formatBytes(selectedFile.size)}
                      </span>
                    </div>
                    {FILE_PURPOSES[selectedFile.path] && (
                      <p className="mt-1 text-xs text-slate-600">
                        {FILE_PURPOSES[selectedFile.path]}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0"
                  >
                    {copiedPath === selectedFile.path ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-green-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="max-h-[600px] overflow-auto bg-slate-950 text-slate-100">
                  <table className="w-full border-collapse font-mono text-xs leading-5">
                    <tbody>
                      {codeLines.map((line, index) => (
                        <tr key={index} className="hover:bg-slate-900/80">
                          <td className="select-none border-r border-slate-800 px-3 py-0.5 text-right text-slate-500 tabular-nums align-top w-12">
                            {index + 1}
                          </td>
                          <td className="px-4 py-0.5 whitespace-pre text-slate-100">
                            {line || " "}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-12 text-sm text-slate-500">
                Pumili ng file sa kaliwa para makita ang kumpletong code nito.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
