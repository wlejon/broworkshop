// app.js — App initialization, layout handling, and module orchestration for Desktop Notebook.

import { NotebookStorage } from './storage.js';
import { NotebookEditor } from './editor.js';
import { DesktopMenuBar } from './menu.js';

class DesktopNotebookApp {
    constructor() {
        this.dom = {
            sidebar: document.getElementById('sidebar'),
            docSearchInput: document.getElementById('docSearchInput'),
            btnNewNote: document.getElementById('btnNewNote'),
            docList: document.getElementById('docList'),

            // Editor & Preview elements
            editorTextarea: document.getElementById('editorTextarea'),
            lineGutter: document.getElementById('lineGutter'),
            previewPane: document.getElementById('previewPane'),
            splitPane: document.getElementById('splitPane'),
            splitHandle: document.getElementById('splitHandle'),

            // Ribbon buttons
            fmtBold: document.getElementById('fmtBold'),
            fmtItalic: document.getElementById('fmtItalic'),
            fmtStrike: document.getElementById('fmtStrike'),
            fmtCode: document.getElementById('fmtCode'),
            fmtH1: document.getElementById('fmtH1'),
            fmtH2: document.getElementById('fmtH2'),
            fmtH3: document.getElementById('fmtH3'),
            fmtUl: document.getElementById('fmtUl'),
            fmtOl: document.getElementById('fmtOl'),
            fmtTask: document.getElementById('fmtTask'),
            fmtQuote: document.getElementById('fmtQuote'),
            fmtTable: document.getElementById('fmtTable'),
            fmtCodeBlock: document.getElementById('fmtCodeBlock'),
            fmtHr: document.getElementById('fmtHr'),
            btnToggleFindBar: document.getElementById('btnToggleFindBar'),

            // Find & Replace elements
            findBar: document.getElementById('findBar'),
            findInput: document.getElementById('findInput'),
            replaceInput: document.getElementById('replaceInput'),
            btnFindNext: document.getElementById('btnFindNext'),
            btnReplace: document.getElementById('btnReplace'),
            btnReplaceAll: document.getElementById('btnReplaceAll'),
            findMatchCount: document.getElementById('findMatchCount'),
            btnCloseFind: document.getElementById('btnCloseFind'),

            // Status Bar elements
            statusDocTitle: document.getElementById('statusDocTitle'),
            statusSaveState: document.getElementById('statusSaveState'),
            statusCursorPos: document.getElementById('statusCursorPos'),
            statusWordCount: document.getElementById('statusWordCount'),
            statusCharCount: document.getElementById('statusCharCount'),
            statusReadTime: document.getElementById('statusReadTime'),
            statusZoom: document.getElementById('statusZoom'),
            btnModeSplit: document.getElementById('btnModeSplit'),
            btnModeEditor: document.getElementById('btnModeEditor'),
            btnModePreview: document.getElementById('btnModePreview'),

            // Window & Menu controls
            themeSelector: document.getElementById('themeSelector'),
            btnPinWindow: document.getElementById('btnPinWindow'),
            btnMinWindow: document.getElementById('btnMinWindow')
        };

        this.storage = new NotebookStorage();
        this.activeDoc = null;
        this.isModified = false;
        this.zoomLevel = this.storage.settings.zoom || 100;

        this.initEditor();
        this.initMenu();
        this.initSidebar();
        this.initRibbon();
        this.initSplitter();
        this.initFindReplace();
        this.applySettings();

        // Load active or first document
        const initialId = this.storage.settings.activeDocId;
        const initialDoc = initialId ? this.storage.getDocumentById(initialId) : this.storage.getAllDocuments()[0];
        this.selectDocument(initialDoc || this.storage.getAllDocuments()[0]);
    }

    initEditor() {
        this.editor = new NotebookEditor({
            textarea: this.dom.editorTextarea,
            gutter: this.dom.lineGutter,
            preview: this.dom.previewPane
        }, (content) => {
            this.handleDocumentModified(content);
        });

        // Cursor tracking
        this.dom.editorTextarea.addEventListener('keyup', () => this.updateStatusStats());
        this.dom.editorTextarea.addEventListener('click', () => this.updateStatusStats());
    }

    initMenu() {
        this.menu = new DesktopMenuBar({
            newNote: () => this.createNewNote(),
            openFile: () => this.openFileFromDisk(),
            saveDoc: () => this.saveActiveDocument(),
            saveAsDoc: () => this.saveDocumentAs(),
            exportHtml: () => this.exportAsHtml(),
            exportMd: () => this.saveDocumentAs(),
            undo: () => this.editor.undo(),
            redo: () => this.editor.redo(),
            toggleFind: () => this.toggleFindBar(),
            selectAll: () => this.dom.editorTextarea.select(),
            toggleSidebar: () => this.toggleSidebar(),
            togglePreview: () => this.togglePreviewPane(),
            setViewMode: (mode) => this.setViewMode(mode),
            zoom: (delta) => this.adjustZoom(delta),
            zoomReset: () => this.setZoom(100),
            setTheme: (theme) => this.setTheme(theme),
            onPinChange: (isPinned) => {
                this.dom.btnPinWindow.classList.toggle('pinned', isPinned);
            },
            showDocInfo: () => this.showDocumentInfo()
        });

        // Window buttons
        this.dom.btnPinWindow.addEventListener('click', () => {
            const pinned = this.menu.togglePinWindow();
            this.dom.btnPinWindow.classList.toggle('pinned', pinned);
        });

        this.dom.btnMinWindow.addEventListener('click', () => {
            this.menu.minimizeWindow();
        });

        this.dom.themeSelector.addEventListener('change', (e) => {
            this.setTheme(e.target.value);
        });

        // In-app dropdown menus close on outside click
        document.addEventListener('click', (e) => {
            const dropdowns = document.querySelectorAll('.menu-dropdown');
            dropdowns.forEach(d => {
                if (!d.contains(e.target)) d.classList.remove('active');
            });
        });

        document.querySelectorAll('.menu-dropdown .menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const parent = btn.closest('.menu-dropdown');
                const wasActive = parent.classList.contains('active');
                document.querySelectorAll('.menu-dropdown').forEach(d => d.classList.remove('active'));
                if (!wasActive) parent.classList.add('active');
            });
        });

        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = item.dataset.action;
                const arg = item.dataset.arg;
                if (action) {
                    this.menu.dispatch(action, arg);
                }
                document.querySelectorAll('.menu-dropdown').forEach(d => d.classList.remove('active'));
            });
        });
    }

    initSidebar() {
        this.dom.btnNewNote.addEventListener('click', () => this.createNewNote());

        this.dom.docSearchInput.addEventListener('input', () => {
            this.renderDocumentList();
        });
    }

    renderDocumentList() {
        const query = (this.dom.docSearchInput.value || '').toLowerCase().trim();
        const docs = this.storage.getAllDocuments();

        const filtered = query
            ? docs.filter(d => d.title.toLowerCase().includes(query) || d.content.toLowerCase().includes(query))
            : docs;

        if (filtered.length === 0) {
            this.dom.docList.innerHTML = `
                <div style="color:var(--text-muted); font-size:12px; text-align:center; padding:20px 10px;">
                    No documents match "${this.escapeHtml(query)}".
                </div>`;
            return;
        }

        this.dom.docList.innerHTML = filtered.map(doc => {
            const isActive = this.activeDoc && this.activeDoc.id === doc.id;
            const dateStr = new Date(doc.modifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const previewSnippet = doc.content.replace(/[#*`_~[\]]/g, '').trim().slice(0, 50) || 'Empty document';

            return `
                <div class="doc-card ${isActive ? 'active' : ''}" data-doc-id="${doc.id}">
                    <div class="doc-card-title">
                        <span>${doc.pinned ? '📌 ' : ''}${this.escapeHtml(doc.title)}</span>
                    </div>
                    <div class="doc-card-preview">${this.escapeHtml(previewSnippet)}</div>
                    <div class="doc-card-date">${dateStr}</div>
                    <div class="doc-actions">
                        <button class="doc-action-btn pin" data-action="pin" title="Pin note">📌</button>
                        <button class="doc-action-btn delete" data-action="delete" title="Delete note">🗑</button>
                    </div>
                </div>
            `;
        }).join('');

        // Wire click events
        this.dom.docList.querySelectorAll('.doc-card').forEach(card => {
            const id = card.dataset.docId;
            card.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('.doc-action-btn');
                if (actionBtn) {
                    e.stopPropagation();
                    const act = actionBtn.dataset.action;
                    if (act === 'delete') {
                        this.deleteNote(id);
                    } else if (act === 'pin') {
                        this.togglePinNote(id);
                    }
                    return;
                }
                const targetDoc = this.storage.getDocumentById(id);
                if (targetDoc) this.selectDocument(targetDoc);
            });
        });
    }

    selectDocument(doc) {
        if (!doc) return;
        this.activeDoc = doc;
        this.storage.saveSettings({ activeDocId: doc.id });

        this.editor.setValue(doc.content);
        this.isModified = false;
        this.dom.statusSaveState.textContent = '● Saved';
        this.dom.statusSaveState.style.color = 'var(--success)';
        this.dom.statusDocTitle.textContent = doc.title;

        this.renderDocumentList();
        this.updateStatusStats();
    }

    handleDocumentModified(content) {
        if (!this.activeDoc) return;
        this.isModified = true;
        this.dom.statusSaveState.textContent = '● Modified';
        this.dom.statusSaveState.style.color = 'var(--warning)';

        // Auto-save debounced
        clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
            this.saveActiveDocument();
        }, 1200);

        this.updateStatusStats();
    }

    saveActiveDocument() {
        if (!this.activeDoc) return;
        const content = this.editor.getValue();
        this.storage.updateDocument(this.activeDoc.id, { content });

        this.isModified = false;
        this.dom.statusSaveState.textContent = '● Saved';
        this.dom.statusSaveState.style.color = 'var(--success)';
        this.dom.statusDocTitle.textContent = this.activeDoc.title;
        this.renderDocumentList();
    }

    createNewNote() {
        const newDoc = this.storage.createDocument('Untitled Note', '# Untitled Note\n\n');
        this.selectDocument(newDoc);
    }

    deleteNote(id) {
        if (confirm('Delete this note?')) {
            this.storage.deleteDocument(id);
            const remaining = this.storage.getAllDocuments();
            this.selectDocument(remaining[0]);
        }
    }

    togglePinNote(id) {
        const doc = this.storage.getDocumentById(id);
        if (doc) {
            doc.pinned = !doc.pinned;
            this.storage.saveDocuments();
            this.renderDocumentList();
        }
    }

    async openFileFromDisk() {
        const res = await this.storage.openFileDialog();
        if (res) {
            const doc = this.storage.createDocument(res.title, res.content);
            this.selectDocument(doc);
        }
    }

    async saveDocumentAs() {
        if (!this.activeDoc) return;
        const content = this.editor.getValue();
        const filename = `${this.activeDoc.title}.md`;
        await this.storage.saveFileDialog(content, filename);
    }

    exportAsHtml() {
        if (!this.activeDoc) return;
        const previewHtml = this.dom.previewPane.innerHTML;
        this.storage.exportHtml(previewHtml, this.activeDoc.title);
    }

    initRibbon() {
        this.dom.fmtBold.addEventListener('click', () => this.editor.wrapSelection('**', '**', 'bold text'));
        this.dom.fmtItalic.addEventListener('click', () => this.editor.wrapSelection('*', '*', 'italic text'));
        this.dom.fmtStrike.addEventListener('click', () => this.editor.wrapSelection('~~', '~~', 'strikethrough'));
        this.dom.fmtCode.addEventListener('click', () => this.editor.wrapSelection('`', '`', 'code'));

        this.dom.fmtH1.addEventListener('click', () => this.editor.insertHeading(1));
        this.dom.fmtH2.addEventListener('click', () => this.editor.insertHeading(2));
        this.dom.fmtH3.addEventListener('click', () => this.editor.insertHeading(3));

        this.dom.fmtUl.addEventListener('click', () => this.editor.insertBlock('- First item\n- Second item\n- Third item\n'));
        this.dom.fmtOl.addEventListener('click', () => this.editor.insertBlock('1. First item\n2. Second item\n3. Third item\n'));
        this.dom.fmtTask.addEventListener('click', () => this.editor.insertBlock('- [ ] Pending task item\n- [x] Completed task item\n'));
        this.dom.fmtQuote.addEventListener('click', () => this.editor.insertBlock('> Enter blockquote text here...\n'));
        this.dom.fmtTable.addEventListener('click', () => this.editor.insertBlock('| Header 1 | Header 2 | Header 3 |\n| :--- | :--- | :--- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |\n'));
        this.dom.fmtCodeBlock.addEventListener('click', () => this.editor.insertBlock('```javascript\nconsole.log("Hello from Desktop Notebook!");\n```\n'));
        this.dom.fmtHr.addEventListener('click', () => this.editor.insertBlock('\n---\n'));

        this.dom.btnToggleFindBar.addEventListener('click', () => this.toggleFindBar());
    }

    initSplitter() {
        let isDragging = false;

        this.dom.splitHandle.addEventListener('mousedown', () => {
            isDragging = true;
            document.body.style.cursor = 'col-resize';
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const containerRect = this.dom.splitPane.getBoundingClientRect();
            const relX = e.clientX - containerRect.left;
            const pct = Math.max(20, Math.min(80, (relX / containerRect.width) * 100));

            const editorPane = this.dom.splitPane.querySelector('.editor-pane');
            const previewPane = this.dom.splitPane.querySelector('.preview-pane');

            if (editorPane && previewPane) {
                editorPane.style.flex = `0 0 ${pct}%`;
                previewPane.style.flex = `0 0 ${100 - pct}%`;
            }
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
            }
        });

        // Mode switch buttons in status bar
        this.dom.btnModeSplit.addEventListener('click', () => this.setViewMode('split'));
        this.dom.btnModeEditor.addEventListener('click', () => this.setViewMode('editor'));
        this.dom.btnModePreview.addEventListener('click', () => this.setViewMode('preview'));
    }

    setViewMode(mode) {
        this.dom.splitPane.classList.remove('mode-editor', 'mode-preview');
        if (mode === 'editor') this.dom.splitPane.classList.add('mode-editor');
        if (mode === 'preview') this.dom.splitPane.classList.add('mode-preview');

        this.storage.saveSettings({ viewMode: mode });
    }

    toggleSidebar() {
        this.dom.sidebar.classList.toggle('collapsed');
    }

    togglePreviewPane() {
        if (this.dom.splitPane.classList.contains('mode-editor')) {
            this.setViewMode('split');
        } else {
            this.setViewMode('editor');
        }
    }

    // ── Find & Replace ────────────────────────────────────────────────────────

    initFindReplace() {
        this.dom.btnCloseFind.addEventListener('click', () => {
            this.dom.findBar.classList.remove('active');
        });

        this.dom.findInput.addEventListener('input', () => this.findNextMatch());
        this.dom.btnFindNext.addEventListener('click', () => this.findNextMatch());

        this.dom.btnReplace.addEventListener('click', () => {
            const query = this.dom.findInput.value;
            const replaceText = this.dom.replaceInput.value;
            if (!query) return;

            const textarea = this.dom.editorTextarea;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const sel = textarea.value.slice(start, end);

            if (sel.toLowerCase() === query.toLowerCase()) {
                textarea.setRangeText(replaceText, start, end, 'select');
                this.editor.updateLineNumbers();
                this.editor.renderPreview();
                this.handleDocumentModified(this.editor.getValue());
                this.findNextMatch();
            } else {
                this.findNextMatch();
            }
        });

        this.dom.btnReplaceAll.addEventListener('click', () => {
            const query = this.dom.findInput.value;
            const replaceText = this.dom.replaceInput.value;
            if (!query) return;

            const text = this.editor.getValue();
            const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            const count = (text.match(regex) || []).length;

            if (count > 0) {
                const replaced = text.replace(regex, replaceText);
                this.editor.setValue(replaced);
                this.handleDocumentModified(replaced);
                this.dom.findMatchCount.textContent = `Replaced ${count} occurrences`;
            }
        });
    }

    toggleFindBar() {
        const wasActive = this.dom.findBar.classList.contains('active');
        this.dom.findBar.classList.toggle('active', !wasActive);
        if (!wasActive) {
            this.dom.findInput.focus();
            this.dom.findInput.select();
        }
    }

    findNextMatch() {
        const query = this.dom.findInput.value;
        if (!query) {
            this.dom.findMatchCount.textContent = '0 matches';
            return;
        }

        const textarea = this.dom.editorTextarea;
        const text = textarea.value.toLowerCase();
        const lowerQ = query.toLowerCase();

        const count = (text.match(new RegExp(lowerQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        this.dom.findMatchCount.textContent = `${count} matches`;

        const curPos = textarea.selectionEnd || 0;
        let matchIdx = text.indexOf(lowerQ, curPos);
        if (matchIdx === -1) {
            matchIdx = text.indexOf(lowerQ, 0); // wrap around
        }

        if (matchIdx !== -1) {
            textarea.focus();
            textarea.setSelectionRange(matchIdx, matchIdx + query.length);
        }
    }

    // ── Theme & Zoom ──────────────────────────────────────────────────────────

    setTheme(themeName) {
        document.body.classList.remove('theme-light', 'theme-sepia', 'theme-obsidian');
        if (themeName !== 'dark') {
            document.body.classList.add(`theme-${themeName}`);
        }
        this.dom.themeSelector.value = themeName;
        this.storage.saveSettings({ theme: themeName });
    }

    adjustZoom(delta) {
        this.setZoom(Math.max(70, Math.min(180, this.zoomLevel + delta)));
    }

    setZoom(level) {
        this.zoomLevel = level;
        this.dom.editorTextarea.style.fontSize = `${Math.round(14 * (level / 100))}px`;
        this.dom.previewPane.style.fontSize = `${Math.round(15 * (level / 100))}px`;
        this.dom.statusZoom.textContent = `${level}%`;
        this.storage.saveSettings({ zoom: level });
    }

    applySettings() {
        const s = this.storage.settings;
        if (s.theme) this.setTheme(s.theme);
        if (s.viewMode) this.setViewMode(s.viewMode);
        if (s.zoom) this.setZoom(s.zoom);
    }

    updateStatusStats() {
        const stats = this.editor.getStats();
        this.dom.statusCursorPos.textContent = `Ln ${stats.curLine}, Col ${stats.curCol}`;
        this.dom.statusWordCount.textContent = `${stats.words} words`;
        this.dom.statusCharCount.textContent = `${stats.chars} chars`;
        this.dom.statusReadTime.textContent = `${stats.readingTimeMins} min read`;
    }

    showDocumentInfo() {
        if (!this.activeDoc) return;
        const stats = this.editor.getStats();
        alert(`Document Properties:\n\nTitle: ${this.activeDoc.title}\nWords: ${stats.words}\nCharacters: ${stats.chars}\nLines: ${stats.lines}\nCreated: ${new Date(this.activeDoc.createdAt).toLocaleString()}\nModified: ${new Date(this.activeDoc.modifiedAt).toLocaleString()}`);
    }

    escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new DesktopNotebookApp();
});
