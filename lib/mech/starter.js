// lib/mech/starter.js — a complete biped to start from: fifty metres, a fusion
// core in the chest, lift turbofans in nacelles at its hips, two more on its
// back to push it forward, dash rockets in its calves, guns in its forearms. Every part of it is an ordinary edit away from being
// something else.

import { norm } from "./vec.js";
import { emptyDesign, makeSegment, addModule } from "./design.js";
import { FACES, faceName, segMap } from "./skeleton.js";
import { settle } from "./evaluate.js";

/** The face of a segment that looks `name`-ward on the standing machine ('front', 'back', 'top', 'bottom', 'right', 'left'). */
export function faceToward(seg, name) {
    return FACES.find((f) => faceName(seg, f, 1) === name) || '+v';
}

export function starterBiped() {
    const d = emptyDesign('Type 0');
    const S = (o) => { const s = makeSegment(o); d.segments.push(s); return s; };

    // Half extents are chosen so each bay is whole cells at its narrow end
    // (a half extent of 0.4 + 0.75 n gives n cells).
    S({ id: 'pelvis', name: 'Pelvis', role: 'pelvis', bone: [0, 1, 0], len: 5, back: 3.5, hu: [6.4, 6.8], hw: [4.4, 4.8], paint: 'secondary', plate: 0.035 });
    S({ id: 'torso', name: 'Torso', role: 'torso', parent: 'pelvis', attach: [0, 5.6, 0], bone: [0, 1, 0], len: 15, back: 0.4,
        hu: [6.4, 8.6], hw: [4.9, 5.6], plate: 0.045,
        joint: { type: 'hinge', axis: [0, 1, 0], range: [-70, 70], act: 'electric', rating: 80 } });
    S({ id: 'head', name: 'Head', role: 'head', parent: 'torso', attach: [0, 15.4, -1.6], bone: [0, 1, 0], len: 4.4, back: 0,
        hu: [2.4, 2.0], hw: [2.6, 2.3], paint: 'secondary', plate: 0.04,
        joint: { type: 'ball', range: [-60, 60], act: 'electric', rating: 6 } });
    S({ id: 'pack', name: 'Backpack', role: 'pod', parent: 'torso', attach: [0, 3.6, 8.2], bone: [0, 1, 0], len: 10.4, back: 0,
        hu: [6.6, 6.6], hw: [2.7, 2.7], paint: 'secondary', plate: 0.02, joint: { type: 'fixed' } });
    S({ id: 'arm', name: 'Upper arm', role: 'arm', parent: 'torso', mirror: true, attach: [11.2, 12.6, 0], bone: [0, -1, 0], len: 9.6, back: 1.6,
        hu: [2.5, 2.3], hw: [2.6, 2.3], plate: 0.025,
        joint: { type: 'ball', range: [-150, 60], act: 'hydraulic', rating: 80 } });
    S({ id: 'forearm', name: 'Forearm', role: 'forearm', parent: 'arm', attach: [0, -10.4, 0], bone: norm([0, -0.22, -1]), len: 10.6, back: 1.4,
        hu: [2.3, 2.0], hw: [2.3, 2.0], paint: 'secondary', plate: 0.025,
        joint: { type: 'hinge', axis: [1, 0, 0], range: [-10, 130], act: 'hydraulic', rating: 50 } });
    S({ id: 'nacelle', name: 'Lift nacelle', role: 'pod', parent: 'pelvis', mirror: true, attach: [9.9, 4.4, 0.3], bone: [0, -1, 0], len: 9.4, back: 0,
        hu: [2.7, 2.7], hw: [3.4, 3.4], plate: 0.02, joint: { type: 'fixed' } });
    S({ id: 'thigh', name: 'Thigh', role: 'thigh', parent: 'pelvis', mirror: true, attach: [4.6, -1.4, 0], bone: [0, -1, 0], len: 12.0, back: 1.8,
        hu: [3.3, 2.7], hw: [3.3, 2.8], plate: 0.03,
        joint: { type: 'ball', range: [-110, 50], act: 'hydraulic', rating: 300 } });
    S({ id: 'shin', name: 'Shin', role: 'shin', parent: 'thigh', attach: [0, -12.6, 0], bone: [0, -1, 0], len: 10.8, back: 1.6,
        hu: [2.9, 2.7], hw: [3.2, 2.7], paint: 'secondary', plate: 0.03,
        joint: { type: 'hinge', axis: [1, 0, 0], range: [0, 140], act: 'hydraulic', rating: 300, bend: 1 } });
    S({ id: 'foot', name: 'Foot', role: 'foot', parent: 'shin', attach: [0, -11.6, 0], bone: [0, 0, -1], len: 7.6, back: 4.4,
        hu: [3.3, 2.9], hw: [1.5, 1.2], off: [0, -1.6], plate: 0.04,
        joint: { type: 'ball', range: [-45, 45], act: 'hydraulic', rating: 150 } });

    const seg = segMap(d);
    const put = (segId, type, size, hint, toward, opts) => {
        const face = toward ? faceToward(seg[segId], toward) : undefined;
        const m = addModule(d, segId, type, { size, hint, face, opts });
        if (!m) throw new Error(`starter: no room for ${type} in ${segId}`);
        return m;
    };

    // Chest: the core low and central, the pilot above and behind it, heat out through the sides.
    put('torso', 'reactor.fusion', [4, 3, 3], [0.5, 0.3, 0.45]);
    put('torso', 'cockpit', [2, 2, 2], [0.5, 0.72, 0.5]);
    put('torso', 'computer', [2, 1, 2], [0.5, 0.92, 0.5]);
    put('torso', 'sink', [1, 3, 2], [0.2, 0.3, 0.5]);
    put('torso', 'sink', [1, 3, 2], [0.8, 0.3, 0.5]);
    put('torso', 'cap', [2, 1, 2], [0.5, 0.05, 0.5]);
    put('torso', 'radiator', [1, 5, 2], [0.0, 0.6, 0.5], 'left');
    put('torso', 'radiator', [1, 5, 2], [1.0, 0.6, 0.5], 'right');
    put('torso', 'beam.laser', [1, 1, 2], [0.3, 0.6, 0], 'front');
    put('torso', 'beam.laser', [1, 1, 2], [0.7, 0.6, 0], 'front');
    put('torso', 'rack.missile', [3, 1, 2], [0.2, 1, 0.4], 'top');
    put('torso', 'rack.missile', [3, 1, 2], [0.8, 1, 0.4], 'top');

    put('head', 'sensor', [2, 1, 1], [0.5, 0.7, 0], 'front');
    put('head', 'computer', [2, 1, 1], [0.5, 0.2, 1]);

    // Hips: the lift engines, either side of the centre of mass so they hold it level.
    put('nacelle', 'jet.turbofan', [3, 5, 4], [0.5, 1, 0.5], 'bottom', { gimbal: 12 });

    // Back: two engines pushing forward at the height of the centre of mass, fuel between and above them.
    put('pack', 'jet.turbofan', [3, 3, 3], [0.1, 0.2, 1], 'back', { gimbal: 15 });
    put('pack', 'jet.turbofan', [3, 3, 3], [0.9, 0.2, 1], 'back', { gimbal: 15 });
    put('pack', 'tank', [2, 5, 3], [0.5, 0.4, 0.5]);
    put('pack', 'tank', [3, 3, 2], [0.1, 1, 0.3]);
    put('pack', 'tank', [3, 3, 2], [0.9, 1, 0.3]);
    put('pack', 'radiator', [3, 3, 1], [0.1, 1, 1], 'back');
    put('pack', 'radiator', [3, 3, 1], [0.9, 1, 1], 'back');

    put('pelvis', 'gyro', [2, 2, 2], [0.5, 0.5, 0.5]);
    put('pelvis', 'tank', [2, 3, 3], [0.15, 0.5, 0.5]);
    put('pelvis', 'tank', [2, 3, 3], [0.85, 0.5, 0.5]);
    put('pelvis', 'reactor.fission', [2, 2, 2], [0.5, 0.5, 0.1]);

    put('arm', 'ammo', [2, 3, 2], [0.5, 0.5, 0.5]);
    put('forearm', 'gun.autocannon', [2, 6, 2], [0.5, 1, 0.5], 'front');

    put('thigh', 'tank', [2, 3, 2], [0.3, 0.3, 0.5]);
    put('thigh', 'radiator', [1, 4, 2], [1, 0.4, 0.5], 'right');
    put('shin', 'jet.rocket', [1, 2, 1], [0.5, 0.8, 0], 'back', { gimbal: 6 });
    put('shin', 'sink', [2, 2, 1], [0.5, 0.3, 0.5]);

    return settle(d);
}
