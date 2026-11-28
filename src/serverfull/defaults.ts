/**
 * @file defaults.ts
 * @description Single-source-of-truth persistent Serverfull `.env` template loader and file initializer.
 * Reads `.env.serverfull` from the package root rather than duplicating template strings in source code.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

let cachedEnvTemplate: string | null = null;

/**
 * Resolves the canonical `.env.serverfull` template file path from the package root or CWD.
 * Kept self-contained without importing `./paths` to avoid module initialization cycles.
 */
export function resolveServerfullEnvTemplatePath(): string {
  const candidates: string[] = [];
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(
      path.join(currentDir, '.env.serverfull'),
      path.resolve(currentDir, '..', '.env.serverfull'),
      path.resolve(currentDir, '../..', '.env.serverfull')
    );
  } catch {
    // Fallback to CWD when import.meta.url is unavailable
  }
  candidates.push(path.join(process.cwd(), '.env.serverfull'));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore inaccessible candidate paths
    }
  }
  return candidates[0];
}

/**
 * Loads and caches the canonical `.env.serverfull` configuration template.
 *
 * @throws Error if `.env.serverfull` cannot be located at package root or working directory.
 */
export function getDefaultEnvServerfullTemplate(): string {
  if (cachedEnvTemplate !== null) {
    return cachedEnvTemplate;
  }
  const templatePath = resolveServerfullEnvTemplatePath();
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Canonical configuration template ".env.serverfull" was not found (checked: ${templatePath})`);
  }
  cachedEnvTemplate = fs.readFileSync(templatePath, 'utf-8');
  return cachedEnvTemplate;
}

/**
 * Canonical `.env.serverfull` configuration template loaded from disk (single source of truth).
 */
export const DEFAULT_ENV_SERVERFULL_TEMPLATE: string = getDefaultEnvServerfullTemplate();

/**
 * Initializes or seeds a persistent configuration file from the canonical `.env.serverfull` template.
 *
 * @param targetPath - Absolute or relative file path to write.
 * @param force - If true, overwrite existing file.
 * @returns Object indicating whether the file was created and its path.
 */
export function writeDefaultConfigFile(targetPath: string, force: boolean = false): { created: boolean; path: string } {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }

  if (fs.existsSync(targetPath) && !force) {
    return { created: false, path: targetPath };
  }

  const content = getDefaultEnvServerfullTemplate();
  fs.writeFileSync(targetPath, content, { encoding: 'utf-8', mode: 0o644 });
  if (process.platform === 'linux' && process.env.SUDO_USER && process.env.SUDO_USER !== 'root') {
    const sudoUser = process.env.SUDO_USER.trim();
    if (/^[a-zA-Z0-9._-]+$/.test(sudoUser)) {
      try {
        execFileSync('chown', [sudoUser, targetPath]);
      } catch {}
    }
  }
  return { created: true, path: targetPath };
}
