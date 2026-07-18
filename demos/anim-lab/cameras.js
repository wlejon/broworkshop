// cameras.js — camera NODES, which are a different thing from setCamera().
//
// Every other app in the tree drives the view imperatively: build a view
// struct each frame and hand it to `scene.setCamera(...)`. That works, but it
// means the camera is not part of the scene — it cannot be parented, it cannot
// be animated by the node-property player, and there is no object to ask
// "where is the camera?".
//
// `scene.createCamera()` makes the camera a NODE. Only the projection lives on
// it (fov / near / far / aspect); the VIEW is the node's world transform — a
// camera looks down its local -Z with local +Y up. Everything else follows
// from that one fact, and this module exists to show what follows:
//
//   orbit    a camera node driven from the shared orbit rig. Proves a node
//            camera is a drop-in for the imperative path — same controls, same
//            framing, one property write per frame instead of a view struct.
//   follow   a camera node PARENTED TO THE CHARACTER. It is never touched
//            after setup: it rides the hierarchy, so when root motion walks
//            the character down the marker run the camera goes with it, with
//            zero per-frame JS. This is the thing setCamera cannot do.
//   wide     a fixed cinematic camera, and a `createAnimationPlayer` clip that
//            dollies it and pulls its fov. That ties the two animation tiers
//            together: the node-property player animating a camera node, while
//            the skeletal player animates the character, at the same time.
//
// A precedence rule worth stating once, because getting it wrong makes camera
// nodes look broken: the LAST camera call wins. A single `scene.setCamera()`
// anywhere in the frame loop deactivates the active camera node and drops
// `scene.activeCamera` to null. So once this module is in play, the app must
// never call setCamera again — the orbit camera becomes a node too, which is
// why `orbit` exists here at all rather than staying imperative.

/**
 * @param {Object} scene
 * @param {Object} character  what buildCharacter() returned (for parenting)
 * @param {Object} orbitRig   a Camera.createOrbit() rig, for the orbit node
 */
export function createCameras(scene, character, orbitRig) {
    // --- orbit ---------------------------------------------------------------
    // Created active, so the app opens on the framing a viewer expects. The
    // orbit rig already stores its orientation as a quaternion whose -Z is
    // forward — the same convention a camera node uses — so driving this node
    // is a straight copy of `pos` and `rot`, no conversion.
    const orbit = scene.createCamera({
        name: 'orbit',
        fov: orbitRig.fov,
        near: orbitRig.near,
        far: orbitRig.far,
        position: orbitRig.pos.slice(),
        quaternion: orbitRig.rot.slice(),
        active: true,
    });

    // --- follow --------------------------------------------------------------
    // Parked behind and above the character in its LOCAL frame, then parented.
    // The rig faces +Z, so a local -Z offset puts the camera at its back
    // looking up the marker run.
    const follow = scene.createCamera({
        name: 'follow',
        fov: 52,
        near: 0.05,
        far: 300,
        position: [0, 2.05, -4.0],
    });
    character.node.add(follow);
    // lookAt writes the LOCAL rotation, compensating for ancestors — so aiming
    // it once here at the character's chest is permanent under pure
    // translation. This is the entire per-frame cost of the follow camera:
    // nothing. The node moves because its parent moves.
    follow.lookAt(0, 1.05, 0);

    // --- wide ----------------------------------------------------------------
    // Off to the side and back down the run, framing both the pad the
    // character starts on and the far markers it walks to. A narrow fov
    // compresses that distance, which is what makes progress along the markers
    // legible from a fixed viewpoint.
    const wide = scene.createCamera({
        name: 'wide',
        fov: 34,
        near: 0.1,
        far: 400,
        position: [8.5, 3.4, 13.0],
        lookAt: [0, 1.0, 5.0],
    });

    // --- the cinematic move --------------------------------------------------
    // A node-property clip over the wide camera: a slow dolly in and along,
    // with an fov pull on top. `fov` is a real animatable camera property, so
    // the zoom is data in the clip rather than a per-frame callback.
    //
    // Targets resolve by node NAME, which is why every camera above is named.
    const cinePlayer = scene.createAnimationPlayer();
    cinePlayer.addClip('cinematic', {
        duration: 12.0,
        loop: 'pingpong',
        tracks: [
            { target: 'wide', property: 'position', keys: [
                { time:  0.0, value: [ 8.5, 3.4, 13.0], ease: 'sineInOut' },
                { time:  6.0, value: [ 4.2, 2.1,  9.0], ease: 'sineInOut' },
                { time: 12.0, value: [-3.0, 1.7,  6.5] },
            ]},
            { target: 'wide', property: 'fov', keys: [
                { time:  0.0, value: 34, ease: 'sineInOut' },
                { time: 12.0, value: 52 },
            ]},
        ],
    });

    const nodes = { orbit, follow, wide };
    let cinematic = false;

    const ctl = {
        nodes,
        orbit, follow, wide,
        cinePlayer,
        names: ['orbit', 'follow', 'wide'],

        /**
         * The key of the active camera, or '' if an imperative view took over.
         *
         * Matched by node IDENTITY: `scene.activeCamera` hands back the same JS
         * object as the node it was set from, so `===` is the comparison, and a
         * camera that is not one of ours falls through to ''.
         */
        get active() {
            const a = scene.activeCamera;
            if (!a) return '';
            for (const k of ctl.names) if (nodes[k] === a) return k;
            return '';
        },

        /** True while the wide camera is being flown by its clip. */
        get cinematic() { return cinematic; },

        /** Switch views. This is the whole camera-selection surface. */
        select(key) {
            const n = nodes[key];
            if (!n) throw new Error(`no such camera: ${key}`);
            scene.setActiveCamera(n);
            return ctl;
        },

        /**
         * Start/stop the cinematic move. Stopping leaves the camera wherever
         * the clip left it rather than snapping it home — the player simply
         * stops writing — so the button reads as "hold this shot".
         */
        setCinematic(on) {
            cinematic = !!on;
            if (cinematic) cinePlayer.play('cinematic');
            else           cinePlayer.stop();
            return ctl;
        },

        /**
         * Copy the orbit rig onto its node. Called per frame from the app loop
         * — and this is the ONLY per-frame camera work in the app, however
         * many cameras exist, because the other two are either static or
         * carried by their parent.
         */
        syncOrbit() {
            orbit.position = orbitRig.pos.slice();
            orbit.quaternion = orbitRig.rot.slice();
            orbit.fov = orbitRig.fov;
            return ctl;
        },

        /** World position of the active camera — the HUD's readout. */
        activePosition() {
            const a = scene.activeCamera;
            if (!a) return null;
            const w = a.localToWorld(0, 0, 0);
            return [w.x, w.y, w.z];
        },
    };

    return ctl;
}
