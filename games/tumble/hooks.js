// window.__tumble — the headless test surface (tests/test_*.js). Every
// action goes through the same functions the keyboard and mouse use.

import { LEVELS, medalFor, fmt } from "/app/levels.js";
import { PIECES, PIECE_ORDER } from "/app/pieces.js";
import { SOLUTIONS, applySolutionPieces } from "/app/solutions.js";
import { cellKey, budgetTotals } from "/app/board.js";
import { marblePositions } from "/app/marbles.js";
import * as progress from "/app/progress.js";
import { internals } from "/app/game.js";

export function installTestHooks(shell) {
    const T = {
        shell, LEVELS, PIECES, PIECE_ORDER, SOLUTIONS, medalFor, fmt,
        get run() { return internals.run; },
        get scene() { return internals.stage && internals.stage.scene; },
        get cam() { return internals.stage && internals.stage.cam; },
        get budget() { return internals.run && internals.run.budget; },
        get save() { return shell.api.save; },
        get screen() { return shell.getScreen(); },

        resetProgress() { progress.resetProgress(shell.api.save); },

        /** Unlock the whole campaign and skip the coach (campaign tests). */
        unlockAll() {
            const save = shell.api.save;
            save.set("unlocked", LEVELS.length);
            save.set("coachDone", true);
            save.set("plankCoachDone", true);
            save.save();
        },

        /** Start (or restart) a run on level idx. */
        startLevel(idx) { return internals.startLevel(shell, idx); },

        /** Place the verified solution for the current level. Does not run it. */
        applySolution(idx) {
            const i = idx != null ? idx : T.run.levelIdx;
            return applySolutionPieces(i, (type, x, y, z, rot) => T.place(type, x, y, z, rot));
        },

        place(type, cx, cy, cz, rot) { return !!T.run && internals.place(T.run, type, cx, cy, cz, rot | 0); },
        removeAt(cx, cy, cz) { return !!T.run && internals.remove(T.run, cellKey(cx, cy, cz)); },
        select(type) { return !!T.run && internals.select(T.run, type); },
        rotate() { return !!T.run && internals.rotate(T.run); },
        setLayer(y) { if (!T.run) return false; internals.setLayer(T.run, y); return true; },
        enterRun() { if (!T.run) return false; internals.enterRun(T.run); return true; },
        enterBuild() { if (!T.run) return false; internals.enterBuild(T.run); return true; },
        cellAt(clientX, clientY) { return T.run ? internals.cellAt(T.run, clientX, clientY) : null; },

        /** Complete the level as if a marble scored at timeMs (skips physics). */
        forceComplete(timeMs) {
            const run = T.run;
            if (!run) return false;
            run.resultMs = timeMs != null ? timeMs : 2500;
            internals.completeLevel(run);
            return true;
        },

        /** Plain-data view of the live run for assertions and logs. */
        snapshot() {
            const run = T.run;
            if (!run || !run.level) return { screen: T.screen, hasRun: !!run };
            const t = budgetTotals(run);
            const save = shell.api.save;
            return {
                screen: T.screen,
                levelIdx: run.levelIdx,
                levelId: run.level.id,
                levelName: run.level.name,
                mode: run.mode,
                placed: run.placed.size,
                budgetUsed: t.used,
                budgetLimit: t.limit,
                selected: run.build.selected,
                rot: run.build.rot,
                layer: run.build.layer,
                marblesSpawned: run.marblesSpawned,
                marblesAlive: run.marbles.length,
                marblesRemoved: run.marblesRemoved,
                runtimeMs: run.runtime,
                resultMs: run.resultMs,
                newBest: !!run.newBest,
                coachStep: run.coachStep,
                score: run.score,
                marbles: marblePositions(run),
                unlocked: save.get("unlocked"),
                best: save.get("best"),
                coachDone: save.get("coachDone"),
            };
        },
    };
    window.__tumble = T;
    return T;
}
