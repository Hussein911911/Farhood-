import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/db/migrate.js';
import { createTestPool } from '../test-support/pglite-pool.js';

const migrationSource = fileURLToPath(new URL('../migrations/', import.meta.url));

test('migration grants a 15-day $10 demo trial to eligible existing users without crediting cash wallet', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'farhood-trial-migration-'));
  const beforeTrialDir = path.join(tempRoot, 'before-trial');
  const trialMigrationDir = path.join(tempRoot, 'trial-migration');
  await mkdir(beforeTrialDir);
  await mkdir(trialMigrationDir);
  for (const file of [
    '001_phase2_core.sql',
    '002_phase3_dashboard.sql',
    '003_phase4_crypto_billing_telegram.sql',
  ]) {
    await copyFile(path.join(migrationSource, file), path.join(beforeTrialDir, file));
  }
  await copyFile(
    path.join(migrationSource, '004_trial_access_and_demo_attestation.sql'),
    path.join(trialMigrationDir, '004_trial_access_and_demo_attestation.sql'),
  );

  const pool = await createTestPool();
  try {
    await runMigrations(pool, beforeTrialDir);
    const eligibleId = randomUUID();
    const previouslySubscribedId = randomUUID();
    await pool.query(
      `INSERT INTO users (id,email,password_hash) VALUES
       ($1,'eligible@example.test','hash'),($2,'previous@example.test','hash')`,
      [eligibleId, previouslySubscribedId],
    );
    await pool.query(
      `INSERT INTO subscriptions (id,user_id,tier,status,starts_at,ends_at)
       VALUES ($1,$2,'BASIC','EXPIRED',now()-interval '2 days',now()-interval '1 day')`,
      [randomUUID(), previouslySubscribedId],
    );

    await runMigrations(pool, trialMigrationDir);
    const eligible = await pool.query(
      'SELECT wallet_balance,demo_trial_credit_usd,subscription_tier FROM users WHERE id=$1',
      [eligibleId],
    );
    assert.equal(Number(eligible.rows[0].wallet_balance), 0);
    assert.equal(Number(eligible.rows[0].demo_trial_credit_usd), 10);
    const trial = await pool.query(
      'SELECT status,tier,provider,monthly_price_usd,starts_at,ends_at FROM subscriptions WHERE user_id=$1',
      [eligibleId],
    );
    assert.equal(trial.rows.length, 1);
    assert.equal(trial.rows[0].status, 'TRIAL');
    assert.equal(trial.rows[0].tier, 'BASIC');
    assert.equal(trial.rows[0].provider, 'free_trial');
    assert.equal(Number(trial.rows[0].monthly_price_usd), 0);
    assert.ok(new Date(trial.rows[0].ends_at).getTime() - Date.now() > 14 * 24 * 60 * 60 * 1000);

    const previous = await pool.query(
      'SELECT demo_trial_credit_usd FROM users WHERE id=$1',
      [previouslySubscribedId],
    );
    assert.equal(Number(previous.rows[0].demo_trial_credit_usd), 0);
    const previousSubscriptions = await pool.query(
      'SELECT COUNT(*)::int AS count FROM subscriptions WHERE user_id=$1',
      [previouslySubscribedId],
    );
    assert.equal(previousSubscriptions.rows[0].count, 1);
  } finally {
    await pool.end();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
