import { createHmac, randomBytes, randomUUID } from 'node:crypto';

function digest(value, pepper, purpose) {
  return createHmac('sha256', pepper)
    .update(`farhood:${purpose}:v1\0`, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

export function hashApiKey(secret, pepper) {
  return digest(secret, pepper, 'api-key');
}

export function hashBridgeKey(secret, pepper) {
  return digest(secret, pepper, 'mt5-bridge-key');
}

export function hashSessionToken(token, pepper) {
  return digest(token, pepper, 'session-token');
}

export function hashTelegramConnectCode(code, pepper) {
  return digest(code, pepper, 'telegram-connect-code');
}

export function generateApiKey() {
  return `tvb_${randomBytes(32).toString('base64url')}`;
}

export function generateBridgeCredential() {
  return {
    bridgeId: randomUUID(),
    bridgeKey: `mt5b_${randomBytes(32).toString('base64url')}`,
  };
}

export function generateSessionToken() {
  return `sess_${randomBytes(32).toString('base64url')}`;
}
