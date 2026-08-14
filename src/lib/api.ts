/**
 * Typed HTTP client for the Anush LMS backend.
 *
 * Wraps fetch to:
 *  - prefix the configured API base URL,
 *  - attach the Bearer access token from tokenStore,
 *  - unwrap the backend's { success, data, error, meta } envelope,
 *  - on a 401 (expired/invalid session) clear tokens and force re-login.
 *
 * The session is a hard 1-hour access token with NO silent refresh: when it
 * expires the user is sent back to the login screen to sign in again.
 *
 * Callers get back plain data (or a typed ApiError thrown), never the raw
 * envelope. This is the only module that knows the wire format.
 */

import { config } from './config';
import { tokenStore } from './tokenStore';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; fields?: Record<string, string> };
  meta?: PaginationMeta;
}

/** Error thrown for any non-success response; carries the backend's code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ListResult<T> {
  data: T[];
  meta: PaginationMeta;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** When false, do not attach the Authorization header (login). */
  auth?: boolean;
  /** Extra request headers (e.g. Idempotency-Key on a money write). */
  headers?: Record<string, string>;
}

/**
 * Called when an authenticated request comes back 401 (the 1-hour session has
 * expired or the token is invalid). Clears the stale token and sends the user
 * to the login screen. A full-page redirect keeps this module free of a
 * dependency on the router/store.
 */
function forceReLogin(): void {
  tokenStore.clear();
  if (window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<Envelope<T>> {
  const { method = 'GET', body, auth = true } = opts;

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };
  if (auth) {
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  // Expired or invalid session on an authenticated call: no silent refresh —
  // clear the session and require the user to log in again.
  if (res.status === 401 && auth) {
    forceReLogin();
  }

  if (res.status === 204) return { success: true } as Envelope<T>;

  const envelope = (await res.json()) as Envelope<T>;
  if (!res.ok || !envelope.success) {
    const err = envelope.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'Request failed',
      err?.fields,
    );
  }
  return envelope;
}

export const api = {
  async get<T>(path: string): Promise<T> {
    return (await request<T>(path)).data as T;
  },

  /** GET a paginated list, returning both items and pagination meta. */
  async getList<T>(path: string): Promise<ListResult<T>> {
    const env = await request<T[]>(path);
    return { data: env.data ?? [], meta: env.meta as PaginationMeta };
  },

  async post<T>(path: string, body: unknown, opts?: { auth?: boolean; headers?: Record<string, string> }): Promise<T> {
    return (await request<T>(path, { method: 'POST', body, auth: opts?.auth, headers: opts?.headers })).data as T;
  },

  async patch<T>(path: string, body: unknown): Promise<T> {
    return (await request<T>(path, { method: 'PATCH', body })).data as T;
  },

  async delete(path: string): Promise<void> {
    await request<void>(path, { method: 'DELETE' });
  },

  /**
   * Upload multipart form data (e.g. a file). Does not set Content-Type so the
   * browser adds the correct multipart boundary. Attaches the auth token and
   * forces re-login on 401, matching the JSON path.
   */
  async upload<T>(path: string, formData: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${config.apiBaseUrl}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (res.status === 401) forceReLogin();

    const envelope = (await res.json()) as Envelope<T>;
    if (!res.ok || !envelope.success) {
      const err = envelope.error;
      throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Upload failed', err?.fields);
    }
    return envelope.data as T;
  },

  /** Absolute URL for a resource behind the API base (e.g. a download link). */
  url(path: string): string {
    return `${config.apiBaseUrl}${path}`;
  },
};
