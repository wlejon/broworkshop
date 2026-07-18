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

export function createPlayer(node, clips) {
    const state = { loop: true, speed: 1.0, lastClip: '' };

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
    };

    return facade;
}

// CHUNK 2: blend-space control belongs on this facade —
// `setLocomotion(speed)` wrapping node.setBlendPos('locomotion', speed), and
// `playLayer(slot, name, mask)` wrapping the layer API, so the HUD keeps
// talking to one object.
// CHUNK 3: `travel(state)` wrapping node.travel(), plus a consumeRootMotion()
// pump that moves the node — both belong here for the same reason.
