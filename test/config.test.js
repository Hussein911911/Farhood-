import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

function validConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/farhood_test',
    API_KEY_PEPPER: 'api-key-pepper-for-config-tests-0123456789',
    SESSION_PEPPER: 'session-pepper-for-config-tests-0123456789',
    MT5_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64'),
    ...overrides,
  });
}

test('defaults to a 15-day $10 non-cash trial and disables performance fees', () => {
  const config = validConfig();
  assert.equal(config.freeTrialDays, 15);
  assert.equal(config.freeTrialCreditUsd, 10);
  assert.equal(config.minWalletBalanceUsd, 5);
  assert.equal(config.performanceFeesEnabled, false);
});

test('validates trial allowance against the wallet minimum and parses fee switch explicitly', () => {
  assert.throws(() => validConfig({ MIN_WALLET_BALANCE_USD: '20' }), /FREE_TRIAL_CREDIT_USD must be at least MIN_WALLET_BALANCE_USD/);
  assert.equal(validConfig({ PERFORMANCE_FEES_ENABLED: 'true' }).performanceFeesEnabled, true);
  assert.equal(validConfig({ PERFORMANCE_FEES_ENABLED: 'off' }).performanceFeesEnabled, false);
  assert.throws(() => validConfig({ PERFORMANCE_FEES_ENABLED: 'sometimes' }), /PERFORMANCE_FEES_ENABLED must be true or false/);
});
