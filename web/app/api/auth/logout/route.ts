import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendBaseUrl, isSameOriginMutation, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: 'origin_rejected' }, { status: 403 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    if (token) {
      await fetch(`${backendBaseUrl()}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch {
    // Local revocation is still cleared; expired server sessions cannot be reused successfully.
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}
