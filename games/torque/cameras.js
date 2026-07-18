// cameras.js — camera NODES, not an imperative view.
//
// scene.createCamera() makes a camera a real node in the graph: only the
// projection lives on it, and the VIEW is its world transform. That has one
// consequence this app is built to show — parent a camera under the car's
// PhysicsNode and it rides the hierarchy with zero per-frame JS. The chase and
// bonnet cameras below are positioned ONCE at construction and never touched
// again; every metre they move is the scene graph, not us.
//
// A camera node looks down its own local -Z with local +Y up. The car's
// chassis-local forward is +Z, so any camera meant to look where the car is
// going needs a 180° yaw — that is what the quaternions here are.
//
// The trackside camera is the deliberate contrast: it is a root-level node, so
// it does NOT ride anything, and it has to be aimed at the car by hand each
// frame with node.lookAt(). Two mechanisms, side by side, switchable live.
//
// With a garage in front of it (chunk 2) the parented pair also has to MOVE
// between chassis nodes — and each vehicle wants a different rig, because a
// chase distance that frames a motorcycle puts a tank's own hull across the
// whole screen. attachTo() does both at once: re-parent, then re-place. It is
// still a one-shot placement — nothing here runs per frame.

/** Hamilton product, [x,y,z,w]. */
function qmul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
const qYaw = (deg) => {
    const h = deg * Math.PI / 360;
    return [0, Math.sin(h), 0, Math.cos(h)];
};
const qPitch = (deg) => {
    const h = deg * Math.PI / 360;
    return [Math.sin(h), 0, 0, Math.cos(h)];
};
/** Yaw about parent +Y, then pitch about the resulting local X. */
const qYawPitch = (yawDeg, pitchDeg) => qmul(qYaw(yawDeg), qPitch(pitchDeg));

/**
 * @param {Object} scene
 * @param {Object} vehicle  the vehicle to start on — cameras parent under its
 *                          chassisNode and take its camRig
 * @param {Object} track    track handle, for placing the fixed camera
 */
export function createCameras(scene, vehicle, track) {
    // Chase: behind and above the vehicle, nose-down a little. Parented — this
    // is the whole demonstration, so resist any urge to nudge it per frame.
    const chase = scene.createCamera({
        name: 'chase',
        fov: 62, near: 0.2, far: 900,
    });

    // Bonnet: driver's eyeline, just ahead of the windscreen. Also parented,
    // so it inherits the chassis' roll — which is exactly what makes a banked
    // corner read as banked, and what makes the bike's lean angle visceral.
    const bonnet = scene.createCamera({
        name: 'bonnet',
        fov: 74, near: 0.12, far: 900,
    });

    // Which chassis the parented pair currently hangs off. A camera can only
    // have one parent, so switching vehicles means removing before adding —
    // add() alone would leave the node listed under the vehicle you just left.
    let mount = null;

    /**
     * Re-parent the chase and bonnet cameras onto a vehicle and place them
     * using that vehicle's own rig. Called once at startup and again on every
     * vehicle switch (and after a tire-preset rebuild, which replaces the car's
     * chassis node underneath us).
     *
     * @param {Object} v  vehicle handle — needs .chassisNode and .camRig
     */
    /**
     * Let go of the current chassis. Must be called BEFORE anything destroys
     * that node — a destroyed SceneNode cannot be removed from, so re-parenting
     * after the fact throws. The car's tire-preset rebuild is exactly that case.
     */
    function detach() {
        if (!mount) return;
        mount.remove(chase);
        mount.remove(bonnet);
        mount = null;
    }

    function attachTo(v) {
        const rig = v.camRig;
        detach();
        mount = v.chassisNode;
        mount.add(chase);
        mount.add(bonnet);
        // A camera node looks down its own local -Z, and every chassis here has
        // local +Z forward, so the 180° yaw is what points it down the road.
        chase.position = rig.chase;
        chase.quaternion = qYawPitch(180, rig.chasePitch);
        bonnet.position = rig.bonnet;
        bonnet.quaternion = qYawPitch(180, rig.bonnetPitch);
    }

    attachTo(vehicle);

    // Trackside: a fixed marshal's post overlooking the flat corner, high
    // enough to see the entry and exit. Root-level and hand-aimed.
    const post = track.edge(Math.round(track.N * 0.36),
                        -(track.HALF_WIDTH + track.RUNOFF + 14));
    const trackside = scene.createCamera({
        name: 'trackside',
        fov: 34, near: 0.5, far: 1200,
        position: [post.x, post.y + 9.5, post.z],
    });

    const list = [chase, bonnet, trackside];
    const labels = { chase: 'Chase', bonnet: 'Bonnet', trackside: 'Trackside' };
    let active = 0;
    scene.setActiveCamera(chase);

    function select(i) {
        active = ((i % list.length) + list.length) % list.length;
        scene.setActiveCamera(list[active]);
        return list[active];
    }

    /**
     * Per-frame work. Only the trackside camera needs any: the parented ones
     * are already correct because the scene graph moved them.
     */
    function update(carWorldPos) {
        if (list[active] === trackside) {
            trackside.lookAt(carWorldPos.x, carWorldPos.y, carWorldPos.z);
        }
    }

    return {
        chase, bonnet, trackside, list, update, select, attachTo, detach,
        get mount() { return mount; },
        get activeIndex() { return active; },
        get activeName() { return list[active].name; },
        label: (i) => labels[list[i].name],
        cycle: () => select(active + 1),
        /** Which camera the SCENE thinks is active — compare by name, never ===. */
        sceneActiveName: () => (scene.activeCamera ? scene.activeCamera.name : null),
    };
}
