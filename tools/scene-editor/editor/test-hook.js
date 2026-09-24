// window.__editor: the headless tests' handle on the editor. Tests drive
// tools directly (begin / update / commit without synthesizing mouse input)
// and inspect state. `ed` is the whole editor context; the flat names below
// are the stable surface the tests in tests/ are written against.
//
// Getters resolve on every read, so tests always see the current rebuilt
// state (e.g. the active primitive's buffers after a push/pull commit).

import { groundPlane, sketchPlaneFromRay, faceGroupBoundaryWorld, edgePrimitiveToPath } from "../model/mesh-ops.js";
import { serializeScene, deserializeScene } from "../model/project-io.js";
import { captureMesh, applyMesh } from "../model/snapshots.js";

export function installTestHook(ed, extra) {
    const reg = ed.registry;
    const tool = (name) => ed.tools.get(name);
    const active = () => reg.active;
    const pp = tool('pushpull'), mv = tool('move'), rect = tool('rectangle'), circ = tool('circle');
    const line = tool('line'), arc = tool('arc'), offset = tool('offset'), follow = tool('followme');
    const tape = tool('tape');

    window.__editor = {
        ed,
        scene: ed.viewport.scene,
        cam: ed.viewport.cam,
        registry: reg,
        history: ed.history,
        proj: extra.proj,
        screenToRay: (cx, cy) => ed.viewport.ray(cx, cy),
        pickAt: ed.pickAt,

        // The active primitive's state.
        get boxMesh()      { return active() && active().mesh; },
        get boxBVH()       { return active() && active().bvh; },
        get boxPositions() { return active() && active().positions; },
        get boxIndices()   { return active() && active().indices; },
        get faceGroups()   { return active() && active().faceGroups; },
        get inferenceGeo() { return active() && active().inferenceGeo; },
        get edgesNode()    { return active() && active().edgesNode; },
        get highlightNode() { return ed.highlight.node; },
        get currentTool()  { return ed.tools.name; },
        setTool: (name) => ed.tools.set(name),

        // Document.
        setupDefaultScene: () => ed.cmd.resetScene(),
        serializeScene: () => serializeScene(reg, { nextAddX: ed.cmd.nextAddX }),
        deserializeScene: (data) => { deserializeScene(reg, data); if (typeof data.nextAddX === 'number') ed.cmd.nextAddX = data.nextAddX; },
        outlinerAddPrimitive: (type) => ed.cmd.addPrimitive(type),
        deletePrimitive: (obj) => ed.cmd.deleteObject(obj),
        eraseFace: (prim, gIdx) => ed.cmd.eraseFace(prim, gIdx),
        captureMesh, applyMesh,

        // Snapping + sketch planes.
        resolveSnap: (cx, cy, ray, face, excludeTypes, excludeId) => ed.snap.resolve(cx, cy, ray, face, excludeTypes, excludeId),
        currentSketchPlane: groundPlane,
        resolveSketchPlaneFromRay: (ray) => sketchPlaneFromRay(reg, ray),

        // VCB.
        measureBoxState: ed.vcb.state,
        handleMeasureBoxKey: (key) => ed.vcb.key(key),
        redoLastPushPull: (d) => pp.redoLast(d),

        // Push/pull (beginPushPull works on the active primitive).
        get pushpull() { return pp.state; },
        beginPushPull: (hit) => pp.begin(active(), hit),
        beginPushPullOn: (prim, hit) => pp.begin(prim, hit),
        applyPushPull: (t) => pp.apply(t),
        commitPushPull: () => pp.commit(),
        cancelPushPull: () => pp.cancel(),

        // Move.
        get moveToolState() { return mv.state; },
        beginMove: (obj, hit) => mv.begin(obj, hit),
        applyMoveDelta: (dx, dy, dz) => mv.applyDelta(dx, dy, dz),
        commitMove: () => mv.commit(),
        cancelMove: () => mv.cancel(),

        // Rectangle / circle.
        get rectangleToolState() { return rect.state; },
        beginRectangle: (pos, plane) => rect.begin(pos, plane),
        updateRectangleAt: (pos) => rect.update(pos),
        applyRectangleDimensions: (w, h) => rect.setSize(w, h),
        commitRectangle: () => rect.commit(),
        cancelRectangle: () => rect.cancel(),
        get circleToolState() { return circ.state; },
        beginCircle: (pos, plane) => circ.begin(pos, plane),
        updateCircleAt: (pos) => circ.update(pos),
        applyCircleRadius: (r) => circ.setRadius(r),
        commitCircle: () => circ.commit(),
        cancelCircle: () => circ.cancel(),

        // Line / arc.
        get lineToolState() { return line.state; },
        beginLine: (pos, plane) => line.begin(pos, plane),
        updateLineAt: (pos) => line.update(pos),
        addLinePoint: (pos) => line.addPoint(pos),
        commitLine: () => line.commit(),
        cancelLine: () => line.cancel(),
        resolveLinePoint: (cx, cy) => line.resolvePoint(cx, cy),
        persistOrphanEdges: (points, baseName) => ed.cmd.addEdges(points, baseName),
        get arcToolState() { return arc.state; },
        beginArc: (pos, plane) => arc.begin(pos, plane),
        updateArcAt: (pos) => arc.update(pos),
        setArcEnd: (pos) => arc.setEnd(pos),
        commitArc: () => arc.commit(),
        cancelArc: () => arc.cancel(),

        // Offset / follow me / tape.
        get offsetToolState() { return offset.state; },
        beginOffset: (prim, gIdx, pos) => offset.begin(prim, gIdx, pos),
        updateOffsetAt: (pos) => offset.update(pos),
        applyOffsetDistance: (d) => offset.setDistance(d),
        commitOffset: () => offset.commit(),
        cancelOffset: () => offset.cancel(),
        faceGroupBoundaryWorld,
        get followMeToolState() { return follow.state; },
        runFollowMe: (prim, gIdx, path) => follow.run(prim, gIdx, path),
        edgePrimitiveToPath,
        get tapeToolState() { return tape.state; },
        beginTape: (pos) => tape.begin(pos),
        updateTapeAt: (pos) => tape.update(pos),
        commitTape: () => tape.commit(),
        cancelTape: () => tape.cancel(),
    };
}
