'use client';

import type { ApiError } from '@stumps/contracts';

export type ClientResult<T> =
  { ok: true; data: T; status: number } | { ok: false; error: ApiError; status: number };

let csrfToken: string | undefined;

async function fetchCsrf(): Promise<string> {
  const res = await fetch('/api/session/csrf', { cache: 'no-store', credentials: 'same-origin' });
  const json = (await res.json()) as { token: string };
  csrfToken = json.token;
  return json.token;
}

/** Forget the cached CSRF token (call after sign-in/sign-out, which rotate it). */
export function resetCsrf() {
  csrfToken = undefined;
}

const OFFLINE: ApiError = {
  code: 'SERVICE_UNAVAILABLE',
  message: 'You appear to be offline. Check your connection and retry.',
  retryable: true,
};

/**
 * Same-origin JSON client for the BFF. Mutations carry the CSRF token and
 * retry once if it rotated. Never stores credentials in browser storage.
 */
export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<ClientResult<T>> {
  const method = init.method ?? 'GET';
  const send = async (token: string | undefined) => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && token) headers['x-csrf-token'] = token;
    return fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  };
  try {
    let token = method === 'GET' ? undefined : (csrfToken ?? (await fetchCsrf()));
    let res = await send(token);
    let json = (await res.json()) as { ok: boolean; data?: T; error?: ApiError };
    if (!json.ok && json.error?.code === 'CSRF_INVALID') {
      token = await fetchCsrf();
      res = await send(token);
      json = (await res.json()) as { ok: boolean; data?: T; error?: ApiError };
    }
    if (json.ok) return { ok: true, data: json.data as T, status: res.status };
    return { ok: false, error: json.error ?? OFFLINE, status: res.status };
  } catch {
    return { ok: false, error: OFFLINE, status: 0 };
  }
}
