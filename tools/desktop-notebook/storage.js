// storage.js — Document persistence, native file IO via bro.dialogs / fs, and settings via bro.settings.

const STORAGE_KEY = 'desktop_notebook:documents';
const SETTINGS_KEY = 'desktop_notebook:settings';

export class NotebookStorage {
    constructor() {
        this.documents = [];
        this.settings = this.loadSettings();
        this.loadDocuments();
    }

    // ── Settings Management ───────────────────────────────────────────────────

    loadSettings() {
        const defaults = {
            theme: 'dark',
            fontSize: 15,
            lineNumbers: true,
            wordWrap: true,
            viewMode: 'split', // 'split' | 'editor' | 'preview'
            zoom: 100,
            activeDocId: null
        };

        // Try reading from bro.settings if available
        let saved = null;
        if (typeof bro !== 'undefined' && bro.settings && typeof bro.settings.get === 'function') {
            try {
                saved = bro.settings.get(SETTINGS_KEY);
            } catch (e) {}
        }

        if (!saved) {
            try {
                const raw = localStorage.getItem(SETTINGS_KEY);
                if (raw) saved = JSON.parse(raw);
            } catch (e) {}
        }

        return Object.assign(defaults, saved || {});
    }

    saveSettings(newSettings) {
        Object.assign(this.settings, newSettings);

        if (typeof bro !== 'undefined' && bro.settings && typeof bro.settings.set === 'function') {
            try {
                bro.settings.set(SETTINGS_KEY, this.settings);
            } catch (e) {}
        }

        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
        } catch (e) {}
    }

    // ── Document Store ────────────────────────────────────────────────────────

    loadDocuments() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                this.documents = JSON.parse(raw);
            }
        } catch (e) {
            console.warn('Failed to load documents from localStorage:', e);
        }

        if (!this.documents || this.documents.length === 0) {
            this.documents = this._getDefaultDocuments();
            this.saveDocuments();
        }

        return this.documents;
    }

    saveDocuments() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.documents));
        } catch (e) {
            console.error('Failed to save documents to localStorage:', e);
        }
    }

    getAllDocuments() {
        return this.documents;
    }

    getDocumentById(id) {
        return this.documents.find(d => d.id === id) || null;
    }

    createDocument(title = 'Untitled Note', content = '', tags = []) {
        const id = 'doc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const doc = {
            id,
            title: title || 'Untitled Note',
            content: content || '',
            tags: tags || [],
            pinned: false,
            favorite: false,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        };

        this.documents.unshift(doc);
        this.saveDocuments();
        return doc;
    }

    updateDocument(id, updates) {
        const doc = this.getDocumentById(id);
        if (!doc) return null;

        Object.assign(doc, updates);
        doc.modifiedAt = new Date().toISOString();

        // If title wasn't explicitly changed, extract from first heading or line
        if (!updates.title && updates.content) {
            const firstLine = updates.content.trim().split('\n')[0] || '';
            const match = firstLine.match(/^#+\s*(.*)$/);
            if (match && match[1]) {
                doc.title = match[1].slice(0, 40);
            }
        }

        this.saveDocuments();
        return doc;
    }

    deleteDocument(id) {
        const index = this.documents.findIndex(d => d.id === id);
        if (index === -1) return false;

        this.documents.splice(index, 1);
        if (this.documents.length === 0) {
            this.createDocument('Quick Note', '# Quick Note\n\nStart typing here...');
        }
        this.saveDocuments();
        return true;
    }

    // ── Native File I/O Operations ────────────────────────────────────────────

    async openFileDialog() {
        // 1. Check for native bro showOpenFileDialog
        if (typeof showOpenFileDialog === 'function') {
            try {
                const picked = showOpenFileDialog('Markdown Files|md|Text Files|txt|All Files|*');
                if (picked && picked.length > 0) {
                    const filePath = picked[0];
                    if (typeof require !== 'undefined') {
                        const fs = require('fs');
                        const path = require('path');
                        const content = fs.readFileSync(filePath, 'utf8');
                        const filename = path.basename(filePath, path.extname(filePath));
                        return { title: filename, content, path: filePath };
                    }
                }
            } catch (e) {
                console.warn('Native open dialog failed:', e);
            }
        }

        // 2. Web File API fallback
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.md,.txt,.markdown,text/plain,text/markdown';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) { resolve(null); return; }

                const reader = new FileReader();
                reader.onload = (event) => {
                    const name = file.name.replace(/\.[^/.]+$/, '');
                    resolve({ title: name, content: event.target.result, path: null });
                };
                reader.readAsText(file);
            };
            input.click();
        });
    }

    async saveFileDialog(content, filename = 'document.md') {
        // 1. Check for native bro showSaveFileDialog
        if (typeof showSaveFileDialog === 'function') {
            try {
                const cleanName = filename.endsWith('.md') ? filename : filename + '.md';
                const picked = showSaveFileDialog('Markdown File|md|Text File|txt', cleanName);
                if (picked) {
                    if (typeof require !== 'undefined') {
                        const fs = require('fs');
                        fs.writeFileSync(picked, content, 'utf8');
                        return { success: true, path: picked };
                    }
                }
            } catch (e) {
                console.warn('Native save dialog failed:', e);
            }
        }

        // 2. Web Download fallback
        try {
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename.endsWith('.md') ? filename : filename + '.md';
            a.click();
            URL.revokeObjectURL(url);
            return { success: true, path: null };
        } catch (e) {
            console.error('Save file error:', e);
            return { success: false, error: e.message };
        }
    }

    exportHtml(htmlBody, title = 'Document') {
        const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${this._escape(title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #24292e; }
h1, h2, h3 { border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
code { background: #f6f8fa; padding: 2px 5px; border-radius: 4px; font-family: monospace; }
pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
blockquote { border-left: 4px solid #dfe2e5; color: #6a737d; margin: 0; padding-left: 16px; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
table, th, td { border: 1px solid #dfe2e5; padding: 8px 12px; }
th { background: #f6f8fa; }
</style>
</head>
<body>
<h1>${this._escape(title)}</h1>
${htmlBody}
</body>
</html>`;

        const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.toLowerCase().replace(/\s+/g, '-')}.html`;
        a.click();
        URL.revokeObjectURL(url);
    }

    _escape(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _getDefaultDocuments() {
        return [
            {
                id: 'doc_welcome',
                title: 'Welcome to Desktop Notebook',
                pinned: true,
                favorite: true,
                tags: ['Getting Started', 'Guide'],
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
                content: `# Welcome to Desktop Notebook 🚀

**Desktop Notebook** is a modern, desktop-class Markdown and document editing suite built for the **bro** platform.

---

## ✨ Core Features
- **Native OS Menu Bar (\`bro.menu\`)**: Full File, Edit, View, and Window native controls with accelerator shortcuts.
- **Window Controls (\`bro.window\`)**: Minimize, maximize, pin on top, and dynamic geometry.
- **Settings Persistence (\`bro.settings\`)**: Themes, zoom level, line numbers, and split modes persist across sessions.
- **Live Markdown Preview**: Instant syntax rendering with code blocks, task lists, tables, and callouts.
- **Native File Dialogs (\`bro.dialogs\`)**: Open and save \`.md\` files directly to and from your disk.

---

## ⌨️ Productivity Shortcuts
| Shortcut | Action |
| :--- | :--- |
| \`Ctrl + N\` | Create New Note |
| \`Ctrl + S\` | Save Document |
| \`Ctrl + O\` | Open File from Disk |
| \`Ctrl + B\` | Toggle Document Sidebar |
| \`Ctrl + P\` | Toggle Live Preview |
| \`Ctrl + 1 / 2 / 3\` | Split View / Editor Only / Preview Only |

---

> [!TIP]
> Use the formatting ribbon above the editor to quickly wrap text in bold, code, headings, or insert tables!`
            },
            {
                id: 'doc_web_standards',
                title: 'Advanced DOM & Web Standards Notes',
                pinned: false,
                favorite: true,
                tags: ['Engineering', 'W3C'],
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
                content: `# Advanced DOM & Web Standards Architecture

Notes on modern web platform specifications and native engine integrations.

## 1. DOM Range & Selection Level 3
- \`Range.surroundContents(elem)\`: Wraps contiguous document nodes into a parent wrapper.
- \`Range.extractContents()\`: Removes contents and returns a live \`DocumentFragment\`.
- \`Range.cloneContents()\`: Deep clones range nodes into a disconnected fragment.
- Caret tracking via \`Range.getBoundingClientRect()\` and \`Range.getClientRects()\`.

## 2. MutationObserver
- Monitors DOM tree changes asynchronously with granular record streams.
- Config parameters: \`{ childList: true, attributes: true, characterData: true, subtree: true }\`.

## 3. HarfBuzz Text Shaping
- Bidirectional and complex script shaping (Devanagari, Arabic, Hebrew).
- OpenType contextual ligatures (\`ffi\`, \`ffl\`, \`fl\`) and kerning pairs.

\`\`\`javascript
// Example: Shaping text in bro
const shaped = bro.text.shape("office fluffy", { family: "Calibri", size: 36 });
console.log(\`Clusters: \${shaped.clusters.length}, Glyphs: \${shaped.glyphCount}\`);
\`\`\`
`
            },
            {
                id: 'doc_tasks',
                title: 'Project Roadmap & Tasks',
                pinned: false,
                favorite: false,
                tags: ['Tasks', 'Planning'],
                createdAt: new Date().toISOString(),
                modifiedAt: new Date().toISOString(),
                content: `# Project Roadmap & Sprint Checklist

### Current Milestone: Chunk 3 - Advanced DOM & Desktop OS
- [x] Implement \`demos/range-selection-lab\`
- [x] Implement \`demos/waapi-lab\`
- [x] Implement \`tools/desktop-notebook\`
- [x] Update \`launcher/apps.json\`
- [ ] Run full smoke test suite

---

### Key Technical Specs
| Module | Spec / API | Status |
| :--- | :--- | :--- |
| **Menu Bar** | \`bro.menu\` | ✅ Wired |
| **Window State** | \`bro.window\` | ✅ Integrated |
| **Dialogs** | \`bro.dialogs\` / Node \`fs\` | ✅ Integrated |
| **Markdown** | Custom Extended Renderer | ✅ Active |
`
            }
        ];
    }
}
