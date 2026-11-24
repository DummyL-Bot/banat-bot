export interface AuthStateResponse {
  ok: boolean;
  authenticated: boolean;
  username: string | null;
  adminUsername: string;
  needsSetup: boolean;
}

export interface AuthActionResponse {
  ok: boolean;
  token?: string;
  username?: string;
  needsSetup?: boolean;
  error?: string;
}

export interface BotStatus {
  ok: boolean;
  bot_name: string | null;
  facebook_uid: string | null;
  configured_facebook_uid?: string | null;
  facebook_connected: boolean;
  facebook_user_name: string | null;
  session_active: boolean;
  has_saved_session: boolean;
  cookie_count?: number;
  bot_running: boolean;
  paused?: boolean;
  login_in_progress: boolean;
  login_error: string | null;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  active_threads_count?: number;
  banat_enabled?: boolean;
  gc_lock_enabled?: boolean;
  gc_lock_thread_id?: string | null;
  gc_rename_enabled?: boolean;
  target_user_enabled?: boolean;
  fast_attack_enabled?: boolean;
  updated_at: string;
  message?: string;
  error?: string;
}

export interface BotEvent {
  id: string;
  type: string;
  message: string;
  details?: unknown;
  timestamp: string;
}

export interface DashboardEventsResponse {
  ok: boolean;
  events: BotEvent[];
  error?: string;
}

export interface RuntimeHealthResponse {
  ok: boolean;
  runtime?: {
    uptime_seconds: number;
    node_version: string;
  };
  error?: string;
}

export interface RepoFileEntry {
  path: string;
  directory: string;
  name: string;
  size: number;
  content: string;
}

export interface RepoFilesResponse {
  ok: boolean;
  totalFiles: number;
  files: RepoFileEntry[];
  error?: string;
}

export type BanatCommandKey = "on" | "off" | "toggle" | "status" | "help";

export interface BotControlsConfig {
  banatEnabled: boolean;
  messengerCommands: Record<BanatCommandKey, boolean>;
  gcLock: {
    enabled: boolean;
    name: string;
    threadID: string | null;
    matchedName: string | null;
    resolvedAt: string | null;
  };
  gcRename: {
    enabled: boolean;
    intervalMinutes: number;
    mode: "pattern" | "rotation";
    pattern: string;
    names: string[];
    counter: number;
    rotationIndex: number;
    lastRenamedAt: string | null;
    lastName: string | null;
    lastError: string | null;
  };
  targetUser: {
    enabled: boolean;
    profileUrl: string;
    userID: string | null;
    username: string | null;
    matchedName: string | null;
    resolvedAt: string | null;
    lastError: string | null;
  };
  fastAttack: {
    enabled: boolean;
    intervalSeconds: number;
  };
  updatedAt: string | null;
}

export interface BotControlsResponse {
  ok: boolean;
  config: BotControlsConfig;
  runtime: {
    bot_running: boolean;
    banat_status: "ON" | "OFF";
    thread_overrides: number;
    gc_lock_active: boolean;
    gc_lock_resolved: boolean;
    gc_current_name: string | null;
    next_rename_at: string | null;
    preview_next_name: string | null;
    target_user_active: boolean;
    target_user_resolved: boolean;
    fast_attack_active: boolean;
    fast_attack: {
      active: boolean;
      sentCount: number;
      lastSentAt: string | null;
      lastMessage: string | null;
      lastError: string | null;
    };
    config_path: string;
  };
  error?: string;
}

export interface GroupThread {
  threadID: string;
  name: string;
}
