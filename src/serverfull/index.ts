/**
 * @file index.ts
 * @description Master entry point for DNS Worker Serverfull mode.
 * Boots and coordinates runtime setup, database initialization, cluster workers,
 * network transports, and graceful shutdown via `./bootstrap/*`.
 */

import { initNodeGlobals } from './cache';
import { getPackageVersion, getServerfullConfig } from './config';
import { flushLogBatch } from '../pipeline/logBatcher';
import { formatDiagnostic } from './format';
import { checkNodeVersion, parseCli, getActiveRuntimeDescription } from './cli';
import { tuneV8Engine } from './v8';
import { getClusterInfo, forkClusterWorkers, shutdownClusterWorkers } from './cluster';
import { ServerfullLifecycleManager } from './lifecycle';
import { startServerfullCronLoop } from './bootstrap/cron';
import { initConfiguredDatabase, closeLocalSqliteSafely } from './bootstrap/database';
import { logPrimaryStartupDiagnostics, printRuntimeStartupBanner } from './bootstrap/diagnostics';
import { registerWorkerIpcHandlers } from './bootstrap/ipc';
import { startServerfullTransports, stopServerfullTransports } from './bootstrap/transports';

export * from './cli';

async function bootstrap(): Promise<void> {
  // 1. Parse CLI arguments & execute progressive runtime handoff before V8 tuning
  const cliArgs = await parseCli();
  tuneV8Engine();
  checkNodeVersion();

  // 2. Initialize in-memory Web Cache and HTMLRewriter polyfills
  initNodeGlobals();

  // 3. Load environment variables & configurations
  const { config, env } = getServerfullConfig(cliArgs);
  const clusterInfo = getClusterInfo(config.workers);
  const parsedStartedAt = Number(process.env.SERVERFULL_STARTED_AT);
  const processStartedAt =
    Number.isFinite(parsedStartedAt) && parsedStartedAt > 0
      ? Math.floor(parsedStartedAt)
      : Math.floor(Date.now() / 1000);
  if (clusterInfo.isPrimary) {
    process.env.SERVERFULL_STARTED_AT = String(processStartedAt);
  }

  // 4. Primary process startup diagnostics
  if (clusterInfo.isPrimary) {
    logPrimaryStartupDiagnostics(config, env);
  }

  // 5. Initialize Database adapter & synced Cloudflare proxy CIDRs
  const localSqliteDb = await initConfiguredDatabase(config, env, clusterInfo.isPrimary);

  // 6. Cluster Primary Process: fork workers and run scheduled background cron
  if (clusterInfo.isPrimary && clusterInfo.workersCount > 1) {
    printRuntimeStartupBanner(config, clusterInfo.workersCount);
    const cronTimer = startServerfullCronLoop(env, localSqliteDb);

    let primaryShuttingDown = false;
    const shutdownPrimary = async (signal: string) => {
      if (primaryShuttingDown) return;
      primaryShuttingDown = true;
      console.log(`\n[Serverfull Master] Received ${signal}. Shutting down cluster...`);
      clearInterval(cronTimer);
      await shutdownClusterWorkers();

      try { await flushLogBatch(env); } catch {}
      closeLocalSqliteSafely(localSqliteDb, true, '[Serverfull Master]');

      console.log('[Serverfull Master] Cluster shutdown complete. Goodbye.');
      process.exit(0);
    };

    forkClusterWorkers(clusterInfo.workersCount, () => {
      void shutdownPrimary('CONSOLE_RESTART');
    });

    process.on('SIGINT', () => shutdownPrimary('SIGINT'));
    process.on('SIGTERM', () => shutdownPrimary('SIGTERM'));
    return;
  }

  // 7. Worker Process (or Single Process Mode): wire IPC & lifecycle bridge, start transports
  if (clusterInfo.isWorker) {
    registerWorkerIpcHandlers();
  }

  let triggerConsoleRestart: (() => void) | null = null;
  env.SERVERFULL_LIFECYCLE_BRIDGE = new ServerfullLifecycleManager({
    currentVersion: getPackageVersion(),
    startedAt: processStartedAt,
    runtime: getActiveRuntimeDescription(),
    packageRoot: config.packageRoot,
    workersCount: clusterInfo.workersCount,
    onRestart: () => {
      if (clusterInfo.isWorker) {
        process.send?.({ type: 'CONTROL_RESTART' });
      } else {
        triggerConsoleRestart?.();
      }
    },
  });

  const transports = await startServerfullTransports(config, env);

  let cronTimer: NodeJS.Timeout | null = null;
  if (clusterInfo.workersCount === 1) {
    cronTimer = startServerfullCronLoop(env, localSqliteDb);
    printRuntimeStartupBanner(config, clusterInfo.workersCount);
  } else {
    console.log(`[Worker #${clusterInfo.workerId || 1}] All server transports bound and listening.`);
  }

  // 8. Graceful shutdown handler
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    const prefix = clusterInfo.workersCount > 1 ? `[Worker #${clusterInfo.workerId || 1}]` : '[Serverfull]';
    console.log(`\n${prefix} Received ${signal}. Shutting down gracefully...`);
    if (cronTimer) clearInterval(cronTimer);

    await stopServerfullTransports(transports);
    try { await flushLogBatch(env); } catch {}
    closeLocalSqliteSafely(localSqliteDb, clusterInfo.workersCount === 1, prefix);

    console.log(`${prefix} Services stopped. Goodbye.`);
    process.exit(0);
  };

  triggerConsoleRestart = () => {
    void shutdown('CONSOLE_RESTART');
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err: unknown) => {
  const errCode = (err as { code?: string })?.code;
  if (errCode !== 'EACCES' && errCode !== 'EADDRINUSE') {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(formatDiagnostic({
      level: 'error',
      title: 'Serverfull - Fatal Startup Error',
      message: errorMsg,
    }));
  }
  process.exit(1);
});
