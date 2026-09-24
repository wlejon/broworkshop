// files.js — notes to and from disk: open .md/.txt, save as Markdown, export
// a standalone HTML page. The *Dialog functions ask with native dialogs
// (never from tests: they block); the path-taking ones do the IO.

import { pickFile, pickSaveFile, baseName } from "/lib/kit/ml.js";

const fs = require('fs');

const escape = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => String(s || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'note';

/** { title, content, path } of a text file (title = file name without extension). */
export function readNoteFile(path) {
    return { title: baseName(path).replace(/\.[^.]+$/, ''), content: fs.readFileSync(path, 'utf8'), path };
}

export function writeMarkdown(path, content) {
    fs.writeFileSync(path, content, 'utf8');
    return path;
}

/** A standalone light page around the preview's HTML. */
export function htmlPage(title, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escape(title)}</title>
<style>
body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #24292e; }
h1, h2, h3 { border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
code { background: #f6f8fa; padding: 2px 5px; border-radius: 4px; font-family: monospace; }
pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
pre code { padding: 0; }
blockquote { border-left: 4px solid #dfe2e5; color: #6a737d; margin: 0; padding-left: 16px; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #dfe2e5; padding: 8px 12px; }
th { background: #f6f8fa; }
.md-tasks { list-style: none; padding-left: 0; }
.md-task.done span { text-decoration: line-through; color: #6a737d; }
.md-alert { border-left: 4px solid #0969da; padding: 8px 16px; margin: 16px 0; background: #f6f8fa; }
.md-alert-title { font-weight: 600; }
.md-alert-tip { border-color: #1a7f37; } .md-alert-warning { border-color: #9a6700; }
.md-alert-caution { border-color: #cf222e; } .md-alert-important { border-color: #8250df; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

export function writeHtml(path, title, bodyHtml) {
    fs.writeFileSync(path, htmlPage(title, bodyHtml), 'utf8');
    return path;
}

export function openDialog() {
    const p = pickFile('Markdown Files|md;markdown|Text Files|txt|All Files|*');
    return p ? readNoteFile(p) : null;
}

/** Returns the written path, or null when cancelled. */
export function saveAsDialog(title, content) {
    const p = pickSaveFile('Markdown File|md|Text File|txt', slug(title) + '.md');
    return p ? writeMarkdown(/\.[a-z]+$/i.test(p) ? p : p + '.md', content) : null;
}

export function exportHtmlDialog(title, bodyHtml) {
    const p = pickSaveFile('HTML File|html', slug(title) + '.html');
    return p ? writeHtml(/\.html?$/i.test(p) ? p : p + '.html', title, bodyHtml) : null;
}
