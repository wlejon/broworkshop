// ═══ document text: format stripping + paragraph / sentence segmentation ═════
// Import formats reduce to plain text with paragraph structure (blank-line
// separated); segmentation turns that into the sentence list playback runs on.

// ── HTML → text ──────────────────────────────────────────────────────────────
// Block-level boundaries become paragraph breaks; script/style/head content is
// dropped; entities are decoded. Good enough for saved articles and exports —
// this is a reading app, not a browser.
const BLOCK_TAGS = 'p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|tr|blockquote|pre|figure|figcaption|dt|dd|table|ul|ol';
export function stripHtml(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|head|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<br\s*\/?\s*>/gi, '\n');
  s = s.replace(new RegExp('</?(' + BLOCK_TAGS + ')\\b[^>]*>', 'gi'), '\n\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©', trade: '™', deg: '°' };
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] || m);
}

// ── Markdown → text ──────────────────────────────────────────────────────────
// Keeps readable prose, drops what can't be read aloud: fenced code blocks go
// entirely, images go, link/emphasis markers unwrap to their text. Headings and
// list items become their own paragraphs so they read as natural pauses.
export function stripMarkdown(md) {
  let s = String(md).replace(/\r\n?/g, '\n');
  s = s.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');   // fenced code blocks
  s = s.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*$/gm, '');             // unterminated fence → drop to end
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                      // images
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');                   // links → text
  s = s.replace(/^#{1,6}\s+(.*)$/gm, '\n\n$1\n\n');                // headings → own paragraph
  s = s.replace(/^\s*(---+|\*\*\*+|___+)\s*$/gm, '\n\n');          // hr
  s = s.replace(/^\s*>\s?/gm, '');                                 // blockquote markers
  s = s.replace(/^(\s*)([-*+]|\d+[.)])\s+/gm, '\n\n');             // list items → own paragraph
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2');                        // bold
  s = s.replace(/(\*|_)([^*_\n]+)\1/g, '$2');                      // italic
  s = s.replace(/~~(.+?)~~/g, '$1');                               // strikethrough
  s = s.replace(/`([^`\n]+)`/g, '$1');                             // inline code → text
  return s;
}

// ── segmentation ─────────────────────────────────────────────────────────────
export function toParagraphs(text) {
  return String(text).replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Don't break after common abbreviations, single initials, or "no." — only when
// the terminator is a period (?, !, … always end a sentence).
const NO_BREAK = /\b(?:mr|mrs|ms|dr|prof|rev|gen|sen|rep|sgt|col|capt|lt|st|sr|jr|vs|etc|approx|dept|est|fig|no|nos|inc|ltd|co|corp|ave|blvd|min|max|e\.g|i\.e|cf|al|pp|vol|ch|sec|ed)\.$|\b[A-Za-z]\.$/i;

export function splitSentences(para) {
  const out = [];
  const re = /[.!?…]+["'”’)\]]*(?:\s+|$)/g;
  let start = 0, m;
  while ((m = re.exec(para))) {
    const end = m.index + m[0].length;
    if (m[0][0] === '.') {
      const head = para.slice(start, m.index + 1);       // …through the period
      if (NO_BREAK.test(head.slice(-8))) continue;       // abbreviation/initial — keep going
    }
    // sentences don't start lowercase: an ellipsis pause ("Yes… absolutely.")
    // or dialogue attribution ('"Fine." she said.') continues the sentence.
    if (end < para.length && /[a-z]/.test(para[end])) continue;
    const s = para.slice(start, end).trim();
    if (s) out.push(s);
    start = end;
  }
  const tail = para.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// text → { paragraphs: [string], sentences: [{ text, para }] }
export function segment(text) {
  const paragraphs = toParagraphs(text);
  const sentences = [];
  paragraphs.forEach((p, pi) => {
    for (const s of splitSentences(p)) sentences.push({ text: s, para: pi });
  });
  return { paragraphs, sentences };
}
