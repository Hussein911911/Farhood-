import { randomUUID } from 'node:crypto';

const ACTIONS = new Set(['BUY', 'SELL', 'CLOSE']);
const STOP_TYPES = new Set(['price', 'pips']);
const SYMBOL_PATTERN = /^[A-Za-z0-9._#-]{1,32}$/;
const SIGNAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PayloadValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayloadValidationError';
    this.statusCode = 400;
  }
}

function optionalPositiveNumber(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new PayloadValidationError(`${fieldName} must be a finite, non-negative number or null`);
  }
  return value === 0 ? null : value;
}

function normalizeStopType(value, fieldName) {
  if (value === undefined || value === null || value === '') return 'price';
  if (typeof value !== 'string' || !STOP_TYPES.has(value.toLowerCase())) {
    throw new PayloadValidationError(`${fieldName} must be "price" or "pips"`);
  }
  return value.toLowerCase();
}

export function validateSignal(body, { maxLot = 100, idempotencyHeader } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PayloadValidationError('JSON body must be an object');
  }
  if (typeof body.secret_key !== 'string' || body.secret_key.length < 32 || body.secret_key.length > 256) {
    throw new PayloadValidationError('secret_key must be a valid API key string');
  }

  const action = typeof body.action === 'string' ? body.action.trim().toUpperCase() : '';
  if (!ACTIONS.has(action)) throw new PayloadValidationError('action must be BUY, SELL, or CLOSE');

  const sourceSymbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
  if (!SYMBOL_PATTERN.test(sourceSymbol)) {
    throw new PayloadValidationError('symbol must be 1-32 letters, digits, dots, underscores, hyphens, or # characters');
  }

  let lot = null;
  if (body.lot !== undefined && body.lot !== null) {
    if (typeof body.lot !== 'number' || !Number.isFinite(body.lot) || body.lot <= 0 || body.lot > maxLot) {
      throw new PayloadValidationError(`lot must be a number greater than 0 and no larger than ${maxLot}`);
    }
    lot = body.lot;
  }
  if (action !== 'CLOSE' && lot === null) {
    throw new PayloadValidationError('lot is required for BUY and SELL');
  }

  const stopLoss = optionalPositiveNumber(body.stop_loss, 'stop_loss');
  const takeProfit = optionalPositiveNumber(body.take_profit, 'take_profit');
  const stopLossType = normalizeStopType(body.stop_loss_type, 'stop_loss_type');
  const takeProfitType = normalizeStopType(body.take_profit_type, 'take_profit_type');
  const headerKey = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : '';
  const bodyKey = body.signal_id === undefined || body.signal_id === null ? '' : body.signal_id;
  if (bodyKey !== '' && (typeof bodyKey !== 'string' || !SIGNAL_ID_PATTERN.test(bodyKey))) {
    throw new PayloadValidationError('signal_id must be 1-128 safe ASCII letters, digits, dots, underscores, colons, or hyphens');
  }
  if (headerKey && !SIGNAL_ID_PATTERN.test(headerKey)) {
    throw new PayloadValidationError('Idempotency-Key header contains unsupported characters or is too long');
  }
  if (bodyKey && headerKey && bodyKey !== headerKey) {
    throw new PayloadValidationError('signal_id and Idempotency-Key must match when both are supplied');
  }

  let botId = null;
  if (body.bot_id !== undefined && body.bot_id !== null && body.bot_id !== '') {
    if (typeof body.bot_id !== 'string' || !UUID_PATTERN.test(body.bot_id)) {
      throw new PayloadValidationError('bot_id must be a UUID');
    }
    botId = body.bot_id;
  }

  return {
    secretKey: body.secret_key,
    signalId: bodyKey || headerKey || randomUUID(),
    botId,
    action,
    sourceSymbol,
    symbol: sourceSymbol,
    lot,
    stopLoss,
    takeProfit,
    stopLossType,
    takeProfitType,
  };
}

export function validateExecutionResult(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PayloadValidationError('JSON result body must be an object');
  }
  if (typeof body.success !== 'boolean') {
    throw new PayloadValidationError('success must be a boolean');
  }

  const result = { success: body.success };
  if (body.retcode !== undefined && body.retcode !== null) {
    if (!Number.isSafeInteger(body.retcode) || body.retcode < 0) {
      throw new PayloadValidationError('retcode must be a non-negative integer');
    }
    result.retcode = body.retcode;
  }
  for (const field of ['order', 'deal']) {
    if (body[field] !== undefined && body[field] !== null) {
      const value = String(body[field]);
      if (value.length > 32 || !/^[0-9]+$/.test(value)) {
        throw new PayloadValidationError(`${field} must be a numeric identifier of at most 32 digits`);
      }
      if (value !== '0') result[field] = value;
    }
  }
  if (body.price !== undefined && body.price !== null) {
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0) {
      throw new PayloadValidationError('price must be a non-negative finite number or null');
    }
    result.price = body.price;
  }
  if (body.executed_lot !== undefined && body.executed_lot !== null) {
    if (typeof body.executed_lot !== 'number' || !Number.isFinite(body.executed_lot)
      || body.executed_lot < 0 || body.executed_lot > 100000) {
      throw new PayloadValidationError('executed_lot must be a finite number between 0 and 100000');
    }
    result.executed_lot = body.executed_lot;
  }
  if (body.profit_loss !== undefined && body.profit_loss !== null) {
    if (typeof body.profit_loss !== 'number' || !Number.isFinite(body.profit_loss)
      || Math.abs(body.profit_loss) > 1000000000) {
      throw new PayloadValidationError('profit_loss must be a finite number between -1000000000 and 1000000000');
    }
    result.profit_loss = body.profit_loss;
  }
  if (body.profit_loss_currency !== undefined && body.profit_loss_currency !== null) {
    if (typeof body.profit_loss_currency !== 'string' || !/^[A-Za-z]{3}$/.test(body.profit_loss_currency)) {
      throw new PayloadValidationError('profit_loss_currency must be a 3-letter ISO currency code');
    }
    result.profit_loss_currency = body.profit_loss_currency.toUpperCase();
  }
  if (body.message !== undefined && body.message !== null) {
    if (typeof body.message !== 'string' || body.message.length > 500) {
      throw new PayloadValidationError('message must be a string of at most 500 characters');
    }
    result.message = body.message;
  }
  return result;
}
