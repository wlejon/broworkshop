// ═══ library: import, persistence, reading positions ═════════════════════════
// Documents live in localStorage (persisted per-app by the runtime), full text
// included, so a library entry survives its source file moving. Each record
// carries its own reading position and voice/engine/speed overrides.
import { segment, stripHtml, stripMarkdown } from "/app/lib/text.js";

export const _fs = require('fs');

const KEY = 'reader:library';
export let library = [];   // newest first
// record: { id, title, sourcePath, addedAt, sentenceCount, pos,
//           engine|null, voice|null, speaker|null, speed|null, text }

export function loadLibrary() {
  try { library = JSON.parse(localStorage.getItem(KEY)) || []; }
  catch (e) { library = []; }
}
export function saveLibrary() {
  try { localStorage.setItem(KEY, JSON.stringify(library)); } catch (e) {}
}
export function getDoc(id) { return library.find((d) => d.id === id) || null; }
export function deleteDocument(id) {
  library = library.filter((d) => d.id !== id);
  saveLibrary();
}

// ── import ───────────────────────────────────────────────────────────────────
export const IMPORT_EXTS = ['txt', 'md', 'markdown', 'html', 'htm', 'xhtml', 'text', 'log'];
function extOf(p) { const m = /\.([a-z0-9]+)$/i.exec(p); return m ? m[1].toLowerCase() : ''; }

export function extractText(raw, kind) {
  if (kind === 'html' || kind === 'htm' || kind === 'xhtml') return stripHtml(raw);
  if (kind === 'md' || kind === 'markdown') return stripMarkdown(raw);
  return raw;   // txt / unknown → as-is
}

export function titleFrom(text, fallback) {
  for (const line of String(text).split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return t.length > 64 ? t.slice(0, 61) + '…' : t;
  }
  return fallback || 'Untitled';
}

// The one entry point for new documents — file imports, drag-drop, and the
// headless test seam all land here. Returns the created record.
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
  if (kind && IMPORT_EXTS.indexOf(kind) < 0)
    throw new Error('unsupported file type: .' + kind + ' (txt / md / html)');
  const raw = _fs.readFileSync(path, 'utf-8');
  const text = extractText(raw, kind);
  const base = path.replace(/\\/g, '/').split('/').pop();
  return addDocument(titleFrom(text, base), text, path);
}
