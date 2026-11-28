/**
 * @file check-docs.mjs
 * @description Validates Starlight documentation symmetry across locales (en, zh-cn, zh-tw),
 * sidebar.order consistency, Mermaid node label quoting, and per-page GEO prerequisites.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsContentRoot = path.resolve(__dirname, '..', 'src', 'content', 'docs');

const LOCALES = ['en', 'zh-cn', 'zh-tw'];

function collectDocs(dir, baseDir, results = new Map(), skipTopDirs = new Set()) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dir === baseDir && skipTopDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectDocs(fullPath, baseDir, results, skipTopDirs);
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      const rel = path.relative(baseDir, fullPath).replaceAll(path.sep, '/');
      results.set(rel, fullPath);
    }
  }
  return results;
}

function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { title: '', description: '', template: '', order: null, body: content };
  }
  const fm = fmMatch[1];
  const extract = (key) => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  const orderMatch = fm.match(/^\s*order:\s*(\d+)/m);
  return {
    title: extract('title'),
    description: extract('description'),
    template: extract('template'),
    order: orderMatch ? Number(orderMatch[1]) : null,
    body: fmMatch[2],
  };
}

function findUnquotedMermaidLabels(content) {
  const issues = [];
  const mermaidBlocks = content.matchAll(/```mermaid\r?\n([\s\S]*?)```/g);
  for (const match of mermaidBlocks) {
    const lines = match[1].split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('%%') || trimmed.startsWith('sequenceDiagram')) continue;
      // Match node[label] where label is not quoted and contains parentheses
      const unquotedMatch = trimmed.match(/\b[A-Za-z0-9_-]+\[([^"\]\n]*[()][^"\]\n]*)\]/);
      if (unquotedMatch) {
        issues.push(trimmed);
      }
    }
  }
  return issues;
}

function validateGeoReadiness(locale, key, content) {
  const issues = [];
  const parsed = parseFrontmatter(content);
  if (!parsed.title) {
    issues.push(`Missing frontmatter title`);
  }
  const minDescLen = locale === 'en' ? 40 : 18;
  if (!parsed.description || parsed.description.length < minDescLen) {
    issues.push(`Description missing or too concise for GEO (< ${minDescLen} chars)`);
  }
  if (parsed.template !== 'splash') {
    const beforeFirstH2 = parsed.body.split(/^##\s+/m)[0]
      .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
      .trim();
    if (!beforeFirstH2 || !/dns\s*-?\s*worker/i.test(beforeFirstH2)) {
      issues.push(`Opening summary before first H2 should explicitly name DNS Worker for standalone AI extraction`);
    }
  }
  return issues;
}

const byLocale = {
  en: collectDocs(docsContentRoot, docsContentRoot, new Map(), new Set(['zh-cn', 'zh-tw'])),
  'zh-cn': collectDocs(path.join(docsContentRoot, 'zh-cn'), path.join(docsContentRoot, 'zh-cn')),
  'zh-tw': collectDocs(path.join(docsContentRoot, 'zh-tw'), path.join(docsContentRoot, 'zh-tw')),
};

let errors = 0;

// 1. Check locale file symmetry
const allKeys = new Set([...byLocale.en.keys(), ...byLocale['zh-cn'].keys(), ...byLocale['zh-tw'].keys()]);
for (const key of Array.from(allKeys).sort()) {
  for (const locale of LOCALES) {
    if (!byLocale[locale].has(key)) {
      console.error(`[docs-check] Missing file in locale "${locale}": ${key}`);
      errors++;
    }
  }
}

// 2. Check sidebar.order consistency, Mermaid syntax, and per-page GEO gates
for (const key of Array.from(allKeys).sort()) {
  const orders = new Map();
  for (const locale of LOCALES) {
    const filePath = byLocale[locale].get(key);
    if (!filePath) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(content);
    orders.set(locale, parsed.order);

    const mermaidIssues = findUnquotedMermaidLabels(content);
    for (const issue of mermaidIssues) {
      console.error(`[docs-check] Unquoted Mermaid label with parentheses in ${locale}/${key}: ${issue}`);
      errors++;
    }

    const geoIssues = validateGeoReadiness(locale, key, content);
    for (const issue of geoIssues) {
      console.error(`[docs-check] GEO check failed in ${locale}/${key}: ${issue}`);
      errors++;
    }
  }
  const uniqueOrders = new Set(Array.from(orders.values()).filter((v) => v !== null));
  if (uniqueOrders.size > 1) {
    console.error(`[docs-check] Mismatched sidebar.order for ${key}: ${JSON.stringify(Object.fromEntries(orders))}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`[docs-check] Failed with ${errors} error(s).`);
  process.exit(1);
}

console.log(`[docs-check] Passed: ${allKeys.size} pages verified (symmetry, Mermaid, GEO) across ${LOCALES.join(', ')}.`);
