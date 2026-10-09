import { NextResponse } from 'next/server';
import { backendBaseUrl, isSameOriginMutation, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: 'origin_rejected' }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${backendBaseUrl()}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(70_000),
    });
    const payload = await upstream.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({
        error: 'backend_unavailable',
        message: 'The API may be waking from sleep or is temporarily unavailable. Wait a minute and try again.',
      }, { status: 502 });
    }
    if (!upstream.ok) return NextResponse.json(payload, { status: upstream.status });
    if (typeof payload.access_token !== 'string' || typeof payload.expires_at !== 'string') {
      return NextResponse.json({ error: 'invalid_backend_response' }, { status: 502 });
    }
    const maxAge = Math.floor((new Date(payload.expires_at).getTime() - Date.now()) / 1000);
    if (!Number.isFinite(maxAge) || maxAge <= 0) {
      return NextResponse.json({ error: 'invalid_backend_expiry' }, { status: 502 });
    }

    const response = NextResponse.json({
      token_type: 'Bearer',
      expires_at: payload.expires_at,
      user: payload.user,
    });
    response.cookies.set(SESSION_COOKIE, payload.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
      priority: 'high',
    });
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    return response;
  } catch {
    return NextResponse.json({ error: 'backend_unavailable', message: 'Could not reach the authentication service.' }, { status: 502 });
  }
}
