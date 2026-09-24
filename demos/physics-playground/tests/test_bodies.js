// tests/test_bodies.js — the Ragdoll/Soft tab: jointed ragdolls (joints hold,
// per-part impulses, motorised vs kinematic pose drive) and soft bodies
// (exact pinning, per-vertex velocity, pressure, setVertex dents).

import { test, check, done, frames, clickOn, shot } from "/lib/kit/test.js";
import * as view from "/app/view.js";
import { clearAll, bodyCount } from "/app/sim/spawn.js";
import { setAreaEnabled } from "/app/sim/areas.js";
import {
    spawnRagdoll, driveRagdoll, stopDrive, poseError, jointResidual, findPart, punchPart,
    ragdollCount, totalPartCount, selection, PART_NAMES,
} from "/app/sim/ragdolls.js";
import {
    buildCloth, buildBall, destroySoft, pinIndices, gust, poke, regionRadius, meanHeight, softBodies, CLOTH,
} from "/app/sim/softbody.js";
import * as ui from "/app/ui/bodies.js";

advanceTime(200);

const log = (s) => console.log('        ' + s);
const deg = (r) => (r * 180 / Math.PI).toFixed(1) + '°';
function reset() { clearAll(); advanceTime(120); }
for (const k of ['lowgrav', 'water', 'well']) setAreaEnabled(k, false);

test('ragdoll: full part set, joints hold through a landing', () => {
    reset();
    const e = spawnRagdoll({ x: 0, y: 4, z: 0 });
    check(e.rd.partCount === PART_NAMES.length && e.rd.partCount === 12, `${e.rd.partCount} parts`);
    check(typeof Physics.getBodyProperties(e.rd.partBody(0)).mass === 'number', 'parts are ordinary bodies');
    check(findPart(e.rd.partBody(5)).index === 5 && findPart(e.rd.partBody(5)).entry === e, 'findPart maps tag back');
    check(jointResidual(e) < 1e-3, 'joints exactly closed at spawn');
    advanceTime(4000);
    let maxY = -Infinity;
    for (let i = 0; i < e.rd.partCount; i++) maxY = Math.max(maxY, Physics.getTransform(e.rd.partBody(i)).position.y);
    const worst = jointResidual(e), bend = poseError(e, 'stand');
    log(`highest part y=${maxY.toFixed(3)}, worst pivot residual ${(worst * 1000).toFixed(2)} mm, bend ${deg(bend)}`);
    check(maxY < 3.0, 'came to rest below spawn height');
    check(worst < 0.02, 'joints still hold');
    check(bend > 0.1, 'articulated rather than falling as one lump');
});

test('ragdoll: an impulse on one part moves that part most', () => {
    reset();
    const e = spawnRagdoll({ x: 0, y: 4, z: 0 });
    advanceTime(3000);
    const at = (i) => Physics.getTransform(e.rd.partBody(i)).position;
    const near = PART_NAMES.indexOf('lowerArmR'), far = PART_NAMES.indexOf('lowerLegL');
    const n0 = at(near), f0 = at(far);
    punchPart(e, near, { x: 0.2, y: 1, z: 0 }, 30);
    advanceTime(150);         // before the joint chain carries it to the far leg
    const n1 = at(near), f1 = at(far);
    const dN = Math.hypot(n1.x - n0.x, n1.y - n0.y, n1.z - n0.z), dF = Math.hypot(f1.x - f0.x, f1.y - f0.y, f1.z - f0.z);
    log(`lowerArmR moved ${dN.toFixed(3)} m, lowerLegL ${dF.toFixed(3)} m`);
    check(dN > dF * 3 && dN > 0.1, 'struck part moved most');
});

test('ragdoll: motorised drive closes joint error, stopDrive releases it', () => {
    reset();
    const e = spawnRagdoll({ x: 0, y: 4, z: 0 });
    advanceTime(3000);
    const before = poseError(e, 'stand');
    driveRagdoll(e, 'stand', false, { frequency: 20, damping: 1 });
    advanceTime(2000);
    const after = poseError(e, 'stand');
    log(`joint error ${deg(before)} -> ${deg(after)}`);
    check(after < before * 0.6 && before > 0.05, 'driveToPose closes the error');
    stopDrive(e);
    advanceTime(1500);
    log(`released: back to ${deg(poseError(e, 'stand'))}`);
    check(poseError(e, 'stand') > after, 'pose decays once limp');
});

test('ragdoll: kinematic drive stands a fallen ragdoll up', () => {
    reset();
    const e = spawnRagdoll({ x: 0, y: 4, z: 0 });
    advanceTime(3000);
    const head = PART_NAMES.indexOf('head');
    const headY = () => Physics.getTransform(e.rd.partBody(head)).position.y;
    const down = headY();
    driveRagdoll(e, 'stand', true);        // re-issued per frame by updateRagdolls
    advanceTime(2000);
    log(`head y ${down.toFixed(3)} -> ${headY().toFixed(3)}`);
    check(headY() > down + 0.8 && headY() > 1.4, 'stood up');
    stopDrive(e);
});

test('ragdoll panel: buttons, pose row and readouts', () => {
    reset();
    clickOn('#tabs [data-tab="bodies"]');
    check(!document.querySelector('[data-pane="bodies"]').hidden, 'pane shown');
    clickOn('#btnRagdoll');
    check(ragdollCount() === 1, 'drop ragdoll button');
    frames(25);
    check(document.querySelector('#stRagdolls').textContent === '1' &&
          document.querySelector('#stParts').textContent === String(PART_NAMES.length), 'status bar counts');
    clickOn('#poseRow [data-value="reach"]');
    check(ui.state.drivePose === 'reach', 'pose row sets the drive pose');
    clickOn('#btnDrive');
    frames(25);
    check(/motorised → reach · pose error/.test(document.querySelector('#driveInfo').textContent), 'drive readout: ' +
          document.querySelector('#driveInfo').textContent);
    clickOn('#btnLimp');
    frames(25);
    check(/limp/.test(document.querySelector('#driveInfo').textContent), 'limp readout');
    clickOn('#btnClearRagdolls');
    check(ragdollCount() === 0, 'clear ragdolls button');
    clickOn('#tabs [data-tab="sandbox"]');
});

test('ragdoll: clicking a limb selects that part', () => {
    reset();
    const e = spawnRagdoll({ x: 0, y: 4, z: 0 });
    advanceTime(3000);
    const i = PART_NAMES.indexOf('chest');
    const p = Physics.getTransform(e.rd.partBody(i)).position;
    const s = view.vp.toScreen([p.x, p.y, p.z]);
    const hit = view.pickAt(s.x, s.y);
    log(`pick -> ${hit.kind} ${hit.part != null ? PART_NAMES[hit.part] : ''}`);
    check(hit.kind === 'part' && selection.entry === e, 'a part of this ragdoll is selected');
    frames(25);
    check(/ragdoll #\d+ · part \d+ of 12/.test(document.querySelector('#partInfo').textContent), 'part readout');
});

test('cloth: pinned vertices are EXACTLY unchanged, the sheet sags', () => {
    reset();
    const c = buildCloth('corners');
    const pins = pinIndices('corners');
    const v0 = c.sb.vertices().slice();
    advanceTime(2500);
    const v1 = c.sb.vertices();
    let moved = 0;
    for (const i of pins) if (v0[i * 3] !== v1[i * 3] || v0[i * 3 + 1] !== v1[i * 3 + 1] || v0[i * 3 + 2] !== v1[i * 3 + 2]) moved++;
    check(moved === 0, `${pins.length} pinned, ${moved} moved`);
    const mid = Math.floor(CLOTH.gridZ / 2) * CLOTH.gridX + Math.floor(CLOTH.gridX / 2);
    const sag = v0[mid * 3 + 1] - v1[mid * 3 + 1];
    log(`centre sagged ${sag.toFixed(3)} m`);
    check(sag > 0.15, 'unpinned sheet sags');
    check(c.topo.gridX === CLOTH.gridX && c.sb.vertexCount === CLOTH.gridX * CLOTH.gridZ, 'topology matches the grid');
    const free = buildCloth('none');
    const f0 = free.sb.vertices().slice();
    advanceTime(1200);
    const fell = f0[1] - free.sb.vertices()[1];
    log(`unpinned corner fell ${fell.toFixed(3)} m`);
    check(fell > 1.5, 'unpinned cloth falls as a whole');
});

test('cloth: setVertexVelocity moves the kicked region far more', () => {
    reset();
    const c = buildCloth('corners');
    advanceTime(10000);                    // dead still, or the swing drowns the signal
    const before = c.sb.vertices().slice();
    const hit = new Set(gust(c, 9));
    check(hit.size > 8 && hit.size < c.sb.vertexCount - 8, `${hit.size} of ${c.sb.vertexCount} kicked`);
    advanceTime(50);                       // before momentum crosses the rigid edges
    const after = c.sb.vertices(), pins = new Set(pinIndices('corners'));
    const mean = (pred) => {
        let s = 0, n = 0;
        for (let i = 0; i < c.sb.vertexCount; i++) {
            if (!pred(i)) continue;
            s += Math.hypot(after[i * 3] - before[i * 3], after[i * 3 + 1] - before[i * 3 + 1], after[i * 3 + 2] - before[i * 3 + 2]);
            n++;
        }
        return n ? s / n : 0;
    };
    const dHit = mean((i) => hit.has(i)), dRest = mean((i) => !hit.has(i) && !pins.has(i));
    log(`kicked region ${dHit.toFixed(3)} m, untouched half ${dRest.toFixed(3)} m`);
    check(dHit > dRest * 3 && dHit > 0.1, 'targeted region displaced far more');
});

test('pressurized ball: pressure raises rebound; setVertex dents and recovers', () => {
    reset();
    const rebound = (pressure) => {
        destroySoft('ball');
        const b = buildBall(pressure, { position: { x: 15, y: 6, z: 0 } });
        let apex = 0;
        for (let i = 0; i < 190; i++) { advanceTime(16); if (i > 85) apex = Math.max(apex, meanHeight(b)); }
        return apex;
    };
    const limp = rebound(300), firm = rebound(6000);
    log(`apex ${limp.toFixed(3)} m at p=300 vs ${firm.toFixed(3)} m at p=6000`);
    check(firm > limp * 1.25 && firm - limp > 0.15, 'pressure increases rebound');

    const b = buildBall(3000, { position: { x: 15, y: 6, z: 0 } });
    advanceTime(1600);
    const cap = poke(b, 0);
    const r0 = regionRadius(b, cap);
    const dented = poke(b, 0.35);
    const r1 = regionRadius(b, dented);
    log(`${dented.length} vertices pushed in; cap radius ${r0.toFixed(3)} -> ${r1.toFixed(3)} m`);
    check(dented.length > 4 && r0 - r1 > 0.15, 'poke dents a cap');
    advanceTime(800);
    log(`recovered to ${regionRadius(b, dented).toFixed(3)} m`);
    check(regionRadius(b, dented) > r1 + 0.05, 'dent recovers under pressure');
});

test('soft panel: pin row rebuilds the cloth, pressure slider rebuilds the ball', () => {
    reset();
    clickOn('#tabs [data-tab="bodies"]');
    clickOn('#pinRow [data-value="edge"]');
    check(softBodies.get('cloth').meta.pinSet === 'edge', 'pin row');
    check(/one edge|edge/.test(document.querySelector('#pinHint').textContent), 'pin hint names the set');
    ui.setPressure(4000);
    check(softBodies.get('ball').meta.pressure === 4000, 'pressure setter rebuilds the ball');
    clickOn('#btnSoftClear');
    check(softBodies.size === 0, 'clear soft bodies');
    clickOn('#tabs [data-tab="sandbox"]');
});

test('clearAll sweeps ragdolls and soft bodies', () => {
    reset();
    spawnRagdoll({ x: 0, y: 4, z: 0 });
    spawnRagdoll({ x: 2, y: 5, z: 0 });
    buildCloth('corners');
    buildBall(2500);
    check(ragdollCount() === 2 && totalPartCount() === 2 * PART_NAMES.length && softBodies.size === 2, 'populated');
    clearAll();
    check(ragdollCount() === 0 && softBodies.size === 0 && bodyCount() === 0, 'swept');
});

test('screenshot: ragdolls + soft bodies', () => {
    reset();
    ui.setClothPins('corners');
    ui.setPressure(2500);
    ui.dropRagdollRain(3);
    ui.dropOntoCloth(4);
    advanceTime(2500);
    shot('bodies');
});

done('physics-playground bodies');
