// Off-mesh links carry a binding walker over a gap nothing else crosses;
// requireFullPath splits partial from none; the NavGrid baked from the same
// physics; groundFollow as the only variable between two agents.
//
//   scripts/validate.sh demos/nav-lab
import { check, test, done, text } from "/lib/kit/test.js";
import { marks, linkMarks } from "/app/level.js";
import { navState } from "/app/navmesh.js";
import { LINK_DEFS, linkState, linkIsLive, linkSegmentsOf, sendLinkWalkers, comparePartial, setSealed } from "/app/links.js";
import { gridState, gridWalkable, setGridOverlayVisible, walkTheRamp, resetFollowers, followerSpread, followerOf } from "/app/grid.js";
import { state, setRoute, rebake } from "/app/lab.js";
import { reach } from "./reach.js";

advanceTime(100);
const mesh = () => navState.mesh;

test('the static bake carries three live links; links + obstacles is refused', () => {
    check(navState.linksBaked === 3, navState.linksBaked + ' links');
    let refused = false;
    try {
        bro.ai.game.bakeNavMesh({ fromPhysics: Physics, dynamicObstacles: true,
            offMeshLinks: [{ start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } }] });
    } catch (e) { refused = /offMeshLinks/.test(e.message); }
    check(refused, 'bakeNavMesh throws rather than dropping links');
    for (const def of LINK_DEFS) check(linkIsLive(def), def.id + ' link survived the bake');
    check(text('#stLinksLive') === '3 / 3', 'HUD: ' + text('#stLinksLive'));
});

test('the only route to the island is the jump link', () => {
    let gap = 0;
    for (let x = 11.2; x <= 15.3; x += 0.25) {
        const q = mesh().nearestPoint({ x, y: 3, z: -10.5 }, { x: 0.15, y: 0.5, z: 0.15 });
        if (q && Math.abs(q.x - x) < 0.12) gap++;
    }
    check(gap === 0, gap + ' walkable samples in the gap');
    const p = setRoute(marks.eastRoom, linkMarks.padEast);
    check(p && !p.partial, 'route found');
    const segs = linkSegmentsOf(p);
    check(segs.length >= 1, 'links: ' + JSON.stringify(p.links));
    const s = segs[0];
    check(Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z) > 4.0 && s.from.x < 11.5 && s.to.x > 15.0,
        `takeoff ${s.from.x.toFixed(2)} -> landing ${s.to.x.toFixed(2)}`);
    check(p.points[p.points.length - 1].x > 15.4, 'ends on the island');
    check(+text('#stLinkSegs') === segs.length && /off-mesh link/.test(text('#pathHint')), 'HUD: ' + text('#pathHint'));
});

test('binding walkers physically jump the gap', () => {
    const before = linkState.walkers.map((w) => w.agent.x);
    check(before.every((x) => x < 11.0), 'start west of the gap');
    reach('#btnLinkJump');
    check(new RegExp(`^${linkState.walkers.length} walker`).test(text('#linkHint')), text('#linkHint'));
    check(sendLinkWalkers(linkMarks.padEast) === linkState.walkers.length, 'every walker routed');
    let sawOnLink = false;
    for (let i = 0; i < 120; i++) {
        advanceTime(120);
        if (linkState.onLinkNow > 0) sawOnLink = true;
        if (linkState.crossedGap >= linkState.walkers.length && linkState.traversals >= linkState.walkers.length) break;
    }
    advanceTime(500);
    check(sawOnLink, 'navigationInfo().onLink fired mid-air');
    check(linkState.traversals >= linkState.walkers.length && linkState.lastLink === 'jump', `${linkState.traversals} crossings, last ${linkState.lastLink}`);
    check(linkState.walkers.every((w) => w.agent.x > 15.4 && w.node.y > 3.4 && w.node.y < 4.4),
        linkState.walkers.map((w) => `${w.agent.x.toFixed(1)},${w.node.y.toFixed(2)}`).join(' '));
    check(linkState.crossedGap === linkState.walkers.length, 'counted onto the island');
    advanceTime(400);
    check(+text('#stTraversals') === linkState.traversals, 'HUD traversals');
});

test('walkers go home and can take the drop', () => {
    reach('#btnLinkHome');
    check(linkState.walkers.every((w) => w.agent.x < 11.0), 'back west of the gap');
    reach('#btnLinkDrop');
    check(/walker/.test(text('#linkHint')), text('#linkHint'));
});

test('sealing the pad splits requireFullPath:false from true', () => {
    reach('#btnSeal');
    check(navState.linksBaked === 2, navState.linksBaked + ' links');
    check(!linkIsLive(LINK_DEFS.find((l) => l.id === 'jump')), 'jump gone');
    check(LINK_DEFS.filter((l) => l.id !== 'jump').every(linkIsLive), 'the other two untouched');
    const r = linkState.partial;
    check(r.looseFound && r.loosePartial && r.shortfall > 2.0, 'loose: partial, ' + r.shortfall.toFixed(2) + ' m short');
    check(r.clampedAt.y < 1.0 && Math.abs(r.clampedAt.x - linkMarks.padEast.x) < 3.0, 'clamped to the ground under the pad');
    check(!r.strictFound, 'strict: no path');
    check(text('#stLoose') === 'partial' && text('#stStrict') === 'none', 'HUD readouts');
    check(state.path && state.path.partial, 'the drawn path is the clamped one');

    reach('#btnUnseal');
    const open = comparePartial({ ...marks.eastRoom }, { ...linkMarks.padEast });
    check(open.looseFound && !open.loosePartial && open.strictFound, 'both agree once unsealed');
    check(navState.linksBaked === 3, 'jump back in the bake');
});

test('the NavGrid bakes from the same physics and blocks the ramp', () => {
    setGridOverlayVisible(true);
    check(gridState.cells > 1000 && gridState.cells < gridState.tested * 0.9, `${gridState.cells} of ${gridState.tested}`);
    for (const [label, x, z] of [['divider wall', 4, -10], ['pillar', 10, -6], ['chamber wall', 12, -18]]) check(!gridWalkable(x, z), label + ' blocked');
    for (const [label, x, z] of [['west hall', -17, -17], ['east room', 19, -10]]) check(gridWalkable(x, z), label + ' open');
    const RAMP_D = { x: 14, y: 1.5, z: -1.0 };
    const q = mesh().nearestPoint(RAMP_D, { x: 0.6, y: 1.2, z: 0.6 });
    check(q && Math.abs(q.x - RAMP_D.x) < 0.4 && q.y > 0.8, 'navmesh walks ramp D');
    check(!gridWalkable(RAMP_D.x, RAMP_D.z), 'the grid blocks its AABB');
});

test('groundFollow is the only thing that lifts an agent up the ramp', () => {
    resetFollowers();
    advanceTime(200);
    walkTheRamp();
    advanceTime(9000);
    const gf = followerOf(true), flat = followerOf(false);
    check(Math.abs(gf.agent.z - flat.agent.z) < 1.5 && gf.agent.z < -6, 'both walked');
    check(followerSpread(true) > 2.5, 'follower Y range ' + followerSpread(true).toFixed(2));
    check(followerSpread(false) === 0, 'plain Y range ' + followerSpread(false));
    check(gf.node.y > 3.4 && Math.abs(flat.node.y - 0.76) < 1e-3, `${gf.node.y.toFixed(2)} / ${flat.node.y.toFixed(3)}`);
});

setSealed(false);
rebake();
done('nav-lab links');
