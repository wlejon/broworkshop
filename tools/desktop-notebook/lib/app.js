// app.js — Desktop Notebook's wiring: the active note, autosave, menus,
// shortcuts, ribbon and status bar. main.js calls start().

import { boot } from "/lib/kit/app.js";
import { $ } from "/lib/kit/dom.js";
import { prefs, notes, loadNotes, getNote, createNote, updateNote, deleteNote, togglePin } from "./store.js";
import { NoteEditor } from "./editor.js";
import { findBar } from "./find.js";
import { renderNoteList } from "./sidebar.js";
import * as files from "./files.js";
import * as view from "./view.js";

const AUTOSAVE_MS = 1200;

/** Live page state (an object, so tests read current values). */
export const page = { note: null, modified: false, editor: null, find: null, status: null };
let saveTimer = 0;

// ── notes ────────────────────────────────────────────────────────────────────

function renderList() {
    renderNoteList({
        activeId: page.note && page.note.id,
        onOpen: (id) => openNote(getNote(id)),
        onPin: (id) => { togglePin(id); renderList(); },
        onDelete: removeNote,
    });
}

function setSaved(saved) {
    page.modified = !saved;
    $('#statusSaveState').textContent = saved ? 'Saved' : 'Modified';
    $('#statusSaveState').className = saved ? 'ok' : 'warn';
}

export function openNote(note) {
    if (!note) return;
    if (page.modified) save();
    page.note = note;
    prefs.set({ activeDocId: note.id });
    page.editor.setValue(note.content);
    setSaved(true);
    $('#statusDocTitle').textContent = note.title;
    renderList();
    updateStats();
}

export function save() {
    clearTimeout(saveTimer);
    if (!page.note) return;
    updateNote(page.note.id, page.editor.value);
    setSaved(true);
    $('#statusDocTitle').textContent = page.note.title;
    renderList();
}

function onEdited() {
    if (!page.note) return;
    setSaved(false);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, AUTOSAVE_MS);
    updateStats();
}

export function newNote() { openNote(createNote('Untitled Note', '# Untitled Note\n\n')); }

export function removeNote(id) {
    const n = getNote(id);
    if (!n || !confirm('Delete "' + n.title + '"?')) return;
    const wasActive = page.note && page.note.id === id;
    if (wasActive) { clearTimeout(saveTimer); page.modified = false; }
    deleteNote(id);
    if (wasActive) openNote(notes[0]); else renderList();
}

function updateStats() {
    const s = page.editor.stats();
    $('#statusCursorPos').textContent = 'Ln ' + s.curLine + ', Col ' + s.curCol;
    $('#statusWordCount').textContent = s.words + ' words';
    $('#statusCharCount').textContent = s.chars + ' chars';
    $('#statusReadTime').textContent = s.readingTimeMins + ' min read';
}

function showInfo() {
    if (!page.note) return;
    const s = page.editor.stats(), n = page.note;
    alert('Title: ' + n.title + '\nWords: ' + s.words + '\nCharacters: ' + s.chars + '\nLines: ' + s.lines +
          '\nCreated: ' + new Date(n.createdAt).toLocaleString() + '\nModified: ' + new Date(n.modifiedAt).toLocaleString());
}

// ── file IO ──────────────────────────────────────────────────────────────────

function report(fn, done) {
    try { const r = fn(); if (r) page.status.ok(done(r)); }
    catch (e) { page.status.error(e); }
}
const openFile = () => report(files.openDialog, (f) => { openNote(createNote(f.title, f.content)); return 'opened ' + f.path; });
const saveAs = () => page.note && report(() => files.saveAsDialog(page.note.title, page.editor.value), (p) => 'saved ' + p);
const exportHtml = () => page.note && report(() => files.exportHtmlDialog(page.note.title, $('#previewPane').innerHTML), (p) => 'exported ' + p);

// ── commands: one table feeds the menu bar and the keyboard ──────────────────

const COMMANDS = {
    'file.new':        { label: 'New Note', accel: 'Ctrl+N', key: 'n', run: newNote },
    'file.open':       { label: 'Open File…', accel: 'Ctrl+O', key: 'o', run: openFile },
    'file.save':       { label: 'Save', accel: 'Ctrl+S', key: 's', run: () => { save(); page.status.ok('saved'); } },
    'file.saveAs':     { label: 'Save As Markdown…', accel: 'Ctrl+Shift+S', key: 'S', run: saveAs },
    'file.exportHtml': { label: 'Export as HTML…', accel: 'Ctrl+E', key: 'e', run: exportHtml },
    'edit.undo':       { label: 'Undo', accel: 'Ctrl+Z', run: () => page.editor.undo() },
    'edit.redo':       { label: 'Redo', accel: 'Ctrl+Y', run: () => page.editor.redo() },
    'edit.cut':        { label: 'Cut', accel: 'Ctrl+X', run: () => document.execCommand('cut') },
    'edit.copy':       { label: 'Copy', accel: 'Ctrl+C', run: () => document.execCommand('copy') },
    'edit.paste':      { label: 'Paste', accel: 'Ctrl+V', run: () => document.execCommand('paste') },
    'edit.find':       { label: 'Find & Replace…', accel: 'Ctrl+F', key: 'f', run: () => page.find.toggle() },
    'edit.selectAll':  { label: 'Select All', accel: 'Ctrl+A', run: () => { page.editor.ta.focus(); page.editor.ta.select(); } },
    'view.sidebar':    { label: 'Toggle Sidebar', accel: 'Ctrl+B', key: 'b', run: view.toggleSidebar },
    'view.preview':    { label: 'Toggle Preview', accel: 'Ctrl+P', key: 'p', run: view.togglePreview },
    'view.split':      { label: 'Split View', accel: 'Ctrl+1', key: '1', run: () => view.setViewMode('split') },
    'view.editor':     { label: 'Editor Only', accel: 'Ctrl+2', key: '2', run: () => view.setViewMode('editor') },
    'view.previewOnly': { label: 'Preview Only', accel: 'Ctrl+3', key: '3', run: () => view.setViewMode('preview') },
    'view.zoomIn':     { label: 'Zoom In', accel: 'Ctrl+=', key: '=', run: () => view.zoomBy(10) },
    'view.zoomOut':    { label: 'Zoom Out', accel: 'Ctrl+-', key: '-', run: () => view.zoomBy(-10) },
    'view.zoomReset':  { label: 'Reset Zoom', accel: 'Ctrl+0', key: '0', run: () => view.setZoom(100) },
    'window.minimize': { label: 'Minimize', accel: 'Ctrl+M', key: 'm', run: view.minimizeWindow },
    'window.maximize': { label: 'Toggle Maximize', run: view.toggleMaximize },
    'window.pin':      { label: 'Always on Top', run: view.togglePin },
    'window.info':     { label: 'Document Info…', run: showInfo },
};
for (const t in view.THEMES) COMMANDS['view.theme.' + t] = { label: 'Theme: ' + view.THEMES[t], run: () => view.setTheme(t) };

export function run(id) { COMMANDS[id].run(); }

function menuItems(prefix, breaks) {
    const out = [];
    for (const id in COMMANDS) {
        if (!id.startsWith(prefix + '.')) continue;
        if (breaks.indexOf(id) >= 0) out.push({ separator: true });
        out.push({ id, label: COMMANDS[id].label, accel: COMMANDS[id].accel });
    }
    return out;
}

function bindKeys() {
    const byKey = {};
    for (const id in COMMANDS) if (COMMANDS[id].key) byKey[COMMANDS[id].key] = id;
    byKey['+'] = 'view.zoomIn';
    byKey['_'] = 'view.zoomOut';
    window.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.length === 1 ? (e.shiftKey && e.key.toLowerCase() === 's' ? 'S' : e.key.toLowerCase()) : '';
        const id = byKey[k];
        if (!id) return;
        e.preventDefault();
        run(id);
    });
}

// Ribbon: [data-wrap="pre|post|placeholder"], [data-heading=N], [data-block=name].
const BLOCKS = {
    ul: '- First item\n- Second item\n- Third item\n',
    ol: '1. First item\n2. Second item\n3. Third item\n',
    task: '- [ ] Pending task\n- [x] Completed task\n',
    quote: '> Quoted text\n',
    table: '| Header 1 | Header 2 | Header 3 |\n| :--- | :--- | :--- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |\n',
    code: '```javascript\nconsole.log("Hello from Desktop Notebook!");\n```\n',
    hr: '\n---\n',
};

function bindRibbon() {
    $('#ribbon').addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('button');
        if (!b) return;
        const ed = page.editor, d = b.dataset;
        if (d.wrap) { const [pre, ph] = d.wrap.split('|'); ed.wrap(pre, pre, ph); }
        else if (d.heading) ed.heading(parseInt(d.heading, 10));
        else if (d.block) ed.insertBlock(BLOCKS[d.block]);
        else if (d.cmd) run(d.cmd);
    });
}

export function start() {
    const app = boot({
        menu: {
            file: menuItems('file', ['file.save', 'file.exportHtml']),
            view: menuItems('view', ['view.split', 'view.zoomIn', 'view.theme.dark']),
            menus: [
                { id: 'edit', label: 'Edit', items: menuItems('edit', ['edit.cut', 'edit.find']) },
                { id: 'window', label: 'Window', items: menuItems('window', ['window.info']) },
            ],
            handlers: Object.fromEntries(Object.keys(COMMANDS).map((id) => [id, () => run(id)])),
        },
    });
    page.status = app.status;
    page.editor = new NoteEditor({ textarea: $('#editorTextarea'), gutter: $('#lineGutter'), preview: $('#previewPane') }, onEdited);
    page.find = findBar(page.editor);
    const ta = page.editor.ta;
    ta.addEventListener('keyup', updateStats);
    ta.addEventListener('click', updateStats);

    $('#btnNewNote').addEventListener('click', newNote);
    $('#docSearchInput').addEventListener('input', renderList);
    $('#themeSelector').addEventListener('change', () => view.setTheme($('#themeSelector').value));
    $('#btnPinWindow').addEventListener('click', view.togglePin);
    $('#btnMinWindow').addEventListener('click', view.minimizeWindow);
    for (const b of document.querySelectorAll('#viewModes [data-mode]')) b.addEventListener('click', () => view.setViewMode(b.dataset.mode));
    view.bindSplitter();
    bindRibbon();
    bindKeys();

    view.setTheme(prefs.data.theme);
    view.setViewMode(prefs.data.viewMode);
    view.setZoom(prefs.data.zoom);
    loadNotes();
    openNote(getNote(prefs.data.activeDocId) || notes[0]);
}
