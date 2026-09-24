// markdown.js — tiny, dependency-free Markdown → safe-HTML renderer.
//
// Built for rendering streamed LLM output into the DOM: it is HTML-escaping
// (all source text is escaped before any tag is emitted, so model output can
// never inject markup) and streaming-tolerant (called repeatedly on the
// growing partial text — an unterminated ``` fence renders as code to the end,
// and unbalanced *, _, ` degrade to literal characters instead of breaking).
//
// Supports: fenced code blocks (``` / ~~~, optional language), inline code,
// ATX headings, bold/italic/strikethrough, [text](url) links (http(s)/mailto/
// relative/anchor only — javascript:/data: are rejected and left literal),
// ordered/unordered lists, blockquotes, horizontal rules, and paragraphs.
// Returns an HTML string; it does no DOM work of its own.
//
// Usage:
//   import { renderMarkdown } from "/lib/markdown.js";
//   el.innerHTML = renderMarkdown(text);
//
// Opt-in extensions (all off by default, so the output above never changes):
//   renderMarkdown(text, { tables: true, tasks: true, alerts: true })
//   tables  GitHub pipe tables -> <table class="md-table"> (alignment row optional)
//   tasks   "- [ ] x" / "- [x] x" -> <ul class="md-tasks"><li class="md-task[ done]">
//           <input type="checkbox" class="md-task-box" data-task-index="N">; N counts
//           task lines in source order (quoted ones included), for toggling back
//   alerts  "> [!NOTE]" (NOTE/TIP/IMPORTANT/WARNING/CAUTION) ->
//           <div class="md-alert md-alert-note"><div class="md-alert-title">NOTE</div>...

// A control char that never appears in real text — wraps protected inline-code
// spans while the emphasis/link passes run, then is swapped back out.
const SENTINEL = String.fromCharCode(0);

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Only allow hrefs that can't execute script. Input is already HTML-escaped.
function safeUrl(url) {
    const u = url.trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^mailto:/i.test(u)) return u;
    if (/^(#|\/|\.\.?\/)/.test(u)) return u; // anchor or relative path
    return null; // javascript:, data:, vbscript:, unknown scheme → reject
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TASK_ITEM = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;

// Does a line begin a block-level construct? Paragraph accumulation stops here.
function isBlockStart(line, o) {
    return (
        /^(\s*)(```+|~~~+)/.test(line) ||   // fence
        /^#{1,6}\s+/.test(line) ||          // heading
        /^\s*>\s?/.test(line) ||            // blockquote
        /^(\s*)[-*+]\s+/.test(line) ||      // ul
        /^(\s*)\d+[.)]\s+/.test(line) ||    // ol
        /^\s*(---+|\*\*\*+|___+)\s*$/.test(line) || // hr
        (!!(o && o.tables) && TABLE_ROW.test(line))
    );
}

function table(rows) {
    const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const hasAlign = rows.length > 1 && /^[\s|:-]+$/.test(rows[1]) && rows[1].indexOf("-") >= 0;
    const align = hasAlign ? cells(rows[1]).map((c) =>
        /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : /^:-+/.test(c) ? "left" : "") : [];
    const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${inline(c)}</${tag}>`;
    const head = cells(rows[0]).map((c, k) => td("th", c, k)).join("");
    const body = rows.slice(hasAlign ? 2 : 1).map((r) => `<tr>${cells(r).map((c, k) => td("td", c, k)).join("")}</tr>`).join("");
    return `<table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// Inline formatting on ONE run of raw text. Escapes first, then applies spans.
function inline(raw) {
    let s = escapeHtml(raw);

    // Protect inline code spans so *, _, [ inside them are not reinterpreted.
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_m, c) => {
        codes.push(c);
        return SENTINEL + (codes.length - 1) + SENTINEL;
    });

    // Links — only when the URL passes the scheme allow-list.
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
        const href = safeUrl(url);
        return href ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : m;
    });

    // Emphasis. Bold before italic; the italic patterns avoid eating ** / __.
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    // Single newlines inside a paragraph become hard breaks.
    s = s.replace(/\n/g, "<br>");

    // Restore protected code spans (content already escaped).
    s = s.replace(new RegExp(SENTINEL + "(\\d+)" + SENTINEL, "g"), (_m, n) => {
        return `<code class="md-inline">${codes[+n]}</code>`;
    });
    return s;
}

function codeBlock(code, lang) {
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
    return `<pre class="md-code"${langAttr}><code>${escapeHtml(code)}</code></pre>`;
}

export function renderMarkdown(src, opts) {
    if (src == null) return "";
    return render(src, opts || {}, { task: 0 });
}

function render(src, o, st) {
    const lines = String(src).split(/\r?\n/);
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code block. Streaming-tolerant: an unterminated fence still
        // renders everything after it as code.
        const fence = line.match(/^(\s*)(```+|~~~+)(.*)$/);
        if (fence) {
            const marker = fence[2][0] === "`" ? "```" : "~~~";
            const lang = (fence[3] || "").trim().split(/\s+/)[0] || "";
            const buf = [];
            i++;
            while (i < lines.length) {
                if (new RegExp("^\\s*" + marker + "+\\s*$").test(lines[i])) { i++; break; }
                buf.push(lines[i]);
                i++;
            }
            out.push(codeBlock(buf.join("\n"), lang));
            continue;
        }

        // Blank line — paragraph separator.
        if (/^\s*$/.test(line)) { i++; continue; }

        // Horizontal rule.
        if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

        // ATX heading.
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

        // Blockquote — consume consecutive `>` lines, render recursively.
        if (/^\s*>\s?/.test(line)) {
            const buf = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                buf.push(lines[i].replace(/^\s*>\s?/, ""));
                i++;
            }
            const body = buf.join("\n");
            const alert = o.alerts && body.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?([\s\S]*)$/i);
            if (alert) {
                const kind = alert[1].toUpperCase();
                out.push(`<div class="md-alert md-alert-${kind.toLowerCase()}"><div class="md-alert-title">${kind}</div>` +
                         `${render(alert[2], o, st)}</div>`);
            } else {
                out.push(`<blockquote>${render(body, o, st)}</blockquote>`);
            }
            continue;
        }

        // Pipe table: a header row plus at least one more row.
        if (o.tables && TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_ROW.test(lines[i + 1])) {
            const rows = [];
            while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(lines[i++]);
            out.push(table(rows));
            continue;
        }

        // Task list — a run of "- [ ] item" lines.
        if (o.tasks && TASK_ITEM.test(line)) {
            const items = [];
            let m;
            while (i < lines.length && (m = lines[i].match(TASK_ITEM))) {
                const done = m[2] !== " ";
                items.push(`<li class="md-task${done ? " done" : ""}"><input type="checkbox" class="md-task-box" ` +
                           `data-task-index="${st.task++}"${done ? " checked" : ""}> <span>${inline(m[3])}</span></li>`);
                i++;
            }
            out.push(`<ul class="md-tasks">${items.join("")}</ul>`);
            continue;
        }

        // Lists — a run of same-kind items.
        const ordered = /^(\s*)\d+[.)]\s+/.test(line);
        const itemRe = ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/;
        if (itemRe.test(line)) {
            const items = [];
            while (i < lines.length) {
                const m = lines[i].match(itemRe);
                if (!m || (o.tasks && TASK_ITEM.test(lines[i]))) break;
                items.push(`<li>${inline(m[2])}</li>`);
                i++;
            }
            const tag = ordered ? "ol" : "ul";
            out.push(`<${tag}>${items.join("")}</${tag}>`);
            continue;
        }

        // Paragraph — accumulate until a blank line or the next block start.
        const buf = [];
        // (The first line is always taken: a lone table row is paragraph text.)
        while (i < lines.length && !/^\s*$/.test(lines[i]) && (!buf.length || !isBlockStart(lines[i], o))) {
            buf.push(lines[i]);
            i++;
        }
        out.push(`<p>${inline(buf.join("\n"))}</p>`);
    }

    return out.join("\n");
}
