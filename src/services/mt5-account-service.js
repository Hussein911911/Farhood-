import { randomUUID } from 'node:crypto';
import { encryptMt5InvestorPassword } from '../security/encryption.js';
import { generateBridgeCredential, hashBridgeKey } from '../security/secrets.js';

export class Mt5AccountService {
  constructor({ repository, apiKeyPepper, mt5EncryptionKey }) {
    this.repository = repository;
    this.apiKeyPepper = apiKeyPepper;
    this.mt5EncryptionKey = mt5EncryptionKey;
  }

  async createForUser(userId, input) {
    const accountNumber = typeof input.account_number === 'string' ? input.account_number.trim() : '';
    const brokerServer = typeof input.broker_server === 'string' ? input.broker_server.trim() : '';
    const investorPassword = input.investor_password;
    if (!/^\d{1,32}$/.test(accountNumber)) {
      throw Object.assign(new Error('account_number must contain 1-32 digits'), {
        statusCode: 400,
        code: 'invalid_account_number',
      });
    }
    if (brokerServer.length < 1 || brokerServer.length > 128 || /[\r\n]/.test(brokerServer)) {
      throw Object.assign(new Error('broker_server must contain 1-128 characters'), {
        statusCode: 400,
        code: 'invalid_broker_server',
      });
    }
    if (investorPassword !== undefined && investorPassword !== null
      && (typeof investorPassword !== 'string' || investorPassword.length > 512)) {
      throw Object.assign(new Error('investor_password must be a string of at most 512 characters'), {
        statusCode: 400,
        code: 'invalid_investor_password',
      });
    }

    const credential = generateBridgeCredential();
    const encryptedPassword = typeof investorPassword === 'string' && investorPassword.length > 0
      ? encryptMt5InvestorPassword(investorPassword, this.mt5EncryptionKey)
      : null;
    const account = await this.repository.createMt5Account({
      id: randomUUID(),
      userId,
      accountNumber,
      brokerServer,
      investorPasswordEncrypted: encryptedPassword,
      bridgeId: credential.bridgeId,
      bridgeKeyHash: hashBridgeKey(credential.bridgeKey, this.apiKeyPepper),
    });
    return { ...account, bridge_key: credential.bridgeKey };
  }

  async rotateBridgeCredential(userId, accountId) {
    if (!isUuid(accountId)) throw Object.assign(new Error('account id must be a UUID'), { statusCode: 400, code: 'invalid_id' });
    const credential = generateBridgeCredential();
    const result = await this.repository.rotateMt5BridgeCredential(userId, accountId, {
      bridgeId: credential.bridgeId,
      bridgeKeyHash: hashBridgeKey(credential.bridgeKey, this.apiKeyPepper),
    });
    if (result.kind !== 'rotated') return result;
    return { kind: 'rotated', account: result.account, bridge_key: credential.bridgeKey };
  }

  async activateWithNewCredential(userId, accountId) {
    if (!isUuid(accountId)) throw Object.assign(new Error('account id must be a UUID'), { statusCode: 400, code: 'invalid_id' });
    const credential = generateBridgeCredential();
    const result = await this.repository.activateMt5Account(userId, accountId, {
      bridgeId: credential.bridgeId,
      bridgeKeyHash: hashBridgeKey(credential.bridgeKey, this.apiKeyPepper),
    });
    if (result.kind !== 'activated') return result;
    return { kind: 'activated', account: result.account, bridge_key: credential.bridgeKey };
  }

  deactivate(userId, accountId) {
    if (!isUuid(accountId)) throw Object.assign(new Error('account id must be a UUID'), { statusCode: 400, code: 'invalid_id' });
    return this.repository.deactivateMt5Account(userId, accountId);
  }
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
