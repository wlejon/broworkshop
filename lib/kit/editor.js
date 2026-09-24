// lib/kit/editor.js — plumbing shared by document editors (scene, tile, node
// editors): a tool switcher and the undo / redo / new / open / save commands.
//
//   import { History } from "/lib/kit/history.js";
//   import { Project } from "/lib/kit/project.js";
//   import { toolbox, documentCommands } from "/lib/kit/editor.js";
//
//   const tools = toolbox({
//       tools: { select: selectTool, line: lineTool },   // plain objects, see below
//       initial: 'select',
//       buttons: '#toolbar',                               // [data-tool=name] buttons
//       onChange: (name) => status.set('tool: ' + name),
//   });
//   const doc = documentCommands({
//       history, project,
//       canRun: () => !tools.busy(),        // no undo / save mid-gesture
//       undoButton: '#undo', redoButton: '#redo',
//   });
//   boot({ menu: doc.menu });             // File > New / Open / Save / Save As
//
// A tool is any object; the toolbox calls only what it defines:
//   activate()    became the current tool
//   deactivate()  stopped being the current tool
//   busy()        true while a gesture (drag, click-chain) is in progress
//   cancel()      abandon that gesture (called only while busy)
// Everything else on it (down / move / key handlers, ...) is the app's.

const el = (x) => (typeof x === 'string' ? document.querySelector(x) : x);

/**
 * Named tools, one current. opts: { tools, initial, buttons, onChange(name, prev) }.
 * `buttons` (element or selector) holds [data-tool] buttons: clicking one
 * selects that tool, and the current one carries `.active`.
 * Returns { name, tool, set(name), get(name), names, busy(), cancelAll() }.
 */
export function toolbox(opts) {
    const o = opts || {};
    const tools = o.tools || {};
    const names = Object.keys(tools);
    const bar = o.buttons ? el(o.buttons) : null;
    let name = o.initial || names[0];

    const sync = () => {
        if (!bar) return;
        for (const b of Array.from(bar.querySelectorAll('[data-tool]'))) {
            b.classList.toggle('active', b.getAttribute('data-tool') === name);
        }
    };
    const box = {
        get name() { return name; },
        get tool() { return tools[name]; },
        get names() { return names.slice(); },
        get(n) { return tools[n]; },
        /** True when any tool has a gesture in progress. */
        busy() { return names.some((n) => tools[n].busy && tools[n].busy()); },
        /** Cancel every in-progress gesture; returns whether there was one. */
        cancelAll() {
            let any = false;
            for (const n of names) {
                const t = tools[n];
                if (t.busy && t.busy()) { any = true; if (t.cancel) t.cancel(); }
            }
            return any;
        },
        /** Switch tools. Cancels any gesture first; no-op for the current tool. */
        set(next) {
            if (next === name) return;
            if (!tools[next]) throw new Error('kit: toolbox has no tool ' + next);
            box.cancelAll();
            const prev = name;
            if (tools[prev] && tools[prev].deactivate) tools[prev].deactivate();
            name = next;
            sync();
            if (tools[name].activate) tools[name].activate();
            if (o.onChange) o.onChange(name, prev);
        },
    };
    if (bar) {
        for (const b of Array.from(bar.querySelectorAll('[data-tool]'))) {
            b.addEventListener('click', () => box.set(b.getAttribute('data-tool')));
        }
    }
    sync();
    return box;
}

function isTextTarget(t) {
    if (!t || !t.tagName) return false;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    return !!(t.getAttribute && t.getAttribute('contenteditable') === 'true');
}

/**
 * Undo / redo / new / open / save for a History (lib/history.js) and a
 * Project (lib/project.js); either may be omitted. Installs the keys
 *   Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo, Ctrl+S save (save-as without a
 *   path), Ctrl+Shift+S save as, Ctrl+O open, Ctrl+N new
 * (Cmd on macOS), ignored while typing in a field. opts:
 *   history, project
 *   canRun()               false suppresses every command (e.g. mid-drag)
 *   after(cmd)             after a command ran ('undo', 'redo', 'save', ...)
 *   undoButton, redoButton buttons to wire and enable/disable with the history
 * Returns { undo, redo, save, saveAs, open, new, menu, dispose() }; `menu` is
 * { file, handlers } for boot({ menu }) / installSystemMenu.
 */
export function documentCommands(opts) {
    const o = opts || {};
    const history = o.history || null, project = o.project || null;
    const allowed = () => !o.canRun || o.canRun();
    const run = (cmd, fn) => () => {
        if (!allowed()) return false;
        const r = fn();
        if (o.after) o.after(cmd, r);
        return r;
    };
    const cmds = {
        undo:   run('undo',   () => !!history && history.canUndo() && history.undo()),
        redo:   run('redo',   () => !!history && history.canRedo() && history.redo()),
        save:   run('save',   () => !!project && (project.path ? project.save() : project.saveAs())),
        saveAs: run('saveAs', () => !!project && project.saveAs()),
        open:   run('open',   () => !!project && project.open()),
        new:    run('new',    () => !!project && project.new()),
    };

    const onKey = (e) => {
        if (!(e.ctrlKey || e.metaKey) || isTextTarget(e.target)) return;
        const k = (e.key || '').toLowerCase();
        let cmd = null;
        if (history && k === 'z') cmd = e.shiftKey ? 'redo' : 'undo';
        else if (history && k === 'y') cmd = 'redo';
        else if (project && k === 's') cmd = e.shiftKey ? 'saveAs' : 'save';
        else if (project && k === 'o') cmd = 'open';
        else if (project && k === 'n') cmd = 'new';
        if (!cmd || !allowed()) return;
        e.preventDefault();
        cmds[cmd]();
    };
    document.addEventListener('keydown', onKey);

    const undoBtn = o.undoButton ? el(o.undoButton) : null;
    const redoBtn = o.redoButton ? el(o.redoButton) : null;
    const syncButtons = () => {
        if (undoBtn) undoBtn.disabled = !history.canUndo();
        if (redoBtn) redoBtn.disabled = !history.canRedo();
    };
    let offHistory = null;
    if (history && (undoBtn || redoBtn)) {
        if (undoBtn) undoBtn.addEventListener('click', () => cmds.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => cmds.redo());
        offHistory = history.on('change', syncButtons);
        syncButtons();
    }

    const file = [], handlers = {};
    if (project) {
        file.push({ id: 'file.new', label: 'New', accel: 'Ctrl+N' },
                  { id: 'file.open', label: 'Open...', accel: 'Ctrl+O' },
                  { id: 'file.save', label: 'Save', accel: 'Ctrl+S' },
                  { id: 'file.saveAs', label: 'Save As...', accel: 'Ctrl+Shift+S' });
        handlers['file.new'] = cmds.new;
        handlers['file.open'] = cmds.open;
        handlers['file.save'] = cmds.save;
        handlers['file.saveAs'] = cmds.saveAs;
    }

    return Object.assign(cmds, {
        menu: { file, handlers },
        dispose() {
            document.removeEventListener('keydown', onKey);
            if (offHistory) offHistory();
        },
    });
}
