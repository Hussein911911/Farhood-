export const SESSION_COOKIE = 'farhood_session';

export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';

  const expectedOrigins = new Set([new URL(request.url).origin]);
  const forwardedHost = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(',')[0].trim();
  const forwardedProtocol = (request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '')).split(',')[0].trim().toLowerCase();
  if (forwardedHost && /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(forwardedHost) && ['http', 'https'].includes(forwardedProtocol)) {
    expectedOrigins.add(`${forwardedProtocol}://${forwardedHost.toLowerCase()}`);
  }
  return expectedOrigins.has(origin);
}

export function backendBaseUrl() {
  const value = process.env.BACKEND_API_URL || 'http://127.0.0.1:3000';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
    return url.origin;
  } catch {
    throw new Error('BACKEND_API_URL must be an http(s) origin.');
  }
}
