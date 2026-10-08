export class PaymentProviderError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'PaymentProviderError';
    this.statusCode = 503;
    this.code = 'payment_provider_unavailable';
  }
}

export class NowPaymentsClient {
  constructor({ apiKey = '', baseUrl = 'https://api.nowpayments.io/v1', fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  get configured() {
    return Boolean(this.apiKey && this.fetch);
  }

  async createPayment({ amountUsd, payCurrency, orderId, callbackUrl }) {
    if (!this.configured) throw new PaymentProviderError('NOWPayments is not configured');
    if (!callbackUrl) throw new PaymentProviderError('NOWPayments IPN callback URL is not configured');

    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/payment`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          accept: 'application/json',
        },
        body: JSON.stringify({
          price_amount: amountUsd,
          price_currency: 'usd',
          pay_currency: payCurrency,
          order_id: orderId,
          order_description: `Farhood wallet top-up ${orderId}`,
          ipn_callback_url: callbackUrl,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new PaymentProviderError('Could not reach the crypto payment provider', { cause: error });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new PaymentProviderError(`Crypto payment provider rejected the request (HTTP ${response.status})`);
    }
    if (!payload || (typeof payload.payment_id !== 'string' && typeof payload.payment_id !== 'number')
      || typeof payload.pay_address !== 'string' || !payload.pay_address.trim()
      || typeof payload.pay_amount !== 'string' && typeof payload.pay_amount !== 'number'
      || String(payload.pay_currency || '').toLowerCase() !== payCurrency.toLowerCase()) {
      throw new PaymentProviderError('Crypto payment provider returned an incomplete payment address');
    }

    const payAmount = Number(payload.pay_amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      throw new PaymentProviderError('Crypto payment provider returned an invalid payment amount');
    }
    const expiryRaw = payload.expiration_estimate_date || payload.time_limit;
    const expiresAt = expiryRaw && Number.isFinite(Date.parse(expiryRaw)) ? new Date(expiryRaw) : null;
    return {
      providerPaymentId: String(payload.payment_id),
      payAddress: payload.pay_address.trim(),
      payAmount,
      payCurrency: String(payload.pay_currency).toLowerCase(),
      status: String(payload.payment_status || 'waiting').toUpperCase(),
      expiresAt,
    };
  }
}
