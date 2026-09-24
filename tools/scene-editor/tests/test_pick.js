// Picking through real clicks: a click on the default box hits it and
// highlights the face group, a click off it misses and clears the highlight.
import { check, frames, shot } from "/lib/kit/test.js";
import { worldToScreen } from "/lib/kit/viewport3d.js";

frames(6);
const E = window.__editor;
const rect = document.getElementById('canvas').getBoundingClientRect();
shot('pick-before');

// Click the middle of the box's +Z face (the select tool shows no gizmo).
const face = worldToScreen([0.4, -0.4, 1], E.ed.viewport.view(), rect.width, rect.height);
const hitX = rect.left + face.x, hitY = rect.top + face.y;
click(hitX, hitY);
advanceTime(50);

const hit = window.__lastPick;
check(hit, 'off-centre click must hit the box');
check(hit.triangleIndex >= 0 && hit.triangleIndex < 12, `triangleIndex in range (got ${hit.triangleIndex})`);
check(hit.distance > 0, 'hit distance must be positive');

// Mesh.box(1,1,1) has half-extents 1: the hit lies on [-1, 1]^3.
const p = hit.position, EPS = 0.01;
for (let a = 0; a < 3; a++) {
    check(p[a] >= -1 - EPS && p[a] <= 1 + EPS, `hit ${'xyz'[a]} in bbox (got ${p[a]})`);
}
check(E.highlightNode, 'highlight node after pick');
check(/\[Box\] tri/.test(document.getElementById('pick-info').textContent), 'status line shows the hit');

// Six face groups of 2 coplanar triangles, one per axis direction.
const fg = E.faceGroups;
check(fg.groups.length === 6, `box has 6 face groups (got ${fg.groups.length})`);
const dirs = new Set();
for (const g of fg.groups) {
    check(g.tris.length === 2, `each face group has 2 tris (got ${g.tris.length})`);
    check(Math.abs(Math.hypot(g.normal[0], g.normal[1], g.normal[2]) - 1) < 1e-5, 'unit face normal');
    for (let a = 0; a < 3; a++) if (Math.abs(g.normal[a]) > 0.999) dirs.add((g.normal[a] > 0 ? '+' : '-') + 'XYZ'[a]);
}
check(dirs.size === 6, `all 6 axis directions (got ${[...dirs].sort().join(',')})`);

// A pixel near the canvas's right edge misses: the ray passes beside the box.
const missX = rect.left + rect.width - 60, missY = rect.top + rect.height / 2;
const missRay = E.screenToRay(missX - rect.left, missY - rect.top);
check(!E.boxBVH.raycast(E.boxMesh, missRay.origin, missRay.dir, 0), 'right-edge pixel misses the box');
click(missX, missY);
advanceTime(50);
check(!E.highlightNode, 'highlight clears on a miss');

click(hitX, hitY);
advanceTime(50);
check(E.highlightNode, 'highlight back on a second box click');
shot('pick-after');
console.log(`OK — picked tri ${hit.triangleIndex} at [${p.map(v => v.toFixed(3)).join(', ')}]`);
