// parser.js — the DOMParser tab: parse markup under a MIME type, report the
// structure, and draw the resulting tree (built with DOM nodes, not HTML
// strings, so the markup being inspected can never inject into the page).

import { $, h, clear } from '/lib/kit/dom.js';

export const SAMPLES = {
    html: { mime: 'text/html', text: `<div class="card" id="user-123">
  <h3 class="title">Web Standards <span>2026</span></h3>
  <p>DOMParser parses strings into robust DOM documents.</p>
  <ul class="tag-list">
    <li data-status="ready">Range API</li>
    <li data-status="ready">MutationObserver</li>
    <li data-status="active">HarfBuzz Text</li>
  </ul>
</div>` },
    svg: { mime: 'image/svg+xml', text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#58a6ff" />
      <stop offset="100%" stop-color="#a371f7" />
    </linearGradient>
  </defs>
  <rect width="240" height="120" rx="12" fill="url(#grad)" />
  <circle cx="60" cy="60" r="32" fill="#ffffff" opacity="0.8" />
  <text x="110" y="68" fill="#ffffff" font-size="20" font-weight="bold">DOM SVG</text>
</svg>` },
    xml: { mime: 'application/xml', text: `<?xml version="1.0" encoding="UTF-8"?>
<application id="app-demo" version="2.4.0">
  <metadata>
    <author>bro workshop</author>
    <engine>bro-platform</engine>
  </metadata>
  <features>
    <feature enabled="true">RangeSelection</feature>
    <feature enabled="true">HarfBuzzShaper</feature>
  </features>
</application>` },
    error: { mime: 'application/xml', text: `<xml>
  <unclosedTag>
    <message>This is intentionally malformed to trigger a parsererror</message>
</xml>` },
};

export const parserState = { last: null };

/** Element / attribute / text counts and depth under `root`. */
export function measureTree(root) {
    const m = { elements: 0, textNodes: 0, attributes: 0, depth: 0 };
    const walk = (n, d) => {
        if (!n) return;
        if (d > m.depth) m.depth = d;
        if (n.nodeType === 1) {
            m.elements++;
            m.attributes += n.attributes ? n.attributes.length : 0;
            for (const c of n.childNodes) walk(c, d + 1);
        } else if (n.nodeType === 3 && n.data.trim()) {
            m.textNodes++;
        }
    };
    walk(root, 1);
    return m;
}

/** A plain-data tree: { tag, attributes, children } / { text }. Blank text dropped. */
export function treeOf(node) {
    if (node.nodeType === 3) {
        const t = node.data.trim();
        return t ? { text: t.length > 50 ? t.slice(0, 50) + '…' : t } : null;
    }
    if (node.nodeType !== 1) return null;
    const attributes = {};
    for (const a of node.attributes) attributes[a.name] = a.value;
    return { tag: node.nodeName.toLowerCase(), attributes, children: [...node.childNodes].map(treeOf).filter(Boolean) };
}

/**
 * parseFromString + analysis. The root is <body> for text/html and the
 * documentElement for XML types, where a document that is not well-formed
 * comes back holding a <parsererror>.
 */
export function parse(markup, mime) {
    const t0 = Date.now();
    let doc;
    try {
        doc = new DOMParser().parseFromString(markup, mime);
    } catch (e) {
        return { ok: false, mime, ms: Date.now() - t0, error: e.message };
    }
    const perr = doc.querySelector('parsererror');
    if (perr) return { ok: false, mime, ms: Date.now() - t0, error: perr.textContent };
    const html = mime === 'text/html';
    const root = html ? doc.body : doc.documentElement;
    let serialized;
    try { serialized = new XMLSerializer().serializeToString(doc); } catch (e) { serialized = `(serialization error: ${e.message})`; }
    return {
        ok: true, mime, ms: Date.now() - t0, doc,
        metrics: measureTree(root), tree: treeOf(root), serialized,
    };
}

// --- the tab ------------------------------------------------------------------------

export function initParser() {
    $('#parserPreset').addEventListener('change', () => loadPreset($('#parserPreset').value));
    $('#btnParse').addEventListener('click', runParser);
    loadPreset('html');
}

export function loadPreset(key) {
    const s = SAMPLES[key];
    if (!s) return null;
    $('#parserPreset').value = key;
    $('#parserInput').value = s.text;
    $('#parserMime').value = s.mime;
    return runParser();
}

export function runParser() {
    const res = parserState.last = parse($('#parserInput').value, $('#parserMime').value);
    const stats = $('#parserStats'), tree = $('#parserTree');
    clear(tree);
    if (!res.ok) {
        stats.textContent = `parse error (${res.ms} ms)`;
        stats.className = 'k-chip err';
        tree.appendChild(h('div.error', null, h('b', null, 'Parser error'), '\n' + res.error));
        return res;
    }
    const m = res.metrics;
    stats.textContent = `${m.elements} elements, ${m.attributes} attrs, depth ${m.depth} (${res.ms} ms)`;
    stats.className = 'k-chip on';
    tree.appendChild(nodeView(res.tree));
    return res;
}

function nodeView(n) {
    if (n.text !== undefined) return h('div.node', null, h('span.text', null, `"${n.text}"`));
    const attrs = [];
    for (const k in n.attributes) attrs.push(' ', h('span.attr', null, k), '=', h('span.val', null, `"${n.attributes[k]}"`));
    return h('div.node', null,
        h('span.tag', null, '<' + n.tag), attrs, h('span.tag', null, '>'),
        n.children.map(nodeView),
        h('span.tag', null, `</${n.tag}>`));
}
