/**
 * @file cron.ts
 * @description Non-overlapping 60-second background cron scheduler and periodic SQLite maintenance for Serverfull mode.
 */

import worker from '../../app';
import type { Env, ExecutionContext } from '../../types';

export interface SqliteMaintenanceHandle {
  rawDb: { close(): void };
  checkpoint?(mode?: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE'): void;
  optimize?(): void;
}

/**
 * Starts the 60-second background cron scheduler with a re-entrancy lock so long-running
 * list syncs or SQLite maintenance tasks never overlap across ticks and spike CPU.
 */
export function startServerfullCronLoop(
  env: Env,
  localSqliteDb: SqliteMaintenanceHandle | null
): NodeJS.Timeout {
  let cronCounter = 0;
  let isCronRunning = false;

  return setInterval(async () => {
    if (isCronRunning) {
      console.warn('[Cron Scheduler] Previous scheduled run is still in progress; skipping overlapping tick.');
      return;
    }
    isCronRunning = true;
    try {
      cronCounter++;
      // Periodic non-blocking WAL checkpoint and snapshot retention pruning every 10 minutes
      if (localSqliteDb?.checkpoint && cronCounter % 10 === 0) {
        localSqliteDb.checkpoint('PASSIVE');
        env.SERVERFULL_SNAPSHOT_BRIDGE?.getOverview().catch(() => {});
      }
      // Periodic PRAGMA optimize every 6 hours
      if (localSqliteDb?.optimize && cronCounter % 360 === 0) {
        localSqliteDb.optimize();
      }

      const scheduledEvent = {
        cron: '* * * * *',
        scheduledTime: Date.now(),
        type: 'scheduled' as const,
        noRetry() {},
      };
      const ctx: ExecutionContext = {
        waitUntil(promise: Promise<unknown>) {
          promise.catch((err) => console.error('[Cron Task Error]:', err));
        },
        passThroughOnException() {},
      } as unknown as ExecutionContext;

      await worker.scheduled(scheduledEvent as any, env, ctx);
    } catch (err) {
      console.error('[Cron Scheduler Error]:', err);
    } finally {
      isCronRunning = false;
    }
  }, 60000);
}
