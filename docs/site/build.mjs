#!/usr/bin/env node
// Static docs generator for workbench.
//
// Reads Markdown from _content/, the nav tree from nav.json, and writes plain
// static HTML into _site/. No server, no framework: GitHub Pages serves the
// generated directory. _site/ is build output and is not committed — the docs
// workflow regenerates it on every push to main, so a pull request never
// carries a rebuilt-HTML diff.
//
//   node docs/site/build.mjs
//
// Authoring extensions on top of CommonMark:
//   > [!NOTE] / [!TIP] / [!WARNING] / [!DANGER]   → callout blocks
//   :::tabs / ::: (fenced code inside, one tab per fence label) → tabbed code
//   ```mermaid                                    → client-rendered diagram
//   :::cards ... :::                              → card grid (landing pages)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(ROOT, '_content');
const OUT = join(ROOT, '_site');
const nav = JSON.parse(readFileSync(join(ROOT, 'nav.json'), 'utf8'));

const SITE = nav.site;

/* ------------------------------------------------------------------ *
 * Front matter
 * ------------------------------------------------------------------ */

function parseFrontMatter(src) {
  if (!src.startsWith('---')) return { data: {}, body: src };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: src };
  const raw = src.slice(4, end);
  const body = src.slice(end + 4).replace(/^\n/, '');
  const data = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { data, body };
}

/* ------------------------------------------------------------------ *
 * Markdown → HTML
 * ------------------------------------------------------------------ */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

const ICONS = {
  note: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.2v4M8 4.8v.6"/></svg>',
  tip: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 13h4M6.5 15h3"/><path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.4.3.6.7.6 1.1h4c0-.4.2-.8.6-1.1A4.5 4.5 0 0 0 8 1.5Z"/></svg>',
  warning: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.5"/></svg>',
  danger: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>',
};

function buildRenderer(page) {
  const marked = new Marked({ gfm: true, breaks: false });
  const headings = [];
  const seen = new Map();

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const plain = text.replace(/<[^>]+>/g, '');
        let id = slugify(plain);
        if (seen.has(id)) {
          const n = seen.get(id) + 1;
          seen.set(id, n);
          id = `${id}-${n}`;
        } else {
          seen.set(id, 0);
        }
        if (depth === 2 || depth === 3) headings.push({ depth, id, text: plain });
        if (depth === 1) return `<h1>${text}</h1>\n`;
        return `<h${depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Link to ${esc(plain)}">#</a></h${depth}>\n`;
      },

      code({ text, lang }) {
        const language = (lang || '').split(/\s+/)[0];
        if (language === 'mermaid') {
          return `<div class="mermaid-wrap"><pre class="mermaid">${esc(text)}</pre></div>\n`;
        }
        const label = language || 'text';
        return codeBlock(text, language, label);
      },

      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href) && !href.includes(SITE.domain);
        const attrs = external ? ' target="_blank" rel="noopener"' : '';
        const t = title ? ` title="${esc(title)}"` : '';
        return `<a href="${href}"${t}${attrs}>${text}${external ? '<span class="ext" aria-hidden="true">↗</span>' : ''}</a>`;
      },

      table({ header, rows }) {
        const th = header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const tb = rows
          .map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`)
          .join('\n');
        return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>\n${tb}\n</tbody></table></div>\n`;
      },
    },
  });

  return { marked, headings };
}

function codeBlock(text, language, label) {
  return (
    `<div class="code" data-lang="${esc(language || 'text')}">` +
    `<div class="code-bar"><span class="code-lang">${esc(label)}</span>` +
    `<button class="copy" type="button" aria-label="Copy code">Copy</button></div>` +
    `<pre><code class="language-${esc(language || 'plaintext')}">${esc(text)}</code></pre>` +
    `</div>\n`
  );
}

/* -------- block extensions: callouts, tabs, cards, steps ---------- */

function preprocess(src) {
  // Callouts:  > [!NOTE]\n> body
  src = src.replace(
    /(?:^> \[!(NOTE|TIP|WARNING|DANGER)\][^\n]*\n(?:^>.*\n?)*)/gim,
    (block) => {
      const kind = block.match(/\[!(\w+)\]/)[1].toLowerCase();
      const titleMatch = block.match(/\[!\w+\]\s*(.*)/);
      const title = (titleMatch && titleMatch[1].trim()) || kind[0].toUpperCase() + kind.slice(1);
      const body = block
        .split('\n')
        .slice(1)
        .map((l) => l.replace(/^>\s?/, ''))
        .join('\n')
        .trim();
      return `\n<!--CALLOUT:${kind}:${encodeURIComponent(title)}:${encodeURIComponent(body)}-->\n`;
    }
  );
  return src;
}

function postprocess(html, marked) {
  // Callouts
  html = html.replace(/<!--CALLOUT:(\w+):([^:]*):([^>]*)-->/g, (_, kind, title, body) => {
    const inner = marked.parse(decodeURIComponent(body));
    return (
      `<div class="callout callout-${kind}"><div class="callout-head">` +
      `<span class="callout-icon">${ICONS[kind] || ICONS.note}</span>` +
      `<span class="callout-title">${esc(decodeURIComponent(title))}</span></div>` +
      `<div class="callout-body">${inner}</div></div>`
    );
  });
  return html;
}

// :::tabs blocks are handled before markdown, producing raw HTML.
// The id must be derived, not random: the build has to be byte-for-byte
// reproducible or CI cannot tell a stale commit from a fresh one.
function extractTabs(src, marked, pagePath) {
  let n = 0;
  return src.replace(/^:::tabs\s*\n([\s\S]*?)^:::\s*$/gm, (_, inner) => {
    const parts = [...inner.matchAll(/^```(\S+)?[ \t]*(?:\[([^\]]+)\])?\n([\s\S]*?)^```\s*$/gm)];
    if (!parts.length) return inner;
    const id = 'tabs-' + pagePath.replace(/[^a-z0-9]+/gi, '-') + '-' + n++;
    const buttons = parts
      .map(
        (p, i) =>
          `<button type="button" class="tab${i === 0 ? ' active' : ''}" data-i="${i}">${esc(p[2] || p[1] || 'code')}</button>`
      )
      .join('');
    const panels = parts
      .map(
        (p, i) =>
          `<div class="tab-panel${i === 0 ? ' active' : ''}" data-i="${i}">` +
          codeBlock(p[3].replace(/\n$/, ''), p[1] || '', p[2] || p[1] || 'code') +
          `</div>`
      )
      .join('');
    return `\n<div class="tabs" id="${id}"><div class="tab-bar">${buttons}</div>${panels}</div>\n`;
  });
}

function extractCards(src) {
  return src.replace(/^:::cards(?:\s+(\d))?\s*\n([\s\S]*?)^:::\s*$/gm, (_, cols, inner) => {
    const items = [...inner.matchAll(/^-\s+\[([^\]]+)\]\(([^)]+)\)\s*—\s*(.*)$/gm)];
    const cards = items
      .map(
        ([, title, href, desc]) =>
          `<a class="card" href="${href}"><span class="card-title">${esc(title)}</span>` +
          `<span class="card-desc">${esc(desc)}</span>` +
          `<span class="card-more">Read<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg></span></a>`
      )
      .join('');
    return `\n<div class="cards" data-cols="${cols || 2}">${cards}</div>\n`;
  });
}

function extractSteps(src) {
  return src.replace(/^:::steps\s*\n([\s\S]*?)^:::\s*$/gm, (_, inner) => `\n<div class="steps">\n\n${inner}\n\n</div>\n`);
}

/* ------------------------------------------------------------------ *
 * Nav helpers
 * ------------------------------------------------------------------ */

// Groups may enumerate their items explicitly, or discover them from a directory
// outside _content (docs/findings/ is authored in place and published from there).
function discover(group) {
  const dir = join(ROOT, group.from);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort()
    .reverse()
    .map((f) => {
      const slug = f.replace(/\.md$/, '');
      const src = join(dir, f);
      const { data, body } = parseFrontMatter(readFileSync(src, 'utf8'));
      const h1 = body.match(/^#\s+(.+)$/m);
      return {
        path: `${group.pathPrefix}/${slug}`,
        label: data.title || (h1 ? h1[1] : slug),
        source: src,
        date: slug.slice(0, 10),
      };
    });
}

const pages = [];
for (const tab of nav.tabs) {
  for (const group of tab.groups) {
    if (group.from) group.items = discover(group);
    for (const item of group.items) {
      pages.push({ ...item, tab: tab.id, tabLabel: tab.label, group: group.label });
    }
  }
}
const pageByPath = new Map(pages.map((p) => [p.path, p]));

function url(path) {
  return path === 'index' ? '/' : `/${path}`;
}

function href(from, path) {
  // Relative links so the site works at any base path (project Pages, file://).
  const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const toFile = path === 'index' ? 'index.html' : `${path}.html`;
  const rel = relative(fromDir || '.', toFile) || 'index.html';
  return rel.startsWith('.') ? rel : rel;
}

function assetHref(from) {
  const depth = from.split('/').length - 1;
  return depth ? '../'.repeat(depth) : '';
}

// Pages serves assets with `cache-control: max-age=600` and the asset URLs
// carry no version, so for ten minutes after a deploy a returning visitor gets
// the new HTML against the old CSS — and a disk-cached copy can outlive that.
// Stamping the content hash into the query changes the URL only when the file
// changes: a deploy busts the cache at once, an unchanged deploy still hits it.
// Content-derived, so the build stays deterministic.
function assetTag(file) {
  const hash = createHash('sha256')
    .update(readFileSync(join(ROOT, 'assets', file)))
    .digest('hex')
    .slice(0, 8);
  return `assets/${file}?v=${hash}`;
}

/* ------------------------------------------------------------------ *
 * Template
 * ------------------------------------------------------------------ */

function renderSidebar(current) {
  const tab = nav.tabs.find((t) => t.id === current.tab);
  return tab.groups
    .map((g) => {
      const items = g.items
        .map((it) => {
          const active = it.path === current.path;
          return `<li><a class="${active ? 'active' : ''}" href="${href(current.path, it.path)}">${esc(it.label)}</a></li>`;
        })
        .join('');
      return `<div class="nav-group"><p class="nav-group-title">${esc(g.label)}</p><ul>${items}</ul></div>`;
    })
    .join('');
}

function renderTabs(current) {
  return nav.tabs
    .map((t) => {
      const first = t.groups[0].items[0].path;
      const active = t.id === current.tab;
      return `<a class="topnav-tab${active ? ' active' : ''}" href="${href(current.path, first)}">${esc(t.label)}</a>`;
    })
    .join('');
}

function renderToc(headings) {
  if (headings.length < 2) return '';
  const items = headings
    .map((h) => `<li class="toc-h${h.depth}"><a href="#${h.id}">${esc(h.text)}</a></li>`)
    .join('');
  return `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${items}</ul></nav>`;
}

function renderPrevNext(current) {
  const i = pages.findIndex((p) => p.path === current.path);
  const prev = pages[i - 1];
  const next = pages[i + 1];
  if (!prev && !next) return '';
  const a = prev
    ? `<a class="pn pn-prev" href="${href(current.path, prev.path)}"><span class="pn-dir">Previous</span><span class="pn-label">${esc(prev.label)}</span></a>`
    : '<span></span>';
  const b = next
    ? `<a class="pn pn-next" href="${href(current.path, next.path)}"><span class="pn-dir">Next</span><span class="pn-label">${esc(next.label)}</span></a>`
    : '<span></span>';
  return `<nav class="prevnext">${a}${b}</nav>`;
}

function layout({ page, title, description, content, headings }) {
  const A = assetHref(page.path);
  const isLanding = page.layout === 'landing';
  const isWide = page.layout === 'wide';
  const bodyClass = [isLanding && 'is-landing', isWide && 'is-wide'].filter(Boolean).join(' ');
  const editUrl = `${SITE.repo}/edit/main/docs/site/_content/${page.path}.md`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(SITE.name)} Docs</title>
<meta name="description" content="${esc(description || SITE.description)}">
<meta property="og:title" content="${esc(title)} — ${esc(SITE.name)}">
<meta property="og:description" content="${esc(description || SITE.description)}">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(SITE.favicon)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${A}${assetTag('docs.css')}">
<script>(function(){try{var t=localStorage.getItem('wb-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();</script>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">Skip to content</a>

<header class="topbar">
  <div class="topbar-inner">
    <button class="menu-btn" type="button" aria-label="Open navigation" aria-expanded="false">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
    </button>
    <a class="brand" href="${href(page.path, 'index')}">
      <span class="brand-mark" aria-hidden="true">${SITE.mark}</span>
      <span class="brand-name">${esc(SITE.name)}</span>
      <span class="brand-sub">Docs</span>
    </a>
    <button class="search-btn" type="button" data-search-open>
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
      <span>Search</span><kbd>⌘K</kbd>
    </button>
    <div class="topbar-actions">
      <a class="ghost" href="${SITE.repo}" target="_blank" rel="noopener">GitHub</a>
      <button class="theme-btn" type="button" aria-label="Toggle theme">
        <svg class="i-sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2 3.1 3.1"/></svg>
        <svg class="i-moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z"/></svg>
      </button>
    </div>
  </div>
  <nav class="topnav" aria-label="Sections"><div class="topnav-inner">${renderTabs(page)}</div></nav>
</header>

<div class="shell">
  <aside class="sidebar" aria-label="Documentation navigation">
    <div class="sidebar-inner">${renderSidebar(page)}</div>
  </aside>

  <main id="main" class="content">
    <article class="prose">
      <div class="page-head">
        <div>
          <p class="eyebrow">${esc(page.group)}</p>
          <h1>${esc(title)}</h1>
        </div>
        <button class="copy-page" type="button" title="Copy this page as Markdown for an agent">
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 12h1.5"/></svg>
          <span>Copy page</span>
        </button>
      </div>
      ${description ? `<p class="lede">${esc(description)}</p>` : ''}
      ${content}
    </article>
    ${renderPrevNext(page)}
    <footer class="page-foot">
      <a href="${editUrl}" target="_blank" rel="noopener">Edit this page on GitHub</a>
      <span>${esc(SITE.name)} v${esc(SITE.version)}</span>
    </footer>
  </main>

  <div class="toc-col">${renderToc(headings)}</div>
</div>

<div class="search-overlay" hidden>
  <div class="search-modal" role="dialog" aria-modal="true" aria-label="Search documentation">
    <div class="search-input-row">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
      <input type="search" placeholder="Search the docs…" aria-label="Search" autocomplete="off">
      <kbd>Esc</kbd>
    </div>
    <div class="search-results" role="listbox"></div>
  </div>
</div>

<script>window.__WB_BASE__=${JSON.stringify(A)};</script>
<script src="${A}${assetTag('docs.js')}" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

const searchIndex = [];
// A full wipe, so a page deleted from nav.json cannot survive in the output.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'assets'), join(OUT, 'assets'), { recursive: true });
// Without .nojekyll, Pages runs the output through Jekyll and drops every
// path that starts with an underscore.
cpSync(join(ROOT, '.nojekyll'), join(OUT, '.nojekyll'));

let built = 0;

for (const page of pages) {
  const src = readFileSync(page.source || join(CONTENT, `${page.path}.md`), 'utf8');
  const { data, body } = parseFrontMatter(src);
  const { marked, headings } = buildRenderer(page);

  // Discovered pages keep their own H1; drop it so the template's title isn't doubled.
  let md = page.source ? body.replace(/^#\s+.+\n+/, '') : body;

  // Rewrite intra-doc links (path.md → relative .html) BEFORE the block
  // extensions run: extractCards emits raw <a href>, which the rewrite can no
  // longer see. Paths are resolved relative to _content, so `../` is normal.
  md = md.replace(/\]\(([\w./-]+?)\.md(#[^)]*)?\)/g, (m, p, hash) => {
    if (/^https?:/.test(p)) return m;
    const target = normalize(join(dirname(page.path), p)).replace(/\\/g, '/');
    return `](${href(page.path, target)}${hash || ''})`;
  });

  md = extractTabs(md, marked, page.path);
  md = extractCards(md);
  md = extractSteps(md);
  md = preprocess(md);

  let html = marked.parse(md);
  html = postprocess(html, marked);

  const title = data.title || page.label;
  const out = layout({ page, title, description: data.description, content: html, headings });

  const file = join(OUT, page.path === 'index' ? 'index.html' : `${page.path}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
  built++;

  searchIndex.push({
    t: title,
    d: data.description || '',
    u: page.path === 'index' ? 'index.html' : `${page.path}.html`,
    s: page.tabLabel + ' › ' + page.group,
    h: headings.map((h) => ({ t: h.text, i: h.id })),
    b: html
      .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 4000),
  });
}

writeFileSync(join(OUT, 'search-index.json'), JSON.stringify(searchIndex));

/* ---- link check: a 404 in docs is a bug, so fail the build on one ---- */

const broken = [];
for (const page of pages) {
  const file = page.path === 'index' ? 'index.html' : `${page.path}.html`;
  const html = readFileSync(join(OUT, file), 'utf8');
  const fromDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  for (const m of html.matchAll(/href="([^"#][^"]*?)"/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|data:)/.test(target)) continue;
    // Strip the fragment and the query: asset URLs carry a ?v=<hash> cache
    // buster, which is not part of the path on disk.
    const resolved = normalize(join(fromDir, target.split(/[#?]/)[0]));
    if (!existsSync(join(OUT, resolved))) broken.push(`${file} → ${target}`);
  }
}

console.log(`built ${built} pages → docs/site/_site/`);
if (broken.length) {
  console.error(`\n${broken.length} broken internal link(s):`);
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}
