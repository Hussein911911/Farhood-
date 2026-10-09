import { randomUUID } from 'node:crypto';
import { generateApiKey, hashApiKey } from '../security/secrets.js';

export class ApiKeyService {
  constructor({ repository, apiKeyPepper }) {
    this.repository = repository;
    this.apiKeyPepper = apiKeyPepper;
  }

  hashIncoming(secret) {
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256) return null;
    return hashApiKey(secret, this.apiKeyPepper);
  }

  async createForUser(userId, { label = 'TradingView', botId = null } = {}) {
    if (typeof label !== 'string' || label.trim().length < 1 || label.trim().length > 64) {
      throw Object.assign(new Error('label must contain 1-64 characters'), { statusCode: 400, code: 'invalid_label' });
    }
    if (botId !== null && !isUuid(botId)) {
      throw Object.assign(new Error('bot_id must be a UUID'), { statusCode: 400, code: 'invalid_bot_id' });
    }
    const secret = generateApiKey();
    const key = await this.repository.createApiKey({
      id: randomUUID(),
      userId,
      botId,
      secretKeyHash: hashApiKey(secret, this.apiKeyPepper),
      keyPrefix: secret.slice(0, 12),
      label: label.trim(),
    });
    return { ...key, secret_key: secret };
  }
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
