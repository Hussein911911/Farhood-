import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { PaymentProviderError } from './nowpayments-client.js';
import { ServiceError } from './service-error.js';

const NETWORK_CURRENCIES = Object.freeze({ TRC20: 'usdttrc20', BEP20: 'usdtbsc' });
const PAYMENT_STATUSES = new Set(['WAITING', 'CONFIRMING', 'CONFIRMED', 'SENDING', 'FINISHED', 'PARTIALLY_PAID', 'FAILED', 'REFUNDED', 'EXPIRED']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function verifyNowPaymentsSignature(payload, signature, ipnSecret) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)
    || typeof ipnSecret !== 'string' || !ipnSecret) return false;
  const expected = createHmac('sha512', ipnSecret).update(stableJson(payload), 'utf8').digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function signNowPaymentsPayload(payload, ipnSecret) {
  return createHmac('sha512', ipnSecret).update(stableJson(payload), 'utf8').digest('hex');
}

export class PaymentService {
  constructor({ repository, provider, config }) {
    this.repository = repository;
    this.provider = provider;
    this.config = config;
  }

  get enabled() {
    return Boolean(this.config.nowPaymentsEnabled && this.config.nowPaymentsIpnSecret
      && this.config.nowPaymentsCallbackUrl && this.provider?.createPayment);
  }

  async createDeposit(userId, input) {
    if (!this.enabled) throw new ServiceError('payments_not_configured', 'Crypto deposits are not configured on this server', 503);
    const amount = Number(input?.amount_usd);
    const minimum = Number(this.config.paymentMinUsd ?? 5);
    const maximum = Number(this.config.paymentMaxUsd ?? 10000);
    if (!Number.isFinite(amount) || amount * 100 !== Math.round(amount * 100)
      || amount < minimum || amount > maximum) {
      throw new ServiceError('invalid_deposit_amount', `amount_usd must be between $${minimum.toFixed(2)} and $${maximum.toFixed(2)} with at most two decimals`, 400);
    }
    const network = typeof input?.network === 'string' ? input.network.toUpperCase() : '';
    const payCurrency = NETWORK_CURRENCIES[network];
    if (!payCurrency) throw new ServiceError('invalid_payment_network', 'network must be TRC20 or BEP20', 400);

    const id = randomUUID();
    const pending = await this.repository.createPendingDeposit({
      id,
      userId,
      orderId: id,
      network,
      payCurrency,
      amountUsd: Math.round(amount * 100) / 100,
    });
    try {
      const quote = await this.provider.createPayment({
        amountUsd: pending.amount_usd,
        payCurrency,
        orderId: id,
        callbackUrl: this.config.nowPaymentsCallbackUrl,
      });
      return await this.repository.attachProviderPayment(id, quote);
    } catch (error) {
      await this.repository.failPendingDeposit(id).catch(() => undefined);
      if (error instanceof PaymentProviderError) {
        throw new ServiceError('payment_provider_unavailable', error.message, 503);
      }
      throw error;
    }
  }

  async processWebhook(payload, signature) {
    if (!this.enabled) throw new ServiceError('payments_not_configured', 'Crypto payment webhooks are not configured', 503);
    if (!verifyNowPaymentsSignature(payload, signature, this.config.nowPaymentsIpnSecret)) {
      throw new ServiceError('invalid_payment_signature', 'Payment webhook signature is invalid', 401);
    }
    const paymentId = payload.payment_id === undefined || payload.payment_id === null ? '' : String(payload.payment_id);
    const orderId = typeof payload.order_id === 'string' ? payload.order_id : '';
    const status = typeof payload.payment_status === 'string' ? payload.payment_status.toUpperCase() : '';
    const payCurrency = typeof payload.pay_currency === 'string' ? payload.pay_currency.toLowerCase() : '';
    const priceCurrency = typeof payload.price_currency === 'string' ? payload.price_currency.toUpperCase() : '';
    const priceAmount = Number(payload.price_amount);
    const receivedAmount = payload.actually_paid === undefined ? 0 : Number(payload.actually_paid);
    if (!paymentId || paymentId.length > 128 || !/^[0-9a-f-]{36}$/i.test(orderId)
      || !PAYMENT_STATUSES.has(status) || !Number.isFinite(priceAmount) || priceAmount <= 0
      || !Number.isFinite(receivedAmount) || receivedAmount < 0 || !Object.values(NETWORK_CURRENCIES).includes(payCurrency)
      || priceCurrency !== 'USD') {
      throw new ServiceError('invalid_payment_webhook', 'Payment provider payload is incomplete or unsupported', 400);
    }
    const txHashRaw = payload.payin_hash ?? payload.txid ?? payload.transaction_id ?? null;
    const txHash = typeof txHashRaw === 'string' && txHashRaw.length <= 256 ? txHashRaw : null;
    const eventKey = createHash('sha256').update(stableJson(payload), 'utf8').digest('hex');
    const result = await this.repository.applyPaymentWebhook({
      eventKey,
      orderId,
      providerPaymentId: paymentId,
      providerStatus: status,
      payCurrency,
      priceCurrency,
      priceAmount: Math.round(priceAmount * 100) / 100,
      receivedAmount,
      txHash,
      minWalletBalanceUsd: this.config.minWalletBalanceUsd ?? 5,
    });
    if (result.kind === 'not_found') throw new ServiceError('payment_not_found', 'No matching deposit exists for this payment', 404);
    if (result.kind === 'payment_mismatch') throw new ServiceError('payment_details_mismatch', 'Payment details do not match the requested deposit', 400);
    return result;
  }

  async getDeposit(userId, depositId) {
    return this.repository.getPaymentDeposit(userId, depositId);
  }
}
