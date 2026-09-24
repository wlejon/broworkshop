// docs.js — the library: import, persistence, reading positions.
// Documents live in localStorage with their full text, so an entry survives
// its source file moving. Each record carries its own reading position and
// engine / voice / speed overrides:
//   { id, title, sourcePath, addedAt, sentenceCount, pos,
//     engine|null, voice|null, speaker|null, speed|null, text }

import { segment, stripHtml, stripMarkdown } from "./text.js";

const fs = require('fs');

export const LIBRARY_KEY = 'reader:library';

/** Newest first. Mutated in place, so importers always see the live list. */
export const library = [];

export function loadLibrary() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(LIBRARY_KEY)) || []; } catch (e) {}
    library.splice(0, library.length, ...list);
}
export function saveLibrary() {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); } catch (e) {}
}
export function getDoc(id) { return library.find((d) => d.id === id) || null; }
export function deleteDocument(id) {
    const i = library.findIndex((d) => d.id === id);
    if (i >= 0) library.splice(i, 1);
    saveLibrary();
}

// ── import ───────────────────────────────────────────────────────────────────

export const IMPORT_EXTS = ['txt', 'md', 'markdown', 'html', 'htm', 'xhtml', 'text', 'log'];
export const IMPORT_FILTER = 'Documents|txt;md;markdown;html;htm;xhtml';
function extOf(p) { const m = /\.([a-z0-9]+)$/i.exec(p); return m ? m[1].toLowerCase() : ''; }

export function extractText(raw, kind) {
    if (kind === 'html' || kind === 'htm' || kind === 'xhtml') return stripHtml(raw);
    if (kind === 'md' || kind === 'markdown') return stripMarkdown(raw);
    return raw;   // txt / unknown -> as-is
}

export function titleFrom(text, fallback) {
    for (const line of String(text).split('\n')) {
        const t = line.replace(/^#+\s*/, '').trim();
        if (t) return t.length > 64 ? t.slice(0, 61) + '…' : t;
    }
    return fallback || 'Untitled';
}

/** The one entry point for new documents (file import, drag-drop, tests). Returns the record. */
export function addDocument(title, text, sourcePath) {
    const seg = segment(text);
    if (!seg.sentences.length) throw new Error('no readable text found');
    const doc = {
        id: 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        title: title || titleFrom(text, ''),
        sourcePath: sourcePath || '',
        addedAt: Date.now(),
        sentenceCount: seg.sentences.length,
        pos: 0,
        engine: null, voice: null, speaker: null, speed: null,
        text,
    };
    library.unshift(doc);
    saveLibrary();
    return doc;
}

export function importFile(path) {
    const kind = extOf(path);
    if (kind && IMPORT_EXTS.indexOf(kind) < 0) throw new Error('unsupported file type: .' + kind + ' (txt / md / html)');
    const text = extractText(fs.readFileSync(path, 'utf-8'), kind);
    const base = path.replace(/\\/g, '/').split('/').pop();
    return addDocument(titleFrom(text, base), text, path);
}

/** Import several paths; returns { last, errors[] }. */
export function importPaths(paths) {
    let last = null;
    const errors = [];
    for (const p of paths) {
        try { last = importFile(p.replace(/\\/g, '/')); }
        catch (e) { errors.push(p.split(/[\\/]/).pop() + ': ' + e.message); }
    }
    return { last, errors };
}
