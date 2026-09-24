// sim/world.js — builds the three bays and runs their per-frame work.
//
//   z = 0    the sandbox: material lanes, spawning, areas, layers, ragdolls,
//            soft bodies                          (stage, spawn, areas, ...)
//   z = -18  the machine yard: SixDOF machines and the mechanism bench
//   z = +18  the breakyard: a bridge of breakable joints
//
// Rigid bodies need no per-frame JS: a PhysicsNode syncs from its body every
// frame (honouring Physics.setInterpolation), ragdoll parts included. What
// does tick is what has no single transform or needs re-issuing: kinematic
// pose drive, soft-body vertex streams, the turret's aim, ropes and cables,
// and the drained event streams.

import "./layers.js";         // first: createBody resolves layer names against it
import { physicsEvents } from "/lib/kit/physics3d.js";
import { ctx } from "./ctx.js";
import { buildStage, stage } from "./stage.js";
import { buildAreas } from "./areas.js";
import { bodies, onClearAll } from "./spawn.js";
import { updateRagdolls, clearRagdolls } from "./ragdolls.js";
import { updateSoftBodies, clearSoftBodies } from "./softbody.js";
import { buildMachines, updateMachines, clearMachineDebris } from "./machines.js";
import { buildBench, updateBench } from "./bench.js";
import { buildBridge, noteBroken, rebuildBridge } from "./bridge.js";
import { initContacts, consume, updateContacts, clearContacts, setFocus } from "./contacts.js";

/**
 * The one drain of Physics.getContacts / getBrokenConstraints. Anything else
 * that wants the streams (a test, a new panel) subscribes here; calling the
 * getters directly would steal events from the bridge and the contact viewer.
 */
export const events = physicsEvents();

export function buildWorld(scene) {
    ctx.scene = scene;
    buildStage();
    buildAreas();
    initContacts();
    buildMachines();
    buildBench();
    buildBridge();

    events.onBroken((handles) => noteBroken(handles));
    events.onContacts((list) => consume(list, (tag) => bodies.has(tag)));

    // "Clear all" sweeps everything the user and the machines PRODUCED. The
    // machines, lanes and bench are fixtures (deleting them would leave a panel
    // of dead handles); the bridge is rebuilt, so clear also undoes the damage.
    onClearAll(clearRagdolls);
    onClearAll(clearSoftBodies);
    onClearAll(clearMachineDebris);
    onClearAll(rebuildBridge);
    onClearAll(() => { clearContacts(); setFocus(null); });
    return stage;
}

export function stepWorld(dt) {
    updateRagdolls(dt);
    updateSoftBodies();
    updateMachines(dt);
    updateBench();
    events.pump();
    updateContacts(dt);
}
