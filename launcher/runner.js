// launcher/runner.js — running apps. Each launch spawns a detached `bro`
// child process; an app that declares `server` in apps.json also gets its
// server script run in-process as a Worker (the worker-scoped bro.net /
// bro.ai.game surface), terminated when the client exits.

import { APPS_ROOT } from "./catalog.js";

const path = require('path');
const cp = require('child_process');

// BRO_EXE_DIR is set by bro before the engine starts.
export const EXE_DIR = process.env.BRO_EXE_DIR || process.cwd();
const BRO = path.join(EXE_DIR, 'bro' + (process.platform === 'win32' ? '.exe' : ''));
const SPAWN_CWD = path.dirname(APPS_ROOT);

/**
 * runner({ onChange(), onMessage(text, kind) }) -> { launch(app), stop(dir),
 * isRunning(dir), entries(), target, stopServers() }. `target` is the dir a
 * pasted thumbnail goes to: the latest launch, or whichever pill was picked.
 */
export function runner(opts) {
    const running = new Map();   // dir -> { app, client, server }
    const changed = () => opts.onChange && opts.onChange();
    const say = (t, kind) => opts.onMessage && opts.onMessage(t, kind);
    let target = null;

    function launch(app) {
        if (running.has(app.dir)) { say(app.title + ' is already running.', 'warn'); return false; }
        say('Launching ' + app.title + '...', 'busy');

        let server = null;
        if (app.server) {
            try {
                server = new Worker(path.join(app.appPath, app.server.script));
                server.onmessage = (e) => console.log('[' + app.dir + ' server]', e.data);
            } catch (e) {
                console.error('server worker failed:', e);
                say('Server failed for ' + app.title + ': ' + e.message, 'err');
                return false;
            }
        }

        let client;
        try {
            client = cp.spawn(BRO, [app.appPath], { cwd: SPAWN_CWD });
        } catch (e) {
            console.error('client spawn failed:', e);
            say('Failed to launch ' + app.title + ': ' + e.message, 'err');
            if (server) server.terminate();
            return false;
        }

        running.set(app.dir, { app, client, server });
        target = app.dir;
        changed();
        say(app.title + ' running (pid ' + client.pid + '). Ctrl+V pastes a new thumbnail for it.', 'ok');

        client.on('exit', (code) => {
            const entry = running.get(app.dir);
            if (!entry) return;
            if (entry.server) entry.server.terminate();
            running.delete(app.dir);
            if (target === app.dir) target = running.keys().next().value || null;
            changed();
            say(app.title + ' exited (code ' + code + ').', code ? 'warn' : '');
        });
        return true;
    }

    return {
        launch,
        stop(dir) { const e = running.get(dir); if (e) e.client.kill(); },
        isRunning: (dir) => running.has(dir),
        entries: () => Array.from(running.values()),
        get target() { return target; },
        set target(dir) { target = running.has(dir) ? dir : null; changed(); },
        stopServers() { for (const e of running.values()) if (e.server) e.server.terminate(); },
    };
}
