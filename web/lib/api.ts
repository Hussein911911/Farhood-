import type { ApiErrorPayload } from '@/lib/types';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/backend/v1/${path.replace(/^\/+/, '')}`, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/login?expired=1');
    throw new ApiError('Your session expired. Sign in again.', 401, 'unauthorized');
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as ApiErrorPayload;
  if (!response.ok) {
    throw new ApiError(payload.message || payload.error || `Request failed (${response.status})`, response.status, payload.error);
  }
  return payload as T;
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}

export function explainError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 502 || error.status === 503) return 'Backend is unavailable right now. Check the API server and database connection.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
