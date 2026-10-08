import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const AAD = Buffer.from('farhood:mt5-investor-password:v1', 'utf8');
const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function decodeAes256Key(encodedKey) {
  if (typeof encodedKey !== 'string' || encodedKey.length === 0) {
    throw new Error('MT5_ENCRYPTION_KEY is required');
  }
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(encodedKey)) key = Buffer.from(encodedKey, 'hex');
  else {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedKey)) {
      throw new Error('MT5_ENCRYPTION_KEY must be valid base64 or 64 hex characters');
    }
    key = Buffer.from(encodedKey, 'base64');
    if (key.toString('base64') !== encodedKey) throw new Error('MT5_ENCRYPTION_KEY base64 must be canonical');
  }
  if (key.length !== 32) {
    throw new Error('MT5_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or base64');
  }
  return key;
}

export function encryptMt5InvestorPassword(plaintext, encodedKey) {
  if (typeof plaintext !== 'string' || plaintext.length < 1 || plaintext.length > 512) {
    throw new Error('Investor password must contain 1-512 characters');
  }
  const key = decodeAes256Key(encodedKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
}

export function decryptMt5InvestorPassword(envelope, encodedKey) {
  if (!Buffer.isBuffer(envelope) || envelope.length < 1 + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Encrypted investor password has an invalid envelope');
  }
  if (envelope[0] !== VERSION) throw new Error('Unsupported encrypted investor password version');
  const key = decodeAes256Key(encodedKey);
  const ivStart = 1;
  const tagStart = ivStart + IV_LENGTH;
  const ciphertextStart = tagStart + TAG_LENGTH;
  const iv = envelope.subarray(ivStart, tagStart);
  const tag = envelope.subarray(tagStart, ciphertextStart);
  const ciphertext = envelope.subarray(ciphertextStart);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
