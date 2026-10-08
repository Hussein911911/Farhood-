import { ServiceError } from './service-error.js';

export const SUBSCRIPTION_TIERS = Object.freeze(['BASIC', 'PLUS', 'PRO']);

function priceForTier(tier, prices) {
  return Number(prices?.[tier]);
}

export class BillingService {
  constructor({ repository, config }) {
    this.repository = repository;
    this.prices = config.subscriptionPricesUsd || { BASIC: 9.99, PLUS: 19.99, PRO: 49.99 };
    this.minWalletBalanceUsd = config.minWalletBalanceUsd ?? 5;
  }

  listPlans() {
    return SUBSCRIPTION_TIERS.map((tier) => ({ tier, monthly_price_usd: priceForTier(tier, this.prices) }));
  }

  async upgrade(userId, requestedTier) {
    const tier = typeof requestedTier === 'string' ? requestedTier.toUpperCase() : '';
    if (!SUBSCRIPTION_TIERS.includes(tier)) {
      throw new ServiceError('invalid_subscription_tier', 'tier must be BASIC, PLUS, or PRO', 400);
    }
    const monthlyPrice = priceForTier(tier, this.prices);
    const result = await this.repository.upgradeSubscription({
      userId,
      tier,
      monthlyPriceUsd: monthlyPrice,
      minWalletBalanceUsd: this.minWalletBalanceUsd,
    });
    if (result.kind === 'insufficient_balance') {
      throw new ServiceError(
        'insufficient_wallet_balance',
        `This plan costs $${monthlyPrice.toFixed(2)} per month; add funds before subscribing`,
        402,
      );
    }
    if (result.kind === 'already_active') {
      throw new ServiceError('subscription_already_active', 'This plan is already active', 409);
    }
    return result;
  }

  async renewDueSubscriptions() {
    return this.repository.renewDueSubscriptions({
      subscriptionPricesUsd: this.prices,
      minWalletBalanceUsd: this.minWalletBalanceUsd,
    });
  }
}
