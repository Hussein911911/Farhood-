export function formatCurrency(value: number, currency = 'USD', maximumFractionDigits = 2) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits,
      minimumFractionDigits: Math.min(maximumFractionDigits, 2),
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${value.toFixed(maximumFractionDigits)} ${currency}`;
  }
}

export function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(Number.isFinite(value) ? value : 0);
}

export function formatDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }).format(date);
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return 'No heartbeat yet';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'No heartbeat yet';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function isBridgeOnline(lastSeenAt: string | null, status: string, staleMs = 45000) {
  if (status !== 'CONNECTED' || !lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() <= staleMs;
}
