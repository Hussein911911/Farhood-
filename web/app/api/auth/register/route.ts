import { NextResponse } from 'next/server';
import { backendBaseUrl, isSameOriginMutation } from '@/lib/auth';

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
    const upstream = await fetch(`${backendBaseUrl()}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await upstream.json().catch(() => ({}));
    const response = NextResponse.json(payload, { status: upstream.status });
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    return response;
  } catch {
    return NextResponse.json({ error: 'backend_unavailable', message: 'Could not reach the authentication service.' }, { status: 502 });
  }
}
