// tools.js — the editor's tools, as lib/kit/editor.js toolbox entries.
//
// Each tool takes pointer input as cells: down(hit, e), move(hit), up(), where
// hit is a TileWorld.raycastCell result ({ x, y, ... }) or null off the map.
// The paint tools share one gesture set:
//   drag          paint with the round brush
//   Shift-drag    fill the rectangle between press and release
//   Ctrl-click    flood fill the connected region (ground / overlay)
//   Alt-click     eyedropper (ground / overlay)

import { LAYER } from "./map.js";

/** Current brush settings, shared by the tools and the panel. */
export function brushState(init) {
    return Object.assign({
        ground: 1, overlay: 20, elevDir: 1, flag: true, radius: 0,
        tint: [1, 0.4, 0.27, 1], prop: 'tree',
    }, init);
}

/**
 * A painting tool. spec: { label, apply(x, y), layer (flood / eyedrop
 * layer, or undefined), pick(id) (eyedropper result) }.
 */
function paintTool(map, brush, spec, hooks) {
    let mode = null;                 // 'stroke' | 'rect'
    let lastCell = null, rectStart = null, rectEnd = null;

    const paintAt = (hit) => {
        for (const [x, y] of map.cellsInRadius(hit.x, hit.y, brush.radius)) spec.apply(x, y);
    };
    const tool = {
        paints: true,
        label: spec.label,
        busy: () => mode !== null,
        cancel() {
            if (mode === 'stroke') map.cancelStroke();
            mode = null; rectStart = rectEnd = null;
            if (hooks.onRect) hooks.onRect(null);
        },
        down(hit, e) {
            if (!hit) return;
            if (e.altKey) {
                if (spec.layer != null && spec.pick) spec.pick(map.tileAt(hit.x, hit.y, spec.layer));
                return;
            }
            if (e.ctrlKey) {
                if (spec.layer == null) return;
                map.beginStroke('Flood fill');
                for (const [x, y] of map.floodCells(hit.x, hit.y, spec.layer)) spec.apply(x, y);
                map.endStroke();
                return;
            }
            if (e.shiftKey) {
                mode = 'rect'; rectStart = rectEnd = hit;
                if (hooks.onRect) hooks.onRect(rectStart, rectEnd);
                return;
            }
            mode = 'stroke';
            map.beginStroke(spec.label);
            paintAt(hit);
            lastCell = hit.x + ',' + hit.y;
        },
        move(hit) {
            if (!hit) return;
            if (mode === 'rect') {
                rectEnd = hit;
                if (hooks.onRect) hooks.onRect(rectStart, rectEnd);
            } else if (mode === 'stroke') {
                const k = hit.x + ',' + hit.y;
                if (k !== lastCell) { paintAt(hit); lastCell = k; }
            }
        },
        up() {
            if (mode === 'rect' && rectStart && rectEnd) {
                map.beginStroke('Rect fill');
                map.fillRect(rectStart.x, rectStart.y, rectEnd.x, rectEnd.y, spec.apply);
                map.endStroke();
                if (hooks.onRect) hooks.onRect(null);
            } else if (mode === 'stroke') {
                map.endStroke();
            }
            mode = null; rectStart = rectEnd = null;
        },
    };
    return tool;
}

/**
 * All tools by name. hooks: { onPick(layerName, id) after an eyedropper,
 * onRect(a, b) rect-drag preview (null ends it), onPath(state) after a
 * pathfind click ('start' | 'found' | 'none') }.
 */
export function createTools(map, brush, hooks) {
    const hk = hooks || {};
    let pathStart = null;
    return {
        ground: paintTool(map, brush, {
            label: 'Paint ground', layer: LAYER.ground,
            apply: (x, y) => map.paintGround(x, y, brush.ground),
            pick: (id) => { brush.ground = id; if (hk.onPick) hk.onPick('ground', id); },
        }, hk),
        elevation: paintTool(map, brush, {
            label: 'Raise elevation',
            apply: (x, y) => map.raise(x, y, brush.elevDir),
        }, hk),
        overlay: paintTool(map, brush, {
            label: 'Paint overlay', layer: LAYER.overlay,
            apply: (x, y) => map.paintOverlay(x, y, brush.overlay),
            pick: (id) => { brush.overlay = id; if (hk.onPick) hk.onPick('overlay', id); },
        }, hk),
        tint: paintTool(map, brush, {
            label: 'Paint tint',
            apply: (x, y) => map.paintTint(x, y, brush.tint),
        }, hk),
        flags: paintTool(map, brush, {
            label: 'Paint flags',
            apply: (x, y) => map.paintFlag(x, y, brush.flag),
        }, hk),
        object: {
            label: 'Place props',
            down(hit) { if (hit) map.placeProp(brush.prop, hit.x, hit.y); },
        },
        pathfind: {
            label: 'Pathfind',
            get start() { return pathStart; },
            deactivate() { pathStart = null; },
            reset() { pathStart = null; map.clearPath(); },
            down(hit) {
                if (!hit) return;
                if (!pathStart) {
                    pathStart = { x: hit.x, y: hit.y };
                    map.markStart(hit.x, hit.y);
                    if (hk.onPath) hk.onPath('start');
                } else {
                    const path = map.queryPath(pathStart.x, pathStart.y, hit.x, hit.y);
                    pathStart = null;
                    if (hk.onPath) hk.onPath(path && path.length ? 'found' : 'none', path);
                }
            },
        },
    };
}
