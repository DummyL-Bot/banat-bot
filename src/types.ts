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
