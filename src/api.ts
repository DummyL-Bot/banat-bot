import type {
  AuthActionResponse,
  AuthStateResponse,
  BotStatus,
  DashboardEventsResponse,
  RepoFilesResponse,
  RuntimeHealthResponse
} from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(res.ok ? "Invalid server response" : `Server error (${res.status})`);
  }
}

function authHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchAuthState(token: string | null): Promise<AuthStateResponse> {
  const res = await fetch("/api/auth/state", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store"
  });
  return parseJson<AuthStateResponse>(res);
}

export async function claimAdminAccount(username: string, password: string): Promise<AuthActionResponse> {
  const res = await fetch("/api/auth/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await parseJson<AuthActionResponse>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to set admin password");
  }
  return data;
}

export async function loginAdmin(username: string, password: string): Promise<AuthActionResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await parseJson<AuthActionResponse>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Invalid admin credentials");
  }
  return data;
}

export async function logoutAdmin(token: string | null): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    headers: authHeaders(token)
  }).catch(() => {});
}

export async function fetchDashboardStatus(token: string): Promise<BotStatus> {
  const res = await fetch("/api/dashboard/status", {
    headers: authHeaders(token),
    cache: "no-store"
  });
  const data = await parseJson<BotStatus>(res);
  if (!res.ok) {
    throw new Error(data.error || `Failed to load status (${res.status})`);
  }
  return data;
}

export async function fetchDashboardEvents(token: string): Promise<BotEventList> {
  const res = await fetch("/api/dashboard/events", {
    headers: authHeaders(token),
    cache: "no-store"
  });
  const data = await parseJson<DashboardEventsResponse>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to load events");
  }
  return data.events || [];
}

type BotEventList = DashboardEventsResponse["events"];

export async function fetchDashboardHealth(token: string): Promise<RuntimeHealthResponse> {
  const res = await fetch("/api/dashboard/health", {
    headers: authHeaders(token),
    cache: "no-store"
  });
  return parseJson<RuntimeHealthResponse>(res);
}

export async function connectBotSession(
  token: string,
  payload: { botName: string; facebookUid: string; cookies: string; autoStart?: boolean }
): Promise<BotStatus> {
  const res = await fetch("/api/dashboard/connect-session", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload)
  });
  const data = await parseJson<BotStatus>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to save session");
  }
  return data;
}

export async function startBotRequest(
  token: string,
  payload?: { botName?: string; facebookUid?: string; cookies?: string }
): Promise<BotStatus> {
  const res = await fetch("/api/dashboard/bot/start", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload || {})
  });
  const data = await parseJson<BotStatus>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to start bot");
  }
  return data;
}

export async function stopBotRequest(token: string): Promise<BotStatus> {
  const res = await fetch("/api/dashboard/bot/stop", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({})
  });
  const data = await parseJson<BotStatus>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to stop bot");
  }
  return data;
}

export async function disconnectBotRequest(token: string, clearSession = false): Promise<BotStatus> {
  const res = await fetch("/api/dashboard/disconnect", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ clearSession })
  });
  const data = await parseJson<BotStatus>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to disconnect bot");
  }
  return data;
}

export async function downloadSourceZip(token: string): Promise<void> {
  const res = await fetch("/api/dashboard/export-source", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) {
    const errText = await res.text();
    let msg = `Failed to download source ZIP (${res.status})`;
    try {
      const parsed = JSON.parse(errText) as { error?: string };
      if (parsed?.error) msg = parsed.error;
    } catch {
      // ignore non-JSON error
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "banat-bot-console-source.zip";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchRepoFiles(token: string): Promise<RepoFilesResponse> {
  const res = await fetch("/api/dashboard/repo-files", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const data = await parseJson<RepoFilesResponse>(res);
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Failed to load repository files (${res.status})`);
  }
  return data;
}
