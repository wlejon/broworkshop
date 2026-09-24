// samples.js — the notes a fresh notebook starts with.

const note = (id, title, pinned, favorite, tags, content) => {
    const now = new Date().toISOString();
    return { id, title, pinned, favorite, tags, createdAt: now, modifiedAt: now, content };
};

export function sampleNotes() {
    return [
        note('doc_welcome', 'Welcome to Desktop Notebook', true, true, ['Getting Started', 'Guide'],
`# Welcome to Desktop Notebook

**Desktop Notebook** is a desktop-class Markdown editor built on the **bro** runtime.

---

## Core features
- **Native menu bar (\`bro.menu\`)**: File, Edit, View and Window menus with keyboard shortcuts.
- **Window controls (\`bro.window\`)**: minimize, maximize and pin on top.
- **Persistence**: notes, theme, zoom and view mode survive restarts.
- **Live preview**: code blocks, task lists, tables and callouts render as you type.
- **Native file dialogs**: open and save \`.md\` files, export HTML.

---

## Shortcuts
| Shortcut | Action |
| :--- | :--- |
| \`Ctrl + N\` | New note |
| \`Ctrl + S\` | Save |
| \`Ctrl + O\` | Open a file |
| \`Ctrl + B\` | Toggle the sidebar |
| \`Ctrl + P\` | Toggle the preview |
| \`Ctrl + 1 / 2 / 3\` | Split / editor only / preview only |

---

> [!TIP]
> Use the formatting ribbon above the editor to wrap text in bold, code or headings, or to insert tables.`),

        note('doc_web_standards', 'Advanced DOM & Web Standards Notes', false, true, ['Engineering', 'W3C'],
`# Advanced DOM & Web Standards Notes

Notes on web platform specifications and native engine integrations.

## 1. DOM Range & Selection Level 3
- \`Range.surroundContents(elem)\`: wraps contiguous nodes in a parent.
- \`Range.extractContents()\`: removes contents and returns a \`DocumentFragment\`.
- \`Range.cloneContents()\`: deep clones range nodes into a disconnected fragment.
- Caret tracking via \`Range.getBoundingClientRect()\` and \`Range.getClientRects()\`.

## 2. MutationObserver
- Watches DOM tree changes asynchronously with granular records.
- Options: \`{ childList: true, attributes: true, characterData: true, subtree: true }\`.

## 3. HarfBuzz text shaping
- Bidirectional and complex scripts (Devanagari, Arabic, Hebrew).
- OpenType ligatures (\`ffi\`, \`ffl\`, \`fl\`) and kerning pairs.

\`\`\`javascript
const r = document.createRange();
r.selectNodeContents(document.querySelector('h1'));
console.log(r.getBoundingClientRect().width);
\`\`\`
`),

        note('doc_tasks', 'Project Roadmap & Tasks', false, false, ['Tasks', 'Planning'],
`# Project Roadmap & Tasks

### Current milestone
- [x] Sidebar with search and pinning
- [x] Live preview with tables and callouts
- [x] Find & replace
- [ ] Tag filtering

---

### Integrations
| Module | API | Status |
| :--- | :--- | :---: |
| **Menu bar** | \`bro.menu\` | wired |
| **Window** | \`bro.window\` | wired |
| **Dialogs** | native dialogs + \`fs\` | wired |
| **Markdown** | \`/lib/markdown.js\` | active |
`),
    ];
}
