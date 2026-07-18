// states.js — the animation state machine, and the parameters that drive it.
//
// This is the tier above blending. `addStateMachine` takes a graph of named
// states (each sourced from a registered clip or blend space) and named
// transitions (each carrying its own fade and phase-sync policy), and
// `travel(name)` walks it. The machine sits ON TOP of the crossfade machinery
// the rest of the app already uses — a transition IS a play() with a fade —
// so blend spaces, masked layers and blendState() all keep working unchanged
// underneath it.
//
// One thing to be clear about, because it is the most common wrong assumption:
// **bro's state machine has no condition or expression language.** There is no
// `{ condition: 'speed > 0.1' }` field. The engine owns the GRAPH — which
// transitions exist, what they fade over, whether they phase-sync, whether
// they auto-advance — and the app owns the DECISION of when to travel. That
// split is deliberate and it is why this module has two halves:
//
//   GRAPH   the addStateMachine definition below. Authored once, declarative,
//           and the thing that actually executes: fades, phase sync and the
//           one-shot auto-advance all happen in C++ with no JS involvement.
//   DRIVER  `tick()`. Reads the parameter block (speed, crouch, triggers) and
//           calls travel() when the parameters imply a different state.
//
// The driver is emphatically NOT "an if-ladder calling play()" — that is the
// thing the machine replaces. It never names a clip, never picks a fade
// duration, and never touches the base track. It names a STATE and lets the
// authored transition decide how to get there. Swap `move → moveCrouch` from a
// 0.2 s phase-synced blend to a hard cut by editing one line of the graph, and
// the driver does not change at all.

/**
 * The state graph, as data.
 *
 * `moveSource` is a parameter because the root-motion toggle swaps which
 * locomotion blend space the `move` state is sourced from — see setRootMotion
 * below for why that is a graph rebuild rather than a flag.
 */
function graphDef(moveSource, initial) {
    return {
        states: [
            // Ordinary looping clip: the neutral state everything settles to.
            { name: 'idle', source: 'idle' },

            // A blend space as a state source. `move` is a whole speed axis —
            // idle → walk → run — not a clip, and the machine does not care:
            // a state's source is anything play() would accept.
            { name: 'move', source: moveSource },

            // The crouch axis, deliberately a second space on the same
            // parameter range so the transition below can phase-sync.
            { name: 'moveCrouch', source: 'locomotionCrouch' },

            // One-shots. `loop: false` is what makes autoAdvance possible at
            // all — a looping state never ends, so it never auto-advances.
            { name: 'jump', source: 'jump', loop: false },
            { name: 'wave', source: 'wave', loop: false },
        ],
        transitions: [
            // The locomotion core. Asymmetric fades on purpose: settling to a
            // stand wants longer than breaking into a walk does.
            { from: 'idle', to: 'move',       fade: 0.25 },
            { from: 'move', to: 'idle',       fade: 0.30 },

            // Crouch. syncPhase is the whole reason `locomotionCrouch` shares
            // the speed axis with `locomotion`: both states are cycles, so the
            // incoming space starts at the outgoing one's normalized phase and
            // the character drops into a crouch mid-stride without its feet
            // jumping to a different point in the gait.
            { from: 'move',       to: 'moveCrouch', fade: 0.20, syncPhase: true },
            { from: 'moveCrouch', to: 'move',       fade: 0.20, syncPhase: true },

            // Standing up into and out of a crouch — no phase to sync, since
            // idle is a different cycle length and a different motion.
            { from: 'idle',       to: 'moveCrouch', fade: 0.25 },
            { from: 'moveCrouch', to: 'idle',       fade: 0.30 },

            // Wildcards: a jump or a wave is available from ANY state, which
            // is exactly what '*' is for. Exact from/to matches beat wildcards,
            // so adding a tuned `move → jump` later would override this one
            // without removing it.
            { from: '*', to: 'jump', fade: 0.10 },
            { from: '*', to: 'wave', fade: 0.20 },

            // Re-entry after SUSPENSION. When a manual play() has taken the
            // base track over, node.state is null and the next travel() has no
            // `from` to match — without a wildcard the engine warns and hard-
            // switches with fade 0, which is a visible snap. These three give
            // every re-entry an authored fade instead. They cost nothing
            // elsewhere: exact from/to matches always win, so the tuned
            // locomotion transitions above still take precedence.
            { from: '*', to: 'idle',       fade: 0.30 },
            { from: '*', to: 'move',       fade: 0.25 },
            { from: '*', to: 'moveCrouch', fade: 0.25 },

            // autoAdvance: the engine leaves the state by itself when the
            // non-looping source clip ends. No JS timer, no onAnimationFinished
            // handler — the graph says what happens after a jump, and the
            // graph is what runs. `jump` lands in `move`; the driver then
            // settles it to `idle` on the next tick if the speed parameter
            // says the character is standing still.
            { from: 'jump', to: 'move', fade: 0.20, autoAdvance: true },
            { from: 'wave', to: 'idle', fade: 0.25, autoAdvance: true },
        ],
        initial,
    };
}

/** The states a one-shot leaves by itself — the driver must not fight them. */
const ONE_SHOTS = new Set(['jump', 'wave']);

/** Below this speed the character is standing rather than moving. */
const MOVE_THRESHOLD = 0.05;

/**
 * Build the machine and its driver.
 *
 * @param {Object} node   the skinned mesh node (owns the machine)
 * @param {Object} player the player facade, for blend-space parameter pushes
 * @returns the controller the HUD, the frame loop and the tests all share
 */
export function createStateMachine(node, player) {
    // The parameter block. This is the machine's whole input surface: the HUD
    // writes these, the driver reads them, and nothing else decides anything.
    const params = {
        speed: 0.0,        // m/s, straight onto the locomotion axis
        crouch: false,
        rootMotion: false,
    };

    const log = [];              // scrolling transition history for the HUD
    const listeners = [];
    let last = { from: null, to: null, at: 0 };
    let pendingReturn = null;    // where a finished one-shot should go back to
    let returnTo = null;         // remembered at trigger time
    let elapsed = 0;             // seconds of virtual time, for log timestamps

    function moveSource() {
        return params.rootMotion ? 'locomotionRM' : 'locomotion';
    }

    /**
     * Install (or reinstall) the graph.
     *
     * addStateMachine REPLACES any existing machine and enters its initial
     * state immediately, so passing the state we are currently in makes the
     * rebuild a switch into itself — visually a no-op. That is what makes the
     * root-motion toggle cheap: the two locomotion spaces are structurally
     * identical (same axis, same gait curves, same member count), so re-
     * entering `move` on the other space keeps the mix the parameter asks for.
     */
    function install(initial) {
        node.addStateMachine(graphDef(moveSource(), initial || 'idle'));
        pushParams();
    }

    /**
     * Push the speed parameter onto every locomotion space.
     *
     * All three are written every tick rather than just the active one,
     * because a blend space's parameter lives on the SPACE: writing them all
     * means a transition into any of them arrives at the mix the slider
     * already shows instead of at whatever that space was last left at.
     */
    function pushParams() {
        node.setBlendPos('locomotion', params.speed);
        node.setBlendPos('locomotionRM', params.speed);
        node.setBlendPos('locomotionCrouch', params.speed);
    }

    /** Which state the parameters imply right now. */
    function desiredState() {
        if (params.speed < MOVE_THRESHOLD) {
            // A crouched stand is the crouch space at speed 0 — crouchIdle —
            // not a separate state. That is the payoff of authoring the crouch
            // pair as a space: standing and walking crouched are one state.
            return params.crouch ? 'moveCrouch' : 'idle';
        }
        return params.crouch ? 'moveCrouch' : 'move';
    }

    // onStateChanged fires after every travel AND every autoAdvance, which is
    // what makes the machine's behaviour observable rather than inferred. The
    // handler stays pure bookkeeping: travelling from inside it would re-enter
    // the machine mid-transition, so a one-shot's return trip is DEFERRED to
    // the next driver tick instead.
    node.onStateChanged = (from, to) => {
        last = { from, to, at: elapsed };
        log.push({ from, to, at: elapsed });
        if (log.length > 40) log.shift();

        // A one-shot just auto-advanced out. Its authored destination is the
        // common case ('jump' → 'move'); if the character was somewhere else
        // when it started, send it back there.
        if (ONE_SHOTS.has(from) && returnTo && returnTo !== to) {
            pendingReturn = returnTo;
        }
        if (ONE_SHOTS.has(from)) returnTo = null;

        for (const fn of listeners) fn(from, to);
    };

    const ctl = {
        params,
        log,
        get state()      { return node.state; },
        get lastChange() { return last; },
        get names()      { return graphDef(moveSource(), 'idle').states.map((s) => s.name); },
        get transitions() { return graphDef(moveSource(), 'idle').transitions; },

        /** Subscribe to transitions (the HUD's log and the tests use this). */
        onChange(fn) { listeners.push(fn); return ctl; },

        /**
         * The driver. Called once per frame from the app's loop.
         *
         * Order matters: parameters first (so a transition starting this tick
         * lands on the current mix), then the deferred return trip, then
         * reconciliation.
         *
         * @param {number} dt seconds of scaled time since the last tick
         */
        tick(dt = 0) {
            elapsed += dt;

            // SUSPENSION. A manual play() or stop() — the clip grid, the
            // crossfade button, the blend-space selector — takes the base
            // track over and drops node.state to null. The graph definition
            // survives, but the app is driving directly and the machine must
            // stay COMPLETELY out of the way: not just travelling (which would
            // yank the base track back on the very next frame and make the
            // clip buttons look broken) but writing blend-space parameters
            // too. The machine's speed parameter and the HUD's raw axis slider
            // address the same space, and whichever one is in charge has to be
            // the only writer. Re-entry is explicit (any travel(), or
            // resume()).
            if (node.state === null) return ctl;

            pushParams();

            if (pendingReturn) {
                const want = pendingReturn;
                pendingReturn = null;
                if (node.state !== want) node.travel(want);
                return ctl;
            }

            // While a one-shot is running the graph is in charge: the driver
            // must not yank the character out of a jump because the speed
            // slider moved. autoAdvance will hand control back.
            if (ONE_SHOTS.has(node.state)) return ctl;

            const want = desiredState();
            if (node.state !== want) node.travel(want);
            return ctl;
        },

        /** Manual travel — the HUD's per-state buttons. */
        travel(name) {
            if (ONE_SHOTS.has(name)) returnTo = node.state;
            node.travel(name);
            return ctl;
        },

        /**
         * Fire a one-shot and remember where to come back to. The graph's
         * wildcard transition means this works from any state, including from
         * the other one-shot.
         */
        trigger(name) {
            returnTo = ONE_SHOTS.has(node.state) ? returnTo : node.state;
            node.travel(name);
            return ctl;
        },

        setSpeed(v)  { params.speed = v; pushParams(); return ctl; },
        setCrouch(v) { params.crouch = !!v; return ctl; },

        /**
         * Swap the character between treadmilling and travelling.
         *
         * This rebuilds the graph because a state's source is fixed at
         * definition time — `move` cannot point at two spaces at once. The
         * rebuild re-enters the current state, so the only visible change is
         * that the gait's authored displacement starts being extracted.
         */
        setRootMotion(on) {
            if (params.rootMotion === !!on) return ctl;
            params.rootMotion = !!on;
            const here = node.state;
            player.setRootMotion(params.rootMotion);
            install(here || 'idle');
            log.push({ from: here, to: here, at: elapsed,
                       note: params.rootMotion ? 'root motion ON' : 'root motion OFF' });
            return ctl;
        },

        /** Re-enter the graph after a manual play() suspended the machine. */
        resume() {
            if (node.state === null) node.travel(desiredState());
            return ctl;
        },

        install,
    };

    install('idle');
    return ctl;
}
