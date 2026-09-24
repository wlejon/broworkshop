// project.js — document save/load for editors.
//
// A project is a directory bundle:
//
//   my-scene.bro/
//   ├── project.json   { bro_project, app, schema, created, modified, data }
//   └── assets/        (only if the app stores binary sidecars)
//
// The app owns the domain (serialize + deserialize); this owns the plumbing:
// dialogs, schema versioning + forward migrations, dirty tracking fed by a
// History (history.js), autosave, and the "unsaved changes" gate. editor.js
// wires one to the File menu.
//
//   import { Project } from "/lib/kit/project.js";
//   const proj = new Project({
//       app:         'scene-editor',
//       schema:      2,
//       serialize:   () => ({ primitives: registry.primitives.map(...) }),
//       deserialize: (data) => { registry.clear(); data.primitives.forEach(...); },
//       onNew:       () => { registry.clear(); registry.create(defaultBox); },
//       history,                                  // auto-dirty on record
//       migrations:  { 1: dataV1 => ({ ...dataV1, color: '#fff' }) },
//       promptDirty: () => confirm('Unsaved changes — continue?'),
//   });
//   proj.save(); proj.saveAs(); proj.open(); proj.new();
//   proj.autosaveEvery(30_000);
//
// Events: 'dirty' ({dirty}), 'saved' ({path}), 'loaded' ({path}), 'new' ({}),
// and 'change' after any of them.

// Version of the project.json envelope itself. App data evolves separately
// via `opts.schema` + `opts.migrations`.
const CONTAINER_VERSION = 1;

function nowISO() {
    return new Date().toISOString();
}

export class Project {
    constructor(opts) {
        if (!opts || typeof opts.app !== 'string' ||
            typeof opts.serialize !== 'function' || typeof opts.deserialize !== 'function') {
            throw new Error('Project: requires { app, serialize, deserialize }');
        }
        this._app = opts.app;
        this._schema = opts.schema != null ? opts.schema : 1;
        this._serialize = opts.serialize;
        this._deserialize = opts.deserialize;
        this._onNew = opts.onNew || null;
        this._migrations = opts.migrations || {};
        this._fileExt = opts.fileExt || 'bro';
        this._promptDirty = opts.promptDirty || null;
        this._onBeforeLoad = opts.onBeforeLoad || null;
        this._history = opts.history || null;

        this._path = null;
        this._createdAt = null;
        this._dirty = false;
        this._autosaveMs = 0;
        this._autosaveHandle = null;
        // Set while load/new swaps state, so history records made by
        // deserialize don't mark the fresh document dirty.
        this._loading = false;
        this._listeners = {};

        if (this._history && typeof this._history.on === 'function') {
            this._history.on('record', () => { if (!this._loading) this.markDirty(); });
        }
    }

    // ---- state ---------------------------------------------------------------

    get path() { return this._path; }
    get name() { return this._path ? require('path').basename(this._path) : 'Untitled'; }
    get schema() { return this._schema; }
    get app() { return this._app; }

    isDirty() { return this._dirty; }
    markDirty() {
        if (this._dirty) return;
        this._dirty = true;
        this._emit('dirty', { dirty: true });
        this._emit('change', this);
    }
    markClean() {
        if (!this._dirty) return;
        this._dirty = false;
        this._emit('dirty', { dirty: false });
        this._emit('change', this);
    }

    // ---- events --------------------------------------------------------------

    on(event, fn) {
        (this._listeners[event] ||= []).push(fn);
        return () => this.off(event, fn);
    }
    off(event, fn) {
        const arr = this._listeners[event];
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
    }
    _emit(event, payload) {
        const arr = this._listeners[event];
        if (!arr) return;
        for (const fn of arr.slice()) fn(payload, this);
    }

    // ---- save ----------------------------------------------------------------

    // Save to the current path. False when there is none (use saveAs()).
    save() {
        if (!this._path) return false;
        return this.saveTo(this._path);
    }

    // Native save dialog, then save; appends the file extension if missing.
    // False when the dialog is cancelled.
    saveAs() {
        if (typeof showSaveFileDialog !== 'function') {
            throw new Error('Project.saveAs: showSaveFileDialog unavailable');
        }
        const filter = `Bro Project|${this._fileExt}`;
        const defaultName = this._path ? require('path').basename(this._path) : 'project.' + this._fileExt;
        const picked = showSaveFileDialog(filter, defaultName);
        if (!picked) return false;
        return this.saveTo(this._resolveSavePath(picked));
    }

    // Write the bundle to `dirPath` without prompting. project.json is written
    // tmp-then-rename so a crash mid-write can't truncate it.
    saveTo(dirPath) {
        const fs = require('fs');
        const path = require('path');
        if (!this._createdAt) this._createdAt = nowISO();
        const envelope = {
            bro_project: CONTAINER_VERSION,
            app: this._app,
            schema: this._schema,
            created: this._createdAt,
            modified: nowISO(),
            data: this._serialize(),
        };
        fs.mkdirSync(dirPath, { recursive: true });
        const target = path.join(dirPath, 'project.json');
        const tmp = target + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), 'utf8');
        // Windows rename won't overwrite; remove the old file first.
        if (fs.existsSync(target)) fs.unlinkSync(target);
        fs.renameSync(tmp, target);
        this._path = dirPath;
        this._dirty = false;
        this._emit('saved', { path: dirPath });
        this._emit('dirty', { dirty: false });
        this._emit('change', this);
        return true;
    }

    // ---- open ----------------------------------------------------------------

    // Folder dialog (after the unsaved-changes gate), then load.
    open() {
        if (!this._promptIfDirty()) return false;
        if (typeof showOpenFolderDialog !== 'function') {
            throw new Error('Project.open: showOpenFolderDialog unavailable');
        }
        const picked = showOpenFolderDialog();
        if (!picked || picked.length === 0) return false;
        return this.openPath(picked[0]);
    }

    // Load a bundle: validate the app id, migrate the schema, clear history
    // (an old undo stack means nothing for a new file), then deserialize.
    openPath(dirPath) {
        const fs = require('fs');
        const path = require('path');
        if (!fs.existsSync(dirPath)) throw new Error(`Project.openPath: no such path: ${dirPath}`);
        if (!fs.statSync(dirPath).isDirectory()) throw new Error(`Project.openPath: not a directory: ${dirPath}`);
        const projectFile = path.join(dirPath, 'project.json');
        if (!fs.existsSync(projectFile)) throw new Error(`Project.openPath: no project.json in ${dirPath}`);
        const envelope = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
        if (envelope.app !== this._app) {
            throw new Error(`Project.openPath: expected app "${this._app}", got "${envelope.app}"`);
        }
        const data = this._migrate(envelope.data, envelope.schema);

        this._loading = true;
        try {
            if (this._onBeforeLoad) this._onBeforeLoad();
            if (this._history && typeof this._history.clear === 'function') this._history.clear();
            this._deserialize(data);
        } finally {
            this._loading = false;
        }
        this._path = dirPath;
        this._createdAt = envelope.created || null;
        this._dirty = false;
        this._emit('loaded', { path: dirPath });
        this._emit('dirty', { dirty: false });
        this._emit('change', this);
        return true;
    }

    // ---- new -----------------------------------------------------------------

    // Reset to a blank document via `onNew` (after the unsaved-changes gate);
    // clears history and the current path.
    new() {
        if (!this._promptIfDirty()) return false;
        this._loading = true;
        try {
            if (this._history && typeof this._history.clear === 'function') this._history.clear();
            if (this._onNew) this._onNew();
        } finally {
            this._loading = false;
        }
        this._path = null;
        this._createdAt = null;
        this._dirty = false;
        this._emit('new', {});
        this._emit('dirty', { dirty: false });
        this._emit('change', this);
        return true;
    }

    // ---- autosave ------------------------------------------------------------

    // Save every `ms` while there is a path and unsaved changes; 0 disables.
    // Replaces any prior timer.
    autosaveEvery(ms) {
        if (this._autosaveHandle) {
            clearInterval(this._autosaveHandle);
            this._autosaveHandle = null;
        }
        this._autosaveMs = ms;
        if (ms > 0) {
            this._autosaveHandle = setInterval(() => {
                if (this._dirty && this._path) this.save();
            }, ms);
        }
    }
    autosaveActive() { return !!this._autosaveHandle; }

    // ---- internals -----------------------------------------------------------

    _migrate(data, fromSchema) {
        if (fromSchema == null) fromSchema = 1;
        if (fromSchema > this._schema) {
            throw new Error(`Project: file schema ${fromSchema} is newer than app (${this._schema})`);
        }
        while (fromSchema < this._schema) {
            const migrator = this._migrations[fromSchema];
            if (typeof migrator !== 'function') {
                throw new Error(`Project: no migration from schema ${fromSchema} to ${fromSchema + 1}`);
            }
            data = migrator(data);
            fromSchema++;
        }
        return data;
    }

    _promptIfDirty() {
        if (!this._dirty) return true;
        if (this._promptDirty) return !!this._promptDirty();
        return true;    // no prompt configured: trust the caller
    }

    _resolveSavePath(picked) {
        const ext = '.' + this._fileExt;
        return picked.endsWith(ext) ? picked : picked + ext;
    }
}
