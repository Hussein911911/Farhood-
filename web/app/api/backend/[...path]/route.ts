import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendBaseUrl, isSameOriginMutation, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ path: string[] }> };
type Handler = (request: Request, context: RouteContext) => Promise<Response>;

async function proxy(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const relativePath = path.join('/');
  if (!relativePath.startsWith('v1/')
    || relativePath === 'v1/auth/login'
    || relativePath === 'v1/auth/register'
    || relativePath === 'v1/auth/logout'
    || relativePath === 'v1/webhook'
    || relativePath === 'v1/payments/webhook'
    || relativePath === 'v1/notifications/telegram/webhook'
    || relativePath.startsWith('v1/mt5/')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
    return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  if (method !== 'GET' && !isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'origin_rejected' }, { status: 403 });
  }

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: ArrayBuffer | undefined;
  if (method !== 'GET') body = await request.arrayBuffer();
  const requestHeaders = new Headers({
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  });
  const contentType = request.headers.get('content-type');
  if (body && contentType) requestHeaders.set('content-type', contentType);

  try {
    const upstream = await fetch(`${backendBaseUrl()}/api/${relativePath}${new URL(request.url).search}`, {
      method,
      headers: requestHeaders,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (upstream.status === 204) {
      const response = new NextResponse(null, { status: 204 });
      response.headers.set('Cache-Control', 'no-store, max-age=0');
      return response;
    }
    const payload = await upstream.json().catch(() => ({ error: 'invalid_backend_response' }));
    const response = NextResponse.json(payload, { status: upstream.status });
    response.headers.set('Cache-Control', 'no-store, max-age=0');
    if (upstream.status === 401) response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch {
    return NextResponse.json({ error: 'backend_unavailable', message: 'The trading API is not reachable.' }, { status: 502 });
  }
}

export const GET: Handler = proxy;
export const POST: Handler = proxy;
export const PATCH: Handler = proxy;
export const DELETE: Handler = proxy;
