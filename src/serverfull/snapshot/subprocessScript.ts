/**
 * @file subprocessScript.ts
 * @description Self-contained CommonJS subprocess script for non-blocking `VACUUM INTO` + Zstd snapshot creation.
 */

/**
 * Isolated subprocess worker executed via `spawn(process.execPath, ...)` so `VACUUM INTO`
 * and Zstd compression never block the main DNS/HTTP event loop and can be aborted immediately.
 */
export const CAPTURE_SUBPROCESS_SCRIPT = `
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { DatabaseSync } = require('node:sqlite');

async function run() {
  const dbPath = process.env.SNAPSHOT_DB_PATH;
  const tmpSqlite = process.env.SNAPSHOT_TMP_SQLITE;
  const tmpZst = process.env.SNAPSHOT_TMP_ZST;
  const finalZst = process.env.SNAPSHOT_FINAL_ZST;
  const lockPath = process.env.SNAPSHOT_LOCK_PATH;

  if (typeof zlib.createZstdCompress !== 'function') {
    throw new Error('Zstd compression is not supported in this Node.js runtime (requires Node.js >= 22.15).');
  }

  const readLock = () => {
    try {
      return JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    } catch {
      return null;
    }
  };

  const cleanupTemps = () => {
    try { fs.rmSync(tmpSqlite, { force: true }); } catch {}
    try { fs.rmSync(tmpZst, { force: true }); } catch {}
  };

  let db;
  try {
    db = new DatabaseSync(dbPath, { timeout: 10000 });
    db.exec('PRAGMA busy_timeout = 10000;');
    const escapedTarget = tmpSqlite.replace(/'/g, "''");
    db.exec("VACUUM INTO '" + escapedTarget + "';");
  } finally {
    try { db?.close(); } catch {}
  }

  let snapDb;
  try {
    snapDb = new DatabaseSync(tmpSqlite, { timeout: 10000 });
    snapDb.exec('DELETE FROM sessions; DELETE FROM pending_totp_sessions;');
  } catch {} finally {
    try { snapDb?.close(); } catch {}
  }

  const lockAfterVacuum = readLock();
  if (!lockAfterVacuum || lockAfterVacuum.cancelRequested) {
    cleanupTemps();
    return;
  }

  try {
    lockAfterVacuum.stage = 'compressing';
    lockAfterVacuum.progress = 50;
    fs.writeFileSync(lockPath, JSON.stringify(lockAfterVacuum), 'utf-8');
  } catch {}

  const zstdOptions = zlib.constants && typeof zlib.constants.ZSTD_c_compressionLevel === 'number'
    ? { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } }
    : undefined;

  let totalSqliteBytes = 0;
  try {
    totalSqliteBytes = fs.statSync(tmpSqlite).size;
  } catch {}

  let processedBytes = 0;
  let lastReportedPct = 50;
  const readStream = fs.createReadStream(tmpSqlite);
  readStream.on('data', (chunk) => {
    processedBytes += chunk.length;
    if (totalSqliteBytes > 0) {
      const nextPct = Math.min(99, 50 + Math.floor((processedBytes / totalSqliteBytes) * 49));
      if (nextPct > lastReportedPct) {
        lastReportedPct = nextPct;
        try {
          const cur = readLock();
          if (cur && !cur.cancelRequested) {
            cur.stage = 'compressing';
            cur.progress = nextPct;
            fs.writeFileSync(lockPath, JSON.stringify(cur), 'utf-8');
          }
        } catch {}
      }
    }
  });

  await pipeline(
    readStream,
    zlib.createZstdCompress(zstdOptions),
    fs.createWriteStream(tmpZst)
  );

  try { fs.rmSync(tmpSqlite, { force: true }); } catch {}

  const lockBeforeCommit = readLock();
  if (!lockBeforeCommit || lockBeforeCommit.cancelRequested) {
    cleanupTemps();
    return;
  }

  fs.renameSync(tmpZst, finalZst);
  try { fs.rmSync(lockPath, { force: true }); } catch {}
}

run().catch((err) => {
  try { fs.rmSync(process.env.SNAPSHOT_TMP_SQLITE, { force: true }); } catch {}
  try { fs.rmSync(process.env.SNAPSHOT_TMP_ZST, { force: true }); } catch {}
  console.error('[Snapshot Subprocess Error]:', err && err.message ? err.message : err);
  process.exit(1);
});
`;
