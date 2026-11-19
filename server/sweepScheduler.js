/**
 * Sweep scheduler — the in-process bell for the billing sweeps
 * (built Nov 18, 2026, after the owner's own trial crossed the
 * day-4 window with no reminder email: the sweeps existed and the
 * job endpoints existed, but nothing in production ever rang).
 *
 * WHAT IT RUNS — the same two jobs the job endpoints expose,
 * composed exactly as server/billingRoutes.js composes them:
 *   wipe job:      runWipeSweep, then runCustomerAddressSweep
 *                  (the 90-day address purge rides the wipe job,
 *                  Nov 14, 2026).
 *   reminder job:  runTrialReminderSweep (the owner's two trial
 *                  emails — day 4 and final 24 hours).
 * The endpoints stay as the manual/worker door; this scheduler is
 * the automatic one, so the app needs no outside caller.
 *
 * CADENCE — a boot run shortly after listen, then one tick every
 * 6 hours. The narrowest window any sweep serves is the trial
 * reminder's final-24h window (24h wide): a 6-hour tick always
 * lands inside it at least three times, and the "24 hours before"
 * email can arrive at worst ~6 hours into that window — still
 * ~18 hours before the trial ends. The day-4 window is 72h wide.
 * The wipe (15-day grace) and the address purge (90-day
 * retention) are day-granular; 6 hours is far finer than either
 * needs. The boot run covers restarts and deploys, so a deploy
 * near a window edge can never skip a reminder.
 *
 * SAFETY —
 *   - Each sweep runs in its own try/catch: a failure is logged
 *     in the '[twin] …' style and never blocks the other sweeps,
 *     the next tick, or the server itself.
 *   - An in-process overlap guard skips a tick while the
 *     previous run is still in flight.
 *   - Across processes/machines the sweeps are effect-safe:
 *     the trial sweep claims each email in the
 *     trial_reminder_sends ledger (INSERT … ON CONFLICT) before
 *     sending, so it can never double-send; the wipe sweep's
 *     work is transactional DELETEs keyed on rows that are gone
 *     once deleted; the address purge is a single DELETE.
 *
 * KILL SWITCH — the scheduler is ON by default (the owner's
 * Nov 12, 2026 decision: reminders ON; the old opt-in gate —
 * timers that ran only when BILLING_JOBS_ENABLED was exactly
 * 'true', a flag production never carried — is what silently
 * broke this). Setting BILLING_JOBS_ENABLED to exactly 'false'
 * disables the scheduler, in the codebase's exact-string env
 * style. The job endpoints are unaffected either way.
 */
import { runWipeSweep } from './billing.js';
import { runCustomerAddressSweep } from './customerAddresses.js';
import { runTrialReminderSweep } from './trialReminders.js';

export const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SWEEP_BOOT_DELAY_MS = 30 * 1000;

const defaultSweeps = { runWipeSweep, runCustomerAddressSweep, runTrialReminderSweep };

/** The kill switch: only an exact 'false' turns the scheduler off. */
export function sweepSchedulerDisabled(env = process.env) {
  return env.BILLING_JOBS_ENABLED === 'false';
}

/**
 * One full scheduler run: the wipe job (wipe + address purge)
 * and the trial reminder job, each failure-isolated. Returns a
 * summary in the job endpoints' shape. Never throws.
 */
export async function runScheduledSweeps(pool, { now = new Date(), logger = console, sweeps = defaultSweeps } = {}) {
  const summary = { ranAt: now.toISOString(), wipe: null, customerAddresses: null, trialReminders: null, failures: [] };
  try {
    summary.wipe = await sweeps.runWipeSweep(pool, { now, logger });
  } catch (error) {
    summary.failures.push({ job: 'wipe', reason: error.message });
    logger.error(`[twin] scheduled wipe sweep failed: ${error.message}`);
  }
  try {
    summary.customerAddresses = await sweeps.runCustomerAddressSweep(pool, now);
  } catch (error) {
    summary.failures.push({ job: 'customerAddresses', reason: error.message });
    logger.error(`[twin] scheduled customer address sweep failed: ${error.message}`);
  }
  try {
    summary.trialReminders = await sweeps.runTrialReminderSweep(pool, { now, logger });
  } catch (error) {
    summary.failures.push({ job: 'trialReminders', reason: error.message });
    logger.error(`[twin] scheduled trial reminder sweep failed: ${error.message}`);
  }
  return summary;
}

/**
 * Start the scheduler: a boot run after `bootDelayMs`, then a
 * tick every `intervalMs`. Timers are unref'd so they never
 * keep a process alive on their own. Returns { stop, runOnce,
 * enabled } — runOnce is the test seam and a manual door.
 */
export function startSweepScheduler({
  getPoolFn,
  logger = console,
  sweeps = defaultSweeps,
  intervalMs = SWEEP_INTERVAL_MS,
  bootDelayMs = SWEEP_BOOT_DELAY_MS,
  env = process.env,
} = {}) {
  if (sweepSchedulerDisabled(env)) {
    logger.log('[twin] sweep scheduler disabled (BILLING_JOBS_ENABLED=false); the job endpoints remain the manual door.');
    return { enabled: false, stop() {}, async runOnce() { return null; } };
  }
  let running = false;
  let stopped = false;
  const runOnce = async (source = 'tick') => {
    if (running) {
      logger.log(`[twin] sweep scheduler: ${source} skipped — the previous run is still in flight.`);
      return null;
    }
    running = true;
    try {
      const pool = typeof getPoolFn === 'function' ? getPoolFn() : null;
      if (!pool) {
        logger.error('[twin] sweep scheduler: no database pool available — run skipped.');
        return null;
      }
      return await runScheduledSweeps(pool, { logger, sweeps });
    } catch (error) {
      // runScheduledSweeps already isolates each sweep; this is
      // the last-resort net so a scheduler run can never throw
      // into the server.
      logger.error(`[twin] sweep scheduler run failed: ${error.message}`);
      return null;
    } finally {
      running = false;
    }
  };
  const bootTimer = setTimeout(() => { if (!stopped) void runOnce('boot'); }, bootDelayMs);
  bootTimer.unref?.();
  const intervalTimer = setInterval(() => { if (!stopped) void runOnce('interval'); }, intervalMs);
  intervalTimer.unref?.();
  logger.log(`[twin] sweep scheduler enabled (boot run in ${Math.round(bootDelayMs / 1000)}s, then every ${Math.round(intervalMs / 60000)} minutes).`);
  return {
    enabled: true,
    runOnce,
    stop() {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(intervalTimer);
    },
  };
}
