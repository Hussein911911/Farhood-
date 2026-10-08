import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { generateSessionToken, hashSessionToken } from '../security/secrets.js';

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;
const DUMMY_PASSWORD_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$00112233445566778899aabbccddeeff$${'0'.repeat(KEY_LENGTH * 2)}`;

export class AuthError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizeEmail(email) {
  if (typeof email !== 'string') throw new AuthError('invalid_email', 'email is required');
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AuthError('invalid_email', 'email must be a valid address');
  }
  return normalized;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string') return false;
  const [algorithm, nText, rText, pText, saltHex, hashHex, extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || extra !== undefined || !/^[0-9a-f]{32}$/i.test(saltHex || '')
    || !/^[0-9a-f]{128}$/i.test(hashHex || '')) return false;
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: n,
    r,
    p,
    maxmem: MAXMEM,
  }));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class AuthService {
  constructor({ repository, sessionPepper, sessionTtlHours = 24 }) {
    this.repository = repository;
    this.sessionPepper = sessionPepper;
    this.sessionTtlMs = sessionTtlHours * 60 * 60 * 1000;
  }

  async register({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new AuthError('invalid_password', 'password must contain 12-128 characters');
    }
    const passwordHash = await hashPassword(password);
    return this.repository.createUser({ email: normalizedEmail, passwordHash });
  }

  async login({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    if (typeof password !== 'string' || password.length > 128) {
      throw new AuthError('invalid_credentials', 'Invalid email or password', 401);
    }
    const user = await this.repository.findUserByEmail(normalizedEmail);
    const valid = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !valid) throw new AuthError('invalid_credentials', 'Invalid email or password', 401);

    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
    await this.repository.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(token, this.sessionPepper),
      expiresAt,
    });
    return { token, expiresAt, user: this.toPublicUser(user) };
  }

  async authenticate(token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 256) return null;
    return this.repository.findUserBySessionTokenHash(hashSessionToken(token, this.sessionPepper));
  }

  async logout(token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 256) return false;
    return this.repository.revokeSession(hashSessionToken(token, this.sessionPepper));
  }

  toPublicUser(user) {
    return {
      id: user.id,
      email: user.email,
      subscription_tier: user.subscription_tier,
      wallet_balance: Number(user.wallet_balance),
      created_at: user.created_at,
    };
  }
}
