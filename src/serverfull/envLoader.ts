/**
 * @file envLoader.ts
 * @description Hierarchical dotenv environment file loading and loaded path tracking.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ensurePersistentDirs,
  getDefaultConfigFilePath,
  getDefaultDataDir,
  getPackageRoot
} from './paths';

/**
 * Parsed and loaded environment files tracker.
 */
const loadedEnvFiles: string[] = [];

/**
 * Returns list of environment files successfully loaded into process.env.
 */
export function getLoadedEnvFiles(): readonly string[] {
  return loadedEnvFiles;
}

/**
 * Parses dotenv content into key-value pairs, supporting single-line quoted/unquoted values
 * as well as `"""..."""` multi-line string blocks.
 *
 * @param content - Raw dotenv file text.
 * @returns Map of parsed environment variable keys to values.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    if (!key) continue;

    const rawVal = trimmed.slice(eqIdx + 1).trimStart();
    let val: string;

    if (rawVal.startsWith('"""')) {
      const afterOpen = rawVal.slice(3);
      const closeSameLine = afterOpen.indexOf('"""');
      if (closeSameLine !== -1) {
        val = afterOpen.slice(0, closeSameLine).trim();
      } else {
        const blockLines: string[] = afterOpen ? [afterOpen] : [];
        while (i + 1 < lines.length) {
          i++;
          const line = lines[i];
          const closeIdx = line.indexOf('"""');
          if (closeIdx !== -1) {
            const beforeClose = line.slice(0, closeIdx);
            if (beforeClose) blockLines.push(beforeClose);
            break;
          }
          blockLines.push(line);
        }
        val = blockLines.join('\n').trim();
      }
    } else {
      val = rawVal.trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
    }

    result[key] = val;
  }

  return result;
}

/**
 * Parses KEY=VALUE dotenv files (including multi-line `"""..."""` blocks).
 * Returns true if file was successfully read.
 */
export function loadDotEnv(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseDotEnv(content);
      for (const [key, val] of Object.entries(parsed)) {
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
      return true;
    }
  } catch (err) {
    console.warn(`[Config] Failed to read ${filePath}:`, err);
  }
  return false;
}

/**
 * Loads configuration files from multiple hierarchical search paths:
 * 1. Current working directory: .dev.vars, .env, .env.serverfull
 * 2. System config directory: /etc/dns-worker/.env on Linux, %ProgramData%\\DNS-Worker\\.env on Windows
 * 3. Linux system config directory & compatibility paths
 * 4. Package distribution root: <packageRoot>/.env.serverfull
 */
export function loadEnvFiles(rootDir: string = process.cwd()): string[] {
  ensurePersistentDirs(true);
  loadedEnvFiles.length = 0;

  const candidatePaths = [
    // 1. Current working directory (explicit operator overrides)
    path.join(rootDir, '.dev.vars'),
    path.join(rootDir, '.env'),

    // 2. Standard system configuration file (/etc/dns-worker/.env on Linux)
    getDefaultConfigFilePath(),

    // 3. Linux standard system paths & compatibility fallbacks
    process.platform === 'linux' ? '/etc/dns-worker/.env' : null,
    process.platform === 'linux' ? '/etc/default/dns-worker' : null,
    process.platform === 'linux' ? path.join(getDefaultDataDir(), '.env') : null,

    // 4. Fallback Serverfull template files
    path.join(rootDir, '.env.serverfull'),
    path.join(getPackageRoot(), '.env.serverfull')
  ].filter((p): p is string => Boolean(p));

  const uniquePaths = Array.from(new Set(candidatePaths));
  for (const filePath of uniquePaths) {
    if (loadDotEnv(filePath)) {
      loadedEnvFiles.push(filePath);
    }
  }

  return loadedEnvFiles;
}
