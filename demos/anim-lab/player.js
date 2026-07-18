// player.js — a small facade over the skinned mesh's built-in animation player.
//
// bro has two clip systems and they are easy to confuse, so it is worth being
// explicit about which one this is:
//
//   scene.createAnimationPlayer()  animates SCENE NODE properties (position,
//                                  rotation, color, intensity, ...) from JSON
//                                  clipDefs. Cutscenes, prop rigs, lighting.
//                                  app.js uses one for the stage accent.
//   skinnedMesh.play(...)          animates BONES. The node itself owns the
//                                  player; evaluate → blend → skinning palette
//                                  all happen in C++ per frame. This is the
//                                  one a character runs on, and the one this
//                                  module wraps.
//
// The wrapper exists because the node's playback surface is spread across
// methods and properties (play/pause/resume/stop, animationTime,
// animationSpeed, animationDuration, currentAnimation, isPlaying), and both
// the HUD and the smoke test want one object with a stable shape. It adds no
// behaviour of its own beyond remembering the loop flag and speed the user
// last chose, so a later play() reuses them.

export function createPlayer(node, clips, masks) {
    const state = { loop: true, speed: 1.0, lastClip: '' };

    // Layer bookkeeping. The engine owns the layers themselves — blendState()
    // reports them and is the truth — but the HUD needs to remember the user's
    // INTENT for an inactive slot too: which clip and mask a disabled row will
    // use when it is switched back on. That is a UI concern, so it lives here
    // rather than being inferred from the engine.
    const layers = new Map();

    const facade = {
        node,
        clips,
        names: clips.names.slice(),

        /** Hard cut to a clip (or crossfade when `fade` > 0). */
        play(name, fade = 0) {
            if (!clips.animations[name]) throw new Error(`no such clip: ${name}`);
            state.lastClip = name;
            node.play(name, {
                loop: state.loop,
                speed: state.speed,
                fadeTime: fade,
            });
            return facade;
        },

        /** Blend from whatever is playing into `name` over `fade` seconds. */
        crossfadeTo(name, fade) {
            return facade.play(name, Math.max(0, fade));
        },

        pause()  { node.pause();  return facade; },

        /**
         * Resume, or start the last clip again. stop() deactivates the player
         * entirely (the mesh drops to bind pose), so there is nothing to
         * resume afterwards — replay instead.
         */
        resume() {
            if (node.currentAnimation) node.resume();
            else if (state.lastClip)   facade.play(state.lastClip);
            return facade;
        },

        /** Fade out to bind pose and deactivate the player. */
        stop(fade = 0) { node.stop({ fadeTime: fade }); return facade; },

        /** Scrub by normalized position; writes the pose immediately. */
        seekNormalized(t) {
            const d = node.animationDuration;
            if (d > 0) node.animationTime = Math.max(0, Math.min(1, t)) * d;
            return facade;
        },

        get loop()  { return state.loop; },
        set loop(v) {
            // No-op when nothing changes. This matters more than it looks:
            // the restart below is a play(), and a play() SUSPENDS the state
            // machine. The HUD pushes every default through these setters at
            // bind time, so without this guard simply wiring up the panel
            // would knock the machine out of the state it had just entered and
            // the app would open suspended.
            if (state.loop === !!v) return;
            state.loop = !!v;
            // loop is a play() option, so changing it only takes effect on the
            // next start — restart in place, preserving the playhead, so the
            // checkbox feels live rather than deferred.
            const cur = node.currentAnimation;
            if (cur) {
                const t = node.animationTime;
                node.play(cur, { loop: state.loop, speed: state.speed });
                node.animationTime = t;
            }
        },

        get speed()  { return state.speed; },
        set speed(v) {
            state.speed = v;
            node.animationSpeed = v;      // live-settable, no restart needed
        },

        get currentClip()    { return node.currentAnimation || ''; },
        get currentTime()    { return node.animationTime; },
        get duration()       { return node.animationDuration; },
        get playing()        { return !!node.isPlaying; },
        get normalizedTime() {
            const d = node.animationDuration;
            return d > 0 ? node.animationTime / d : 0;
        },

        /** The live blend composition — base clips, weights, layers. */
        blendState() { return node.blendState(); },

        // ── Blend spaces ─────────────────────────────────────────────────────
        //
        // A blend space is a named set of clips pinned at parameter positions;
        // one scalar (1D) or point (2D) picks the mix, and the engine blends
        // the neighbours. Crucially it is a BASE-TRACK citizen: play('speed')
        // and play('walk') are the same call, crossfade included, so a space
        // can replace a clip anywhere without the surrounding code caring.
        //
        // All three spaces are registered up front. They cost nothing while
        // not playing, and registering them together keeps the parameter
        // ranges — which the HUD's sliders have to agree with — in one place.
        defineSpaces() {
            // 1D: a pure speed axis. The positions are the speeds in m/s at
            // which each gait looks right, which is what makes the parameter
            // meaningful rather than an arbitrary 0..1 — feed it a character's
            // actual planar speed and the gait matches the ground.
            node.addBlendSpace1D('locomotion', [
                { clip: 'idle', pos: 0.0 },
                { clip: 'walk', pos: 1.6 },
                { clip: 'run',  pos: 5.0 },
            ]);

            // The crouch pair on the same axis, so switching spaces mid-stride
            // is a crossfade between two mixes rather than a pose snap.
            node.addBlendSpace1D('locomotionCrouch', [
                { clip: 'crouchIdle', pos: 0.0 },
                { clip: 'crouchWalk', pos: 1.6 },
            ]);

            // The root-motion twin of `locomotion`: same axis, same positions,
            // same gait curves — the members just carry a `root` translation
            // track as well. Keeping it a SEPARATE space (rather than swapping
            // clips inside one) is what lets the HUD toggle between travelling
            // and treadmilling with the parameter and the phase both intact:
            // the two spaces are structurally identical, so a switch mid-stride
            // lands on the same mix of the same poses.
            node.addBlendSpace1D('locomotionRM', [
                { clip: 'idle',   pos: 0.0 },
                { clip: 'walkRM', pos: 1.6 },
                { clip: 'runRM',  pos: 5.0 },
            ]);

            // 2D: the locomotion square. X is strafe (+1 = the character's
            // right), Y is forward/back. idle sits at the centre so easing off
            // the pad settles to a stand instead of marching in place.
            //
            // The 2D blend takes the THREE nearest points by inverse-squared
            // distance, so the corners of this layout are genuine three-way
            // mixes (e.g. forward-right = walk + walkStrafeR + idle) rather
            // than interpolations along an authored triangle edge. Keeping the
            // five points sparse and well separated is what keeps that stable:
            // weights jump a little whenever the nearest-3 set changes.
            node.addBlendSpace2D('directional', [
                { clip: 'idle',        pos: [ 0,  0] },
                { clip: 'walk',        pos: [ 0,  1] },
                { clip: 'walkBack',    pos: [ 0, -1] },
                { clip: 'walkStrafeL', pos: [-1,  0] },
                { clip: 'walkStrafeR', pos: [ 1,  0] },
            ]);
            return facade;
        },

        /** Make a blend space the base track (crossfading in, like any clip). */
        playSpace(name, fade = 0.25) {
            state.lastClip = name;
            node.play(name, { speed: state.speed, fadeTime: fade });
            return facade;
        },

        /**
         * Drive the 1D speed axis. Instant — the engine does no smoothing of
         * its own, deliberately, so gameplay code owns the easing. The HUD
         * slider IS the smoothing here; a real character would low-pass its
         * measured speed into this call.
         */
        setLocomotion(speed, space = 'locomotion') {
            node.setBlendPos(space, speed);
            return facade;
        },

        /** Drive the 2D directional axis. x = strafe, y = forward/back. */
        setDirection(x, y) {
            node.setBlendPos('directional', x, y);
            return facade;
        },

        // ── Layers ───────────────────────────────────────────────────────────
        //
        // Up to 8 masked tracks blend over the base in ascending slot order,
        // each independently weighted and fadeable. This is what lets the legs
        // come from a blend space while the arms come from a gesture, with no
        // special-casing on either side.

        /**
         * Start (or replace) a layer. `mask` is a preset NAME — resolving it
         * here means the HUD and the tests both talk in preset names and only
         * this module knows about Uint8Arrays.
         */
        playLayer(slot, name, mask, opts = {}) {
            if (!clips.animations[name]) throw new Error(`no such clip: ${name}`);
            layers.set(slot, { slot, name, mask, weight: opts.weight === undefined ? 1 : opts.weight });
            node.playLayer(slot, name, {
                mask: masks.get(mask),
                weight: opts.weight === undefined ? 1 : opts.weight,
                fadeTime: opts.fadeTime === undefined ? 0.2 : opts.fadeTime,
                speed: opts.speed === undefined ? 1 : opts.speed,
                loop: true,
            });
            return facade;
        },

        /** Fade a layer out and free its slot. */
        stopLayer(slot, fade = 0.2) {
            const e = layers.get(slot);
            if (e) e.active = false;
            node.stopLayer(slot, { fadeTime: fade });
            return facade;
        },

        /** Live weight for an already-running layer (throws on an empty slot). */
        setLayerWeight(slot, weight) {
            const e = layers.get(slot);
            if (e) e.weight = weight;
            node.setLayerWeight(slot, weight);
            return facade;
        },

        /** The user's remembered intent for a slot, active or not. */
        layerIntent(slot) { return layers.get(slot); },

        /** Slots the ENGINE currently reports as live. */
        activeLayers() {
            return facade.blendState().layers || [];
        },

        // ── State machine passthrough ────────────────────────────────────────
        //
        // states.js owns the graph; the facade just forwards, so the HUD and
        // the tests keep talking to one object. `travel` is deliberately NOT
        // play(): it follows an AUTHORED transition (with that transition's
        // fade and phase-sync), where play() would take the base track over
        // and suspend the machine entirely.

        travel(name)   { node.travel(name); return facade; },
        get state()    { return node.state; },

        // ── Root motion ──────────────────────────────────────────────────────
        //
        // Opt-in extraction of the root bone's authored displacement. With it
        // ON the engine removes that displacement from the pose (so the
        // character animates in place) and accumulates it for the app, which
        // moves the NODE — animation stays the source of truth for distance.
        // With it OFF the displacement stays in the pose and the mesh would
        // slide away from its node, which is why the in-place clips (`walk`,
        // `run`) and the travelling ones (`walkRM`, `runRM`) are separate: the
        // toggle swaps which blend space is playing, not just this flag.

        /**
         * Enable/disable extraction. `bone: 'root'` is explicit rather than
         * relying on auto-detect — it is the parentless bone auto-detect would
         * pick anyway, and naming it documents which bone the clips author.
         * extractY stays false so the jump's vertical arc renders as authored.
         */
        setRootMotion(on) {
            node.setRootMotion({ enabled: !!on, bone: 'root', extractY: false });
            return facade;
        },

        /**
         * Drain the accumulated delta and apply it to the node.
         *
         * The delta is MODEL space, so it is rotated by the heading the app
         * owns before being added to the node position — that is the seam
         * where a turn clip's yaw would steer a character. Here the heading
         * stays 0 (the rig faces +Z and the marker run is down +Z), but the
         * rotation is written out rather than assumed so the wiring is the
         * real one.
         *
         * Returns the world-space distance travelled this call, which is what
         * the HUD's odometer sums.
         */
        pumpRootMotion(heading = 0) {
            const d = node.consumeRootMotion();
            if (!d) return 0;
            const [dx, dy, dz] = d.translation;
            const c = Math.cos(heading), s = Math.sin(heading);
            const wx = c * dx + s * dz;
            const wz = -s * dx + c * dz;
            const p = node.position;
            node.position = [p[0] + wx, p[1] + dy, p[2] + wz];
            return Math.hypot(wx, wz);
        },

        /** Park the character back at the origin (the odometer's zero). */
        resetTransform() {
            node.position = [0, 0, 0];
            node.quaternion = [0, 0, 0, 1];
            // Drain whatever accumulated during the frames before the reset,
            // or the next pump would teleport the character back out again.
            node.consumeRootMotion();
            return facade;
        },
    };

    return facade;
}
