// menu.js — Native OS Application Menu Bar (bro.menu), window controls (bro.window), and keyboard accelerators.

export class DesktopMenuBar {
    constructor(actions) {
        this.actions = actions || {};
        this.alwaysOnTop = false;

        this.initNativeMenu();
        this.initGlobalShortcuts();
    }

    initNativeMenu() {
        if (typeof bro === 'undefined' || !bro.menu) {
            console.info('bro.menu unavailable; falling back to in-app menu bar & hotkeys.');
            return;
        }

        const menuTree = [
            {
                id: 'file',
                label: 'File',
                items: [
                    { id: 'file.new', label: 'New Note', accel: 'Ctrl+N' },
                    { id: 'file.open', label: 'Open File...', accel: 'Ctrl+O' },
                    { separator: true },
                    { id: 'file.save', label: 'Save', accel: 'Ctrl+S' },
                    { id: 'file.saveAs', label: 'Save As...', accel: 'Ctrl+Shift+S' },
                    { separator: true },
                    { id: 'file.exportHtml', label: 'Export as HTML...', accel: 'Ctrl+E' },
                    { id: 'file.exportMd', label: 'Export as Markdown...' },
                    { separator: true },
                    { id: '__system.quit', label: 'Exit Notebook', accel: 'Ctrl+Q' }
                ]
            },
            {
                id: 'edit',
                label: 'Edit',
                items: [
                    { id: 'edit.undo', label: 'Undo', accel: 'Ctrl+Z' },
                    { id: 'edit.redo', label: 'Redo', accel: 'Ctrl+Y' },
                    { separator: true },
                    { id: 'edit.cut', label: 'Cut', accel: 'Ctrl+X' },
                    { id: 'edit.copy', label: 'Copy', accel: 'Ctrl+C' },
                    { id: 'edit.paste', label: 'Paste', accel: 'Ctrl+V' },
                    { separator: true },
                    { id: 'edit.find', label: 'Find & Replace...', accel: 'Ctrl+F' },
                    { id: 'edit.selectAll', label: 'Select All', accel: 'Ctrl+A' }
                ]
            },
            {
                id: 'view',
                label: 'View',
                items: [
                    { id: 'view.toggleSidebar', label: 'Toggle Sidebar', accel: 'Ctrl+B' },
                    { id: 'view.togglePreview', label: 'Toggle Preview', accel: 'Ctrl+P' },
                    { separator: true },
                    { id: 'view.modeSplit', label: 'Split View (Editor + Preview)', accel: 'Ctrl+1' },
                    { id: 'view.modeEditor', label: 'Editor Only', accel: 'Ctrl+2' },
                    { id: 'view.modePreview', label: 'Preview Only', accel: 'Ctrl+3' },
                    { separator: true },
                    { id: 'view.zoomIn', label: 'Zoom In', accel: 'Ctrl+=' },
                    { id: 'view.zoomOut', label: 'Zoom Out', accel: 'Ctrl+-' },
                    { id: 'view.zoomReset', label: 'Reset Zoom', accel: 'Ctrl+0' },
                    { separator: true },
                    { id: 'view.themeDark', label: 'Theme: Dark Slate' },
                    { id: 'view.themeLight', label: 'Theme: Light Paper' },
                    { id: 'view.themeSepia', label: 'Theme: Warm Sepia' },
                    { id: 'view.themeObsidian', label: 'Theme: Obsidian Cyber' }
                ]
            },
            {
                id: 'window',
                label: 'Window',
                items: [
                    { id: 'window.minimize', label: 'Minimize', accel: 'Ctrl+M' },
                    { id: 'window.maximize', label: 'Toggle Maximize' },
                    { id: 'window.pin', label: 'Always on Top (Pin)' },
                    { separator: true },
                    { id: 'window.stats', label: 'Document Information...' }
                ]
            }
        ];

        try {
            bro.menu.set(menuTree);

            // Wire handlers to actions
            const handlers = {
                'file.new': () => this.dispatch('newNote'),
                'file.open': () => this.dispatch('openFile'),
                'file.save': () => this.dispatch('saveDoc'),
                'file.saveAs': () => this.dispatch('saveAsDoc'),
                'file.exportHtml': () => this.dispatch('exportHtml'),
                'file.exportMd': () => this.dispatch('exportMd'),
                'edit.undo': () => this.dispatch('undo'),
                'edit.redo': () => this.dispatch('redo'),
                'edit.cut': () => document.execCommand('cut'),
                'edit.copy': () => document.execCommand('copy'),
                'edit.paste': () => document.execCommand('paste'),
                'edit.find': () => this.dispatch('toggleFind'),
                'edit.selectAll': () => this.dispatch('selectAll'),
                'view.toggleSidebar': () => this.dispatch('toggleSidebar'),
                'view.togglePreview': () => this.dispatch('togglePreview'),
                'view.modeSplit': () => this.dispatch('setViewMode', 'split'),
                'view.modeEditor': () => this.dispatch('setViewMode', 'editor'),
                'view.modePreview': () => this.dispatch('setViewMode', 'preview'),
                'view.zoomIn': () => this.dispatch('zoom', 10),
                'view.zoomOut': () => this.dispatch('zoom', -10),
                'view.zoomReset': () => this.dispatch('zoomReset'),
                'view.themeDark': () => this.dispatch('setTheme', 'dark'),
                'view.themeLight': () => this.dispatch('setTheme', 'light'),
                'view.themeSepia': () => this.dispatch('setTheme', 'sepia'),
                'view.themeObsidian': () => this.dispatch('setTheme', 'obsidian'),
                'window.minimize': () => this.minimizeWindow(),
                'window.maximize': () => this.toggleMaximizeWindow(),
                'window.pin': () => this.togglePinWindow(),
                'window.stats': () => this.dispatch('showDocInfo')
            };

            for (const [id, fn] of Object.entries(handlers)) {
                bro.menu.on(id, fn);
            }

            bro.menu.show();
        } catch (e) {
            console.warn('Error configuring bro.menu:', e);
        }
    }

    initGlobalShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey)) return;

            const key = e.key.toLowerCase();

            if (key === 'n' && !e.shiftKey) {
                e.preventDefault();
                this.dispatch('newNote');
            } else if (key === 'o' && !e.shiftKey) {
                e.preventDefault();
                this.dispatch('openFile');
            } else if (key === 's') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.dispatch('saveAsDoc');
                } else {
                    this.dispatch('saveDoc');
                }
            } else if (key === 'b') {
                e.preventDefault();
                this.dispatch('toggleSidebar');
            } else if (key === 'p') {
                e.preventDefault();
                this.dispatch('togglePreview');
            } else if (key === 'f') {
                e.preventDefault();
                this.dispatch('toggleFind');
            } else if (key === '1') {
                e.preventDefault();
                this.dispatch('setViewMode', 'split');
            } else if (key === '2') {
                e.preventDefault();
                this.dispatch('setViewMode', 'editor');
            } else if (key === '3') {
                e.preventDefault();
                this.dispatch('setViewMode', 'preview');
            } else if (key === '=' || key === '+') {
                e.preventDefault();
                this.dispatch('zoom', 10);
            } else if (key === '-' || key === '_') {
                e.preventDefault();
                this.dispatch('zoom', -10);
            } else if (key === '0') {
                e.preventDefault();
                this.dispatch('zoomReset');
            } else if (key === 'm') {
                e.preventDefault();
                this.minimizeWindow();
            }
        });
    }

    dispatch(actionName, ...args) {
        if (typeof this.actions[actionName] === 'function') {
            this.actions[actionName](...args);
        }
    }

    // ── bro.window OS Controls ────────────────────────────────────────────────

    minimizeWindow() {
        if (typeof bro !== 'undefined' && bro.window && typeof bro.window.minimize === 'function') {
            bro.window.minimize();
        }
    }

    toggleMaximizeWindow() {
        if (typeof bro !== 'undefined' && bro.window) {
            if (bro.window.state === 'maximized') {
                bro.window.restore();
            } else if (typeof bro.window.maximize === 'function') {
                bro.window.maximize();
            }
        }
    }

    togglePinWindow() {
        if (typeof bro !== 'undefined' && bro.window && typeof bro.window.alwaysOnTop !== 'undefined') {
            this.alwaysOnTop = !bro.window.alwaysOnTop;
            bro.window.alwaysOnTop = this.alwaysOnTop;
            this.dispatch('onPinChange', this.alwaysOnTop);
            return this.alwaysOnTop;
        }
        this.alwaysOnTop = !this.alwaysOnTop;
        this.dispatch('onPinChange', this.alwaysOnTop);
        return this.alwaysOnTop;
    }
}
