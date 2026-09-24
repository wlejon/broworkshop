// Scene Editor: a SketchUp-style modeller on bro.scene.
//
// Layout of the code:
//   model/    the document: SceneObject tree (groups, primitives, edge
//             primitives, components), SceneRegistry, mesh surgery, snapping
//             geometry, project file format, undo snapshots. No DOM.
//   tools/    pure tool state machines (MoveTool, LineTool, MeasureBox, ...).
//   editor/   the interactive layer: viewport, overlays, gizmo, VCB, the tool
//             controllers that drive tools/ from input, document commands,
//             outliner and inspector panels.
//   main.js   builds the shared editor context `ed`, routes input to the
//             current tool, and wires history / project / HUD.
//
// Every tool controller is a toolbox tool (lib/kit/editor.js) with input
// hooks: down(p), move(p) -> handled?, up(p), dblclick(), claimsRightClick()
// + rightClick(), and an optional `vcb` block (editor/vcb.js). p is
// { cx, cy, ray, pick } in canvas pixels / world space.

import { History } from "/lib/kit/history.js";
import { Project } from "/lib/kit/project.js";
import { boot } from "/lib/kit/app.js";
import { toolbox, documentCommands } from "/lib/kit/editor.js";
import { SceneRegistry } from "./model/scene-registry.js";
import { PROJECT_SCHEMA, serializeScene, deserializeScene } from "./model/project-io.js";
import { createViewport } from "./editor/viewport.js";
import { Highlight } from "./editor/overlays.js";
import { createSnap } from "./editor/snap.js";
import { createVcb } from "./editor/vcb.js";
import { createGizmo } from "./editor/gizmo.js";
import { createCommands } from "./editor/commands.js";
import { createOutliner } from "./editor/outliner.js";
import { createInspector } from "./editor/inspector.js";
import { selectTool, moveTool, gizmoTool } from "./editor/transform-tools.js";
import { pushPullTool } from "./editor/pushpull.js";
import { rectangleTool, circleTool } from "./editor/shape-tools.js";
import { lineTool, arcTool } from "./editor/line-tools.js";
import { offsetTool, followMeTool, eraseTool, tapeTool } from "./editor/face-tools.js";
import { installTestHook } from "./editor/test-hook.js";

const byId = (id) => document.getElementById(id);
const canvas = byId('canvas');

// --- the editor context -----------------------------------------------------

const ed = {};
ed.viewport = createViewport(canvas, {
    onCamera: () => { if (ed.gizmo) ed.gizmo.update(); },
    // Right-click finishes a line chain instead of orbiting.
    acceptOrbit: (e) => !(e.button === 2 && claimsRightClick()),
});
ed.registry = new SceneRegistry({ scene: ed.viewport.scene });
ed.history = new History({ limit: 200 });
ed.highlight = new Highlight(ed.viewport.scene);
ed.snap = createSnap(ed, byId('snap-marker'), byId('snap-info'));
ed.vcb = createVcb(ed, byId('measure-box'));
ed.gizmo = createGizmo(ed);
ed.cmd = createCommands(ed);

/** Registry pick under canvas pixel (cx, cy); { primitive, object, hit } or null. */
ed.pickAt = (cx, cy, excludeId) => {
    const r = ed.viewport.ray(cx, cy);
    return ed.registry.pickAt(r.origin, r.dir, excludeId != null ? { excludeId } : null);
};
/** An object is going away: drop every gesture and overlay bound to it. */
ed.release = (obj) => {
    for (const n of ed.tools.names) {
        const t = ed.tools.get(n);
        if (t.release) t.release(obj);
    }
    ed.gizmo.release(obj);
    ed.highlight.release(obj);
};
ed.redoLast = (distance) => ed.tools.get('pushpull').redoLast(distance);

ed.cmd.resetScene();

ed.tools = toolbox({
    tools: {
        select:    selectTool(ed),
        move:      moveTool(ed),
        rotate:    gizmoTool(ed),
        scale:     gizmoTool(ed),
        pushpull:  pushPullTool(ed),
        line:      lineTool(ed),
        rectangle: rectangleTool(ed),
        circle:    circleTool(ed),
        arc:       arcTool(ed),
        offset:    offsetTool(ed),
        followme:  followMeTool(ed),
        erase:     eraseTool(ed),
        tape:      tapeTool(ed),
    },
    initial: 'select',
    buttons: '#toolbar',
    onChange: (name) => {
        ed.vcb.dismiss();
        byId('tool-name').textContent = name;
        ed.highlight.clear();
        ed.snap.clear();
        ed.status('no pick');
        ed.gizmo.update();
    },
});

function claimsRightClick() {
    const t = ed.tools && ed.tools.tool;
    return !!(t && t.claimsRightClick && t.claimsRightClick());
}

// --- project + commands ------------------------------------------------------

const proj = new Project({
    app: 'scene-editor',
    schema: PROJECT_SCHEMA,
    serialize: () => serializeScene(ed.registry, { nextAddX: ed.cmd.nextAddX }),
    deserialize: (data) => {
        ed.tools.cancelAll();
        ed.highlight.clear();
        deserializeScene(ed.registry, data);
        if (typeof data.nextAddX === 'number') ed.cmd.nextAddX = data.nextAddX;
        ed.vcb.dismiss();
        ed.gizmo.update();
    },
    onNew: () => ed.cmd.resetScene(),
    history: ed.history,
});
ed.project = proj;

const doc = documentCommands({
    history: ed.history,
    project: proj,
    canRun: () => !ed.tools.busy(),     // a half-done gesture would confuse undo / save
    undoButton: '#undo',
    redoButton: '#redo',
});
const app = boot({ menu: doc.menu, status: '#pick-info' });
ed.status = (text, kind) => app.status.set(text, kind);

const ACTIONS = {
    'group':          () => ed.cmd.group(),
    'ungroup':        () => ed.cmd.ungroup(),
    'make-component': () => ed.cmd.makeComponent(),
};
for (const b of Array.from(document.querySelectorAll('[data-action]'))) {
    b.addEventListener('click', () => ACTIONS[b.dataset.action]());
}

// --- panels + HUD ------------------------------------------------------------

const outliner = createOutliner(ed, {
    list: byId('outliner-list'), breadcrumb: byId('context-breadcrumb'), add: byId('outliner-add'),
});
const inspector = createInspector(ed, byId('inspector'));

ed.registry.onChange = () => {
    outliner.render();
    inspector.refresh();
    ed.gizmo.update();
};

const historyEl = byId('history-info');
function renderHistory() {
    const h = ed.history;
    if (!h.canUndo() && !h.canRedo()) { historyEl.textContent = 'history: empty'; return; }
    const parts = ['history:'];
    if (h.canUndo()) parts.push('↶ ' + h.entries()[h.size() - 1].label);
    if (h.canRedo()) parts.push('↷');
    historyEl.textContent = parts.join('  ');
}
ed.history.on('change', () => { renderHistory(); inspector.refresh(); });

const titleEl = byId('project-title');
function renderTitle() {
    titleEl.textContent = proj.name + (proj.isDirty() ? ' *' : '');
    titleEl.classList.toggle('dirty', proj.isDirty());
}
proj.on('change', renderTitle);

outliner.render();
renderHistory();
renderTitle();
ed.vcb.render();
ed.viewport.apply();

// --- input ---------------------------------------------------------------------

function formatHit(pick) {
    if (!pick) return 'no pick';
    const { hit } = pick, f = (v) => '[' + v.map(x => x.toFixed(2)).join(', ') + ']';
    return `[${pick.primitive.name}] tri ${hit.triangleIndex} · dist ${hit.distance.toFixed(3)} · ` +
           `pos ${f(hit.position)} · nrm ${f(hit.normal)}`;
}

const isTyping = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
    (t.getAttribute && t.getAttribute('contenteditable') === 'true'));

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
        // orbitControls skipped this press (acceptOrbit); finish the chain.
        if (claimsRightClick()) { ed.tools.tool.rightClick(); e.preventDefault(); }
        return;
    }
    if (e.button !== 0) return;
    // Any click ends the VCB's "re-apply last push/pull" offer.
    if (ed.vcb.state.lastOp && !ed.tools.busy()) ed.vcb.dismiss();
    const { cx, cy } = ed.viewport.point(e);
    // A click on a gizmo handle never gets here (the engine consumes it);
    // keep the pivot current so a drag that starts now anchors correctly.
    ed.gizmo.update();
    const ray = ed.viewport.ray(cx, cy);
    const pick = ed.registry.pickAt(ray.origin, ray.dir);
    ed.status(formatHit(pick));
    window.__lastPick = pick && pick.hit;      // test hook: the raw hit
    const tool = ed.tools.tool;
    if (tool.down) tool.down({ cx, cy, ray, pick });
});

document.addEventListener('mouseup', (e) => {
    const tool = ed.tools.tool;
    if (e.button === 0 && tool.up) tool.up();
});

document.addEventListener('mousemove', (e) => {
    if (ed.viewport.controls.dragging) return;
    const { cx, cy } = ed.viewport.point(e);
    const p = { cx, cy, ray: ed.viewport.ray(cx, cy) };
    const tool = ed.tools.tool;
    if (tool.move && tool.move(p)) return;
    // Idle hover: inference snap feedback, unless the cursor is off the
    // canvas or over a gizmo handle (the engine highlights those itself).
    ed.gizmo.update();
    if (e.target !== canvas || bro.gizmo.hovered) { ed.snap.clear(); return; }
    ed.snap.show(ed.snap.resolve(cx, cy, p.ray, false));
});

canvas.addEventListener('dblclick', (e) => {
    const tool = ed.tools.tool;
    if (tool.dblclick && tool.dblclick()) { e.preventDefault(); return; }
    // Double-clicking a group or component instance edits inside it.
    const { cx, cy } = ed.viewport.point(e);
    const pick = ed.pickAt(cx, cy);
    const obj = pick && pick.object;
    if (obj && (obj.kind === 'group' || obj.kind === 'component-instance') && obj !== ed.registry.editContext) {
        ed.registry.enterContext(obj);
        ed.status('entered ' + obj.name);
        e.preventDefault();
    }
});

document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if (ed.vcb.key(e.key)) { e.preventDefault(); return; }
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'g' && !ed.tools.busy()) {
        if (e.shiftKey) ed.cmd.ungroup(); else ed.cmd.group();
        e.preventDefault();
        return;
    }
    if (e.key === 'Escape') {
        // Cancel a gesture first; with none running, step out of one level
        // of group / component editing.
        if (!ed.tools.cancelAll() && ed.registry.exitContext()) ed.status('exited context');
    }
});

installTestHook(ed, { proj });
