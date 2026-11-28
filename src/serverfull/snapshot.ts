/**
 * @file snapshot.ts
 * @description Serverfull local SQLite snapshot engine (.sqlite.zst), coordinating isolated capture
 * subprocesses and delegating storage inspection, pruning, and range streaming to `./snapshot/*`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import zlib from 'node:zlib';
import type {
  ActiveSnapshotCapture,
  DatabaseSnapshotItem,
  DatabaseSnapshotOverview,
  DatabaseStorageStats,
  Env,
  ServerfullSnapshotBridge,
} from '../types';
import {
  ResolvedSnapshotConfig,
  SnapshotLockState,
  formatSnapshotTimestampUtc,
  getFileSizeSafe,
  isProcessAlive,
  resolveSnapshotConfig,
  writeJsonAtomic,
} from './snapshot/config';
import { CAPTURE_SUBPROCESS_SCRIPT } from './snapshot/subprocessScript';
import {
  cleanupTempSnapshotArtifacts,
  computeSnapshotStorageStats,
  deleteSnapshotFiles,
  ensureSnapshotDir,
  getSnapshotLockPath,
  openSnapshotDownloadStream,
  pruneAndListSnapshotFiles,
  readActiveSnapshotLock,
} from './snapshot/storage';

export { resolveSnapshotConfig };
export type { ResolvedSnapshotConfig };

/**
 * Manages SQLite `.sqlite.zst` snapshots, storage telemetry, retention policies,
 * and abortable background capture for Serverfull `File` mode.
 */
export class ServerfullSnapshotManager implements ServerfullSnapshotBridge {
  private activeChild: ChildProcess | null = null;
  private activeMonitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly env: Partial<Env>) {}

  private getConfig(): ResolvedSnapshotConfig {
    return resolveSnapshotConfig(this.env);
  }

  public pruneAndListSnapshots(): DatabaseSnapshotItem[] {
    return pruneAndListSnapshotFiles(this.getConfig());
  }

  public getStorageStats(snapshots?: DatabaseSnapshotItem[]): DatabaseStorageStats {
    return computeSnapshotStorageStats(this.getConfig(), snapshots);
  }

  public async getOverview(): Promise<DatabaseSnapshotOverview> {
    const cfg = this.getConfig();
    const snapshots = pruneAndListSnapshotFiles(cfg);
    const lock = readActiveSnapshotLock(cfg.snapshotDir);
    const storage = computeSnapshotStorageStats(cfg, snapshots);

    let activeCapture: ActiveSnapshotCapture | null = null;
    if (lock) {
      let progress = typeof lock.progress === 'number' ? Math.max(0, Math.min(99, lock.progress)) : 0;
      if (!lock.cancelRequested && lock.stage === 'vacuumming' && storage.dbMainBytes > 0) {
        const tmpSqliteSize = getFileSizeSafe(path.join(cfg.snapshotDir, `.tmp-${lock.id}.sqlite`));
        if (tmpSqliteSize > 0) {
          const vacuumPct = Math.min(48, Math.max(5, Math.round((tmpSqliteSize / storage.dbMainBytes) * 48)));
          progress = Math.max(progress, vacuumPct);
        }
      }
      activeCapture = {
        id: lock.id,
        startedAt: lock.startedAt,
        stage: lock.cancelRequested ? 'cancelling' : lock.stage,
        progress,
      };
    }

    return {
      supported: true,
      storage,
      snapshots,
      activeCapture,
      config: {
        retentionDays: cfg.retentionDays,
        maxCount: cfg.maxCount,
        snapshotDir: cfg.snapshotDir,
      },
    };
  }

  public async startCapture(): Promise<ActiveSnapshotCapture> {
    if (typeof zlib.createZstdCompress !== 'function') {
      throw new Error('ZSTD_UNSUPPORTED: Current JavaScript runtime does not support native Zstd compression.');
    }

    const cfg = this.getConfig();
    ensureSnapshotDir(cfg.snapshotDir);

    if (readActiveSnapshotLock(cfg.snapshotDir)) {
      throw new Error('SNAPSHOT_IN_PROGRESS');
    }

    const startedAt = Math.floor(Date.now() / 1000);
    const shortId = crypto.randomBytes(3).toString('hex');
    const id = `${formatSnapshotTimestampUtc(startedAt)}-${shortId}`;
    const finalFilename = `dns-worker-snapshot-${id}.sqlite.zst`;

    const tmpSqlite = path.join(cfg.snapshotDir, `.tmp-${id}.sqlite`);
    const tmpZst = path.join(cfg.snapshotDir, `.tmp-${id}.sqlite.zst`);
    const finalZst = path.join(cfg.snapshotDir, finalFilename);
    const lockPath = getSnapshotLockPath(cfg.snapshotDir);

    const initialLock: SnapshotLockState = {
      id,
      pid: 0,
      workerPid: process.pid,
      startedAt,
      stage: 'vacuumming',
      progress: 0,
      cancelRequested: false,
    };

    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify(initialLock), 'utf-8');
      } finally {
        fs.closeSync(fd);
      }
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'EEXIST') {
        throw new Error('SNAPSHOT_IN_PROGRESS');
      }
      throw err;
    }

    const isBun = Boolean((process.versions as Record<string, string | undefined>).bun);
    const execArgs = isBun
      ? ['-e', CAPTURE_SUBPROCESS_SCRIPT]
      : ['--input-type=commonjs', '-e', CAPTURE_SUBPROCESS_SCRIPT];

    let child: ChildProcess;
    try {
      child = spawn(process.execPath, execArgs, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          SNAPSHOT_DB_PATH: cfg.dbPath,
          SNAPSHOT_TMP_SQLITE: tmpSqlite,
          SNAPSHOT_TMP_ZST: tmpZst,
          SNAPSHOT_FINAL_ZST: finalZst,
          SNAPSHOT_LOCK_PATH: lockPath,
        },
      });
      if (child.pid) {
        writeJsonAtomic(lockPath, { ...initialLock, pid: child.pid });
      }
    } catch (err) {
      try { fs.rmSync(lockPath, { force: true }); } catch {}
      throw err;
    }

    this.activeChild = child;

    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8');
    });

    if (this.activeMonitorTimer) {
      clearInterval(this.activeMonitorTimer);
    }
    this.activeMonitorTimer = setInterval(() => {
      try {
        if (!fs.existsSync(lockPath)) return;
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as SnapshotLockState;
        if (lock.cancelRequested && this.activeChild === child) {
          try { child.kill('SIGKILL'); } catch {}
        }
      } catch {}
    }, 200);

    child.once('exit', (code, signal) => {
      if (this.activeChild === child) {
        this.activeChild = null;
      }
      if (this.activeMonitorTimer) {
        clearInterval(this.activeMonitorTimer);
        this.activeMonitorTimer = null;
      }

      if (code !== 0 && !signal) {
        console.error(`[Snapshot] Capture ${id} exited with code ${code}: ${stderrBuf.trim()}`);
      }

      cleanupTempSnapshotArtifacts(cfg.snapshotDir, id);
      try {
        if (fs.existsSync(lockPath)) {
          const cur = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as SnapshotLockState;
          if (cur.id === id) {
            fs.rmSync(lockPath, { force: true });
          }
        }
      } catch {
        try { fs.rmSync(lockPath, { force: true }); } catch {}
      }

      pruneAndListSnapshotFiles(cfg);
    });

    return {
      id,
      startedAt,
      stage: 'vacuumming',
      progress: 0,
    };
  }

  public async abortCapture(): Promise<{ aborted: boolean }> {
    const cfg = this.getConfig();
    const lockPath = getSnapshotLockPath(cfg.snapshotDir);
    const lock = readActiveSnapshotLock(cfg.snapshotDir);
    if (!lock) {
      cleanupTempSnapshotArtifacts(cfg.snapshotDir);
      return { aborted: false };
    }

    const updated: SnapshotLockState = {
      ...lock,
      stage: 'cancelling',
      cancelRequested: true,
    };
    try {
      writeJsonAtomic(lockPath, updated);
    } catch {}

    if (this.activeChild) {
      try {
        this.activeChild.kill('SIGKILL');
      } catch {}
    } else if (lock.pid > 0 && lock.pid !== lock.workerPid && isProcessAlive(lock.pid)) {
      try {
        process.kill(lock.pid, 'SIGKILL');
      } catch {}
    }

    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      if (!fs.existsSync(lockPath) || !isProcessAlive(lock.pid)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    if (!isProcessAlive(lock.pid)) {
      cleanupTempSnapshotArtifacts(cfg.snapshotDir, lock.id);
      try { fs.rmSync(lockPath, { force: true }); } catch {}
    }

    return { aborted: true };
  }

  public async deleteSnapshots(filenames: string[]): Promise<{ deletedCount: number }> {
    return deleteSnapshotFiles(this.getConfig(), filenames);
  }

  public async openSnapshotDownload(filename: string, rangeHeader?: string | null) {
    return openSnapshotDownloadStream(this.getConfig(), filename, rangeHeader);
  }
}
