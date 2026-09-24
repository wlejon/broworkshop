// store.js — notes (localStorage) and settings (prefStore).
// A note: { id, title, content, tags, pinned, favorite, createdAt, modifiedAt }.

import { prefStore } from "/lib/kit/prefs.js";
import { sampleNotes } from "./samples.js";

export const NOTES_KEY = 'desktop_notebook:documents';

// Same key as before the kit port, so saved settings carry over.
export const prefs = prefStore('desktop_notebook:settings', {
    theme: 'dark',            // dark | light | sepia | obsidian
    viewMode: 'split',        // split | editor | preview
    zoom: 100,
    activeDocId: null,
});

/** Newest first. Mutated in place, so importers always see the live list. */
export const notes = [];

export function loadNotes() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(NOTES_KEY)) || []; } catch (e) {}
    if (!list.length) list = sampleNotes();
    notes.splice(0, notes.length, ...list);
    saveNotes();
}

export function saveNotes() {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch (e) {}
}

export function getNote(id) { return notes.find((n) => n.id === id) || null; }

export function createNote(title, content) {
    const now = new Date().toISOString();
    const note = {
        id: 'doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: title || 'Untitled Note', content: content || '', tags: [],
        pinned: false, favorite: false, createdAt: now, modifiedAt: now,
    };
    notes.unshift(note);
    saveNotes();
    return note;
}

/** The first heading of `content`, clipped, or null. */
export function titleOf(content) {
    const m = String(content || '').trim().split('\n')[0].match(/^#+\s*(.*)$/);
    return m && m[1] ? m[1].slice(0, 40) : null;
}

/** Save new content; the title follows the first heading. */
export function updateNote(id, content) {
    const note = getNote(id);
    if (!note) return null;
    note.content = content;
    note.modifiedAt = new Date().toISOString();
    note.title = titleOf(content) || note.title;
    saveNotes();
    return note;
}

/** Remove a note; an emptied notebook gets a fresh Quick Note. */
export function deleteNote(id) {
    const i = notes.findIndex((n) => n.id === id);
    if (i < 0) return false;
    notes.splice(i, 1);
    if (!notes.length) createNote('Quick Note', '# Quick Note\n\nStart typing here...');
    saveNotes();
    return true;
}

export function togglePin(id) {
    const note = getNote(id);
    if (note) { note.pinned = !note.pinned; saveNotes(); }
    return note;
}

/** Notes matching `query` (title or content), pinned first. */
export function searchNotes(query) {
    const q = String(query || '').toLowerCase().trim();
    const hits = q ? notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) : notes.slice();
    return hits.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}
