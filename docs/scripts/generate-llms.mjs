/**
 * @file generate-llms.mjs
 * @description Generates GEO / LLM-friendly artifacts into `docs/dist/` after `astro build`:
 *   - `/llms.txt`, `/zh-cn/llms.txt`, `/zh-tw/llms.txt` (structured page indexes per llmstxt.org)
 *   - `/llms-full.txt`, `/zh-cn/llms-full.txt`, `/zh-tw/llms-full.txt` (clean full-text Markdown bundles)
 *   - Per-route `<route>.md` clean Markdown mirrors corresponding to `<link rel="alternate" type="text/markdown">`
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsRoot = path.resolve(__dirname, '..');
const contentRoot = path.join(docsRoot, 'src', 'content', 'docs');
const distRoot = path.join(docsRoot, 'dist');

const SITE_ORIGIN = 'https://oppidi.github.io';
const SITE_BASE = '/DNS-Worker';

if (!fs.existsSync(distRoot)) {
  console.error('[generate-llms] Error: docs/dist does not exist. Run `astro build` first.');
  process.exit(1);
}

/**
 * Extracts YAML frontmatter (`title`, `description`, `template`, `sidebar.order`) and raw body.
 */
function parseFrontmatterAndBody(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { title: 'DNS Worker', description: '', order: 99, body: raw };
  }
  const fm = match[1];
  const body = match[2];

  const extractScalar = (key) => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (!m) return '';
    return m[1].trim().replace(/^["']|["']$/g, '');
  };
  const orderMatch = fm.match(/^\s*order:\s*(\d+)/m);

  return {
    title: extractScalar('title') || 'DNS Worker',
    description: extractScalar('description'),
    order: orderMatch ? Number(orderMatch[1]) : 99,
    body,
  };
}

/**
 * Converts Starlight MDX/Markdown into clean, JSX-free CommonMark/GFM Markdown for LLM consumption.
 */
function sanitizeMdxToMarkdown(title, description, rawBody) {
  let out = rawBody;

  // Strip ESM imports from MDX files
  out = out.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  // Convert Starlight <Aside type="..." title="..."> blocks into readable Markdown blockquotes
  out = out.replace(/<Aside\s+[^>]*title=["']([^"']+)["'][^>]*>/g, '> **$1**\n> ');
  out = out.replace(/<Aside[^>]*>/g, '> ');
  out = out.replace(/<\/Aside>/g, '');
  // Convert <Badge text="..." /> into inline bracket tag
  out = out.replace(/<Badge\s+[^>]*text=["']([^"']+)["'][^>]*\/?>/g, '`[$1]`');
  // Convert Starlight <Card title="..."> into H3 headings and drop <CardGrid> wrappers
  out = out.replace(/<\/?CardGrid[^>]*>/g, '');
  out = out.replace(/<Card\s+[^>]*title=["']([^"']+)["'][^>]*>/g, '### $1\n');
  out = out.replace(/<\/Card>/g, '');
  // Replace MDX <Image ... alt="..." ... /> with plain caption text
  out = out.replace(/<Image\s+[^>]*alt=["']([^"']+)["'][^>]*\/?>/g, '*[Screenshot: $1]*');
  out = out.replace(/<Image[^>]*\/?>/g, '');

  // Collapse excessive blank lines
  out = out.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const headerLines = [`# ${title}`];
  if (description) {
    headerLines.push('', `> ${description}`);
  }
  return `${headerLines.join('\n')}\n\n${out}\n`;
}

function collectLocaleEntries(localeDir, localePrefix) {
  const entries = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (localePrefix === '' && dir === localeDir && (entry.name === 'zh-cn' || entry.name === 'zh-tw')) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.mdx?$/i.test(entry.name)) {
        const relFromLocale = path.relative(localeDir, fullPath).replaceAll(path.sep, '/');
        const routeSlug = relFromLocale
          .replace(/\/index\.mdx?$/i, '')
          .replace(/^index\.mdx?$/i, '')
          .replace(/\.mdx?$/i, '');

        const prefixPath = localePrefix ? `${localePrefix}/` : '';
        const htmlPath = routeSlug ? `${SITE_BASE}/${prefixPath}${routeSlug}/` : `${SITE_BASE}/${prefixPath}`;
        const mdPath = routeSlug ? `${SITE_BASE}/${prefixPath}${routeSlug}.md` : `${SITE_BASE}/${prefixPath}index.md`;
        const distMdFile = path.join(distRoot, localePrefix, routeSlug ? `${routeSlug}.md` : 'index.md');

        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = parseFrontmatterAndBody(raw);
        const cleanMarkdown = sanitizeMdxToMarkdown(parsed.title, parsed.description, parsed.body);

        entries.push({
          localePrefix,
          relKey: relFromLocale,
          routeSlug,
          section: routeSlug.includes('/') ? routeSlug.split('/')[0] : 'overview',
          order: parsed.order,
          title: parsed.title,
          description: parsed.description,
          htmlUrl: `${SITE_ORIGIN}${htmlPath}`,
          mdUrl: `${SITE_ORIGIN}${mdPath}`,
          distMdFile,
          cleanMarkdown,
        });
      }
    }
  };
  walk(localeDir);
  return entries.sort((a, b) => a.section.localeCompare(b.section) || a.order - b.order || a.relKey.localeCompare(b.relKey));
}

const SECTION_LABELS = {
  en: {
    overview: 'Home',
    guide: 'Getting Started',
    architecture: 'Architecture & Standards',
    deployment: 'Deployment',
    networking: 'Networking & Endpoints',
    filtering: 'Domain Blocking & Rules',
    advanced: 'Security & Privacy',
    maintenance: 'Maintenance & Lifecycle',
    mcp: 'WebMCP & AI Integration',
    reference: 'CLI & API Reference',
    faq: 'Troubleshooting & FAQ',
  },
  'zh-cn': {
    overview: '首页概览',
    guide: '开始使用',
    architecture: '系统架构与规范',
    deployment: '部署指南',
    networking: '网络与接入点',
    filtering: '域名拦截与过滤规则',
    advanced: '安全与隐私机制',
    maintenance: '留存与维护',
    mcp: 'WebMCP 与 AI 集成',
    reference: 'CLI 与 API 参考',
    faq: '常见问题与排错',
  },
  'zh-tw': {
    overview: '首頁概覽',
    guide: '開始使用',
    architecture: '系統架構與規範',
    deployment: '部署指南',
    networking: '網路與接入點',
    filtering: '域名攔截與過濾規則',
    advanced: '安全與隱私機制',
    maintenance: '留存與維護',
    mcp: 'WebMCP 與 AI 整合',
    reference: 'CLI 與 API 參考',
    faq: '常見問題與排錯',
  },
};

function buildLlmsTxt(localeKey, entries) {
  const labels = SECTION_LABELS[localeKey];
  const prefix = localeKey === 'en' ? '' : `/${localeKey}`;
  const header =
    localeKey === 'zh-cn'
      ? [
          '# DNS Worker 文档',
          '',
          '> 注重隐私保护的保护性 DNS（域名拦截系统），支持 DoH (RFC 8484)、DoT (RFC 7858)、DoQ (RFC 9250)、ECH/DDR (RFC 9460)，可部署于 Cloudflare Workers + D1 或独立 Serverfull (Node.js / Bun + SQLite)。',
          '',
          `- 全量 Markdown 语料: ${SITE_ORIGIN}${SITE_BASE}${prefix}/llms-full.txt`,
          `- 英文根索引: ${SITE_ORIGIN}${SITE_BASE}/llms.txt`,
          `- 繁体中文索引: ${SITE_ORIGIN}${SITE_BASE}/zh-tw/llms.txt`,
          '',
        ]
      : localeKey === 'zh-tw'
      ? [
          '# DNS Worker 使用者文件',
          '',
          '> 注重隱私保護的保護性 DNS（域名攔截系統），支援 DoH (RFC 8484)、DoT (RFC 7858)、DoQ (RFC 9250)、ECH/DDR (RFC 9460)，可部署於 Cloudflare Workers + D1 或獨立 Serverfull (Node.js / Bun + SQLite)。',
          '',
          `- 全量 Markdown 語料: ${SITE_ORIGIN}${SITE_BASE}${prefix}/llms-full.txt`,
          `- 英文根索引: ${SITE_ORIGIN}${SITE_BASE}/llms.txt`,
          `- 簡體中文索引: ${SITE_ORIGIN}${SITE_BASE}/zh-cn/llms.txt`,
          '',
        ]
      : [
          '# DNS Worker Documentation',
          '',
          '> DNS Worker is a privacy-focused Protective DNS (domain-blocking system) supporting DoH (RFC 8484), DoT (RFC 7858), DoQ (RFC 9250), and ECH/DDR (RFC 9460). It runs serverless on Cloudflare Workers + D1 or standalone (Serverfull) on Node.js / Bun with SQLite.',
          '',
          `- Full Markdown Corpus (English): ${SITE_ORIGIN}${SITE_BASE}/llms-full.txt`,
          `- Simplified Chinese Index (简体中文): ${SITE_ORIGIN}${SITE_BASE}/zh-cn/llms.txt`,
          `- Traditional Chinese Index (正體中文): ${SITE_ORIGIN}${SITE_BASE}/zh-tw/llms.txt`,
          '',
        ];

  const grouped = new Map();
  for (const item of entries) {
    if (!grouped.has(item.section)) grouped.set(item.section, []);
    grouped.get(item.section).push(item);
  }

  const sectionOrder = ['overview', 'guide', 'filtering', 'architecture', 'deployment', 'networking', 'advanced', 'maintenance', 'mcp', 'reference', 'faq'];
  const lines = [...header];
  for (const sec of sectionOrder) {
    const list = grouped.get(sec);
    if (!list || list.length === 0) continue;
    lines.push(`## ${labels[sec] || sec}`);
    for (const item of list) {
      const desc = item.description ? `: ${item.description}` : '';
      lines.push(`- [${item.title}](${item.mdUrl})${desc} ([HTML](${item.htmlUrl}))`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildLlmsFullTxt(localeKey, entries) {
  const banner =
    localeKey === 'zh-cn'
      ? '# DNS Worker 完整文档语料 (简体中文)\n\n'
      : localeKey === 'zh-tw'
      ? '# DNS Worker 完整文件語料 (正體中文)\n\n'
      : '# DNS Worker Complete Documentation (English)\n\n';
  return (
    banner +
    entries
      .map((item) => `Source HTML: ${item.htmlUrl}\nSource Markdown: ${item.mdUrl}\n\n${item.cleanMarkdown}`)
      .join('\n---\n\n')
  );
}

const localeConfigs = [
  { key: 'en', dir: contentRoot, prefix: '' },
  { key: 'zh-cn', dir: path.join(contentRoot, 'zh-cn'), prefix: 'zh-cn' },
  { key: 'zh-tw', dir: path.join(contentRoot, 'zh-tw'), prefix: 'zh-tw' },
];

let mdCount = 0;
for (const { key, dir, prefix } of localeConfigs) {
  const entries = collectLocaleEntries(dir, prefix);
  for (const item of entries) {
    fs.mkdirSync(path.dirname(item.distMdFile), { recursive: true });
    fs.writeFileSync(item.distMdFile, item.cleanMarkdown, 'utf8');
    mdCount++;
  }

  const outDir = path.join(distRoot, prefix);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'llms.txt'), buildLlmsTxt(key, entries), 'utf8');
  fs.writeFileSync(path.join(outDir, 'llms-full.txt'), buildLlmsFullTxt(key, entries), 'utf8');
}

console.log(`[generate-llms] Generated ${mdCount} Markdown mirrors + llms.txt / llms-full.txt for en, zh-cn, zh-tw.`);
