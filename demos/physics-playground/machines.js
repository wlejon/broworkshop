// machines.js — powered joints. SixDOF constraints, motors, and the four
// exotic joint types no broworkshop app has ever used.
//
// A constraint on its own is boring: two bodies stay near each other, film at
// eleven. What makes Jolt's joint layer worth a demo is that a SixDOF
// constraint is really SIX independent switches — three translations, three
// rotations — each of which can be locked solid, left free, or limited to a
// range, and each of which can carry a MOTOR that drives it to a target
// position or velocity. That is not a joint, that is a machine tool. So this
// module builds machines rather than joints:
//
//   crane   a slewing mast (rotationY free + velocity motor) carrying a winch
//           (translationY limited + position motor). Two motorised axes on two
//           chained constraints, and the hook's cable is drawn so the winch
//           travel is legible.
//   piston  a platform on a single limited translationY with a position motor.
//           The purest form: one axis, one target, and the motor holds a loaded
//           platform against gravity indefinitely.
//   turret  rotationY + rotationZ position motors re-targeted every frame at a
//           moving object. The demo's proof that motors are a control surface
//           and not just a setup-time flourish.
//
// The axis grid in the HUD is the point of all three. Every axis of every
// machine is switchable between locked / limited / free live, and the machine's
// behaviour changes underneath you. Jolt has no runtime axis reconfiguration —
// the DoF layout is baked into the constraint at construction — so flipping an
// axis destroys and rebuilds the constraint from the machine's own spec. That
// is a genuine engine constraint, not a shortcut; the bodies are untouched and
// the rebuild is invisible at 60 Hz.
//
// The mechanism bench is the other half. `gear`, `rackAndPinion` and `pulley`
// all exist in bro's binding layer and nothing in broworkshop had ever called
// them. All three work exactly as documented (measured — see tests):
//
//   gear           couples two EXISTING hinge handles. Measured on the steady
//                  state, rate(A)/rate(B) == ratio to four decimal places.
//   rackAndPinion  couples a pinion hinge to a rack slider; drive the pinion
//                  and the rack translates.
//   pulley         one rope over two fixed pivots; the heavy side descends and
//                  hauls the light side up.
//
// Note the shape of the gear/rack API: they do NOT take pivots and axes and
// build their own joints. They take the HANDLES of two constraints you already
// made and couple those constraints' driven axes together. Get that backwards
// and nothing happens and nothing complains.

// The machine yard sits behind the -Z perimeter wall, on its own pad, so a
// hundred raining boxes in the main sandbox never land in the gears.
export const YARD_Z = -18;
const PAD_Y = 0;

let scene = null;

/** key -> machine entry. See buildMachines() for the shape. */
export const machines = new Map();
/** Bodies spawned BY machines (payloads, shells, riders) — cleared with the sandbox. */
export const machineDebris = new Map();   // tag -> { tag, node }

/** Mechanism bench entries (gear train, rack, pulley) — no sixdof, no axis grid. */
export const mechanisms = new Map();

export const AXIS_NAMES = [
    'translationX', 'translationY', 'translationZ',
    'rotationX', 'rotationY', 'rotationZ',
];
export const AXIS_MODES = ['locked', 'limited', 'free'];

// Per-axis indicator colour. X/Y/Z is the universal gizmo convention and the
// demo leans on it hard — the axis bars at each pivot are the only way to read
// a machine's DoF layout without opening the HUD.
const AXIS_COLOR = { X: '#ff5a5a', Y: '#7bed9f', Z: '#5aa9ff' };

// Where a machine's axis cluster is drawn relative to its pivot. -Z is the
// side the yard's camera views from, so the gizmo sits between the viewer and
// the machine rather than inside it.
const INDICATOR_OFFSET = { x: 0, y: 0.6, z: -2.8 };

// --- Small vector/quaternion helpers ----------------------------------------
// Same reasoning as ragdoll.js: Physics speaks {x,y,z,w} and Camera's helpers
// are camera-shaped, so four local functions beat an adapter.

const v = (x, y, z) => ({ x, y, z });
const qaxis = (ax, ay, az, a) => {
    const s = Math.sin(a / 2);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(a / 2) };
};

/** Shortest quaternion rotating +Y onto the unit vector d. Cylinders bind +Y. */
function quatYTo(d) {
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const x = d.x / len, y = d.y / len, z = d.z / len;
    if (y > 0.999999) return [0, 0, 0, 1];
    if (y < -0.999999) return [1, 0, 0, 0];          // 180 deg about X
    // axis = (0,1,0) x d, angle = acos(y)
    const ax = z, az = -x;                            // cross((0,1,0), d)
    const al = Math.hypot(ax, az) || 1;
    const half = Math.acos(Math.max(-1, Math.min(1, y))) / 2;
    const s = Math.sin(half);
    return [(ax / al) * s, 0, (az / al) * s, Math.cos(half)];
}

// --- Rod visuals -------------------------------------------------------------
//
// The scene graph has no line primitive, so every "line" in this module is a
// thin cylinder re-posed each frame. Cheap enough at the handful we draw, and
// unlike a screen-space overlay it occludes correctly against the machines.

/**
 * A repositionable thin cylinder spanning two world points. Used for winch
 * cables, pulley ropes and the contact-normal quills in contacts.js.
 */
export function makeRod(sc, color, radius = 0.035, emissive = 0) {
    const mesh = sc.createMesh({
        mesh: 'cylinder', radius, halfHeight: 0.5, segments: 8,
        color, roughness: 0.7,
        ...(emissive ? { emissive, emissiveColor: color } : {}),
    });
    return {
        mesh,
        /** Span a..b. Scaling only Y keeps the rod's cross-section constant. */
        set(a, b) {
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
            const len = Math.hypot(dx, dy, dz);
            mesh.x = (a.x + b.x) / 2; mesh.y = (a.y + b.y) / 2; mesh.z = (a.z + b.z) / 2;
            mesh.quaternion = quatYTo(v(dx, dy, dz));
            mesh.scaleY = Math.max(1e-3, len);        // halfHeight 0.5 -> unit length
            mesh.visible = true;
        },
        set visible(on) { mesh.visible = on; },
        destroy() { mesh.destroy(); },
    };
}

// --- Axis indicators ---------------------------------------------------------
//
// Three bars at a machine's pivot, one per axis, drawn so the DoF layout reads
// at a glance:
//   locked   short dark stub
//   limited  medium bar in the axis colour
//   free     long bright emissive bar
// A rotation axis gets a ring of four pips around it so it is distinguishable
// from the translation bar sharing the same colour.
//
// A mode change is not just a recolour: bar length, radius, emissive and the
// presence of the rotation pip collar all move with it, and `emissiveColor` is
// a construction-time field. So the indicator set is destroyed and rebuilt when
// the axis config changes. Config changes come from HUD clicks, so that is free.

function buildIndicators(m) {
    for (const n of m.indicatorNodes) n.destroy();
    m.indicatorNodes = [];
    if (!m.showAxes) return;

    // Drawn beside the machine, not AT its pivot. Every one of these pivots is
    // inside the body it constrains — the crane's slew point is in the middle
    // of the mast, the piston's is inside the platform — so an indicator drawn
    // honestly at the pivot is completely hidden inside solid geometry. The
    // cluster is offset toward the yard's viewing side and tied back to the
    // real pivot with a faint leader, which keeps it readable without lying
    // about where the joint is.
    const off = m.indicatorOffset || INDICATOR_OFFSET;
    const p = v(m.pivot.x + off.x, m.pivot.y + off.y, m.pivot.z + off.z);
    const dirs = { X: v(1, 0, 0), Y: v(0, 1, 0), Z: v(0, 0, 1) };

    // Leader back to the true pivot, plus a pip marking it.
    const leader = makeRod(scene, '#3a4048', 0.015);
    leader.set(p, m.pivot);
    m.indicatorNodes.push(leader.mesh);
    const anchor = scene.createMesh({
        mesh: 'sphere', radius: 0.07, segments: 8, rings: 6,
        x: m.pivot.x, y: m.pivot.y, z: m.pivot.z,
        color: '#ffffff', emissive: 1.2, emissiveColor: '#ffffff', roughness: 1,
    });
    m.indicatorNodes.push(anchor);

    for (const letter of ['X', 'Y', 'Z']) {
        for (const kind of ['translation', 'rotation']) {
            const mode = modeOf(m.axes[kind + letter]);
            const d = dirs[letter];
            const isRot = kind === 'rotation';
            // Rotation bars are drawn on the negative side of the pivot so the
            // two families never overlap on the same axis line.
            const sign = isRot ? -1 : 1;
            const len = mode === 'locked' ? 0.35 : mode === 'limited' ? 0.8 : 1.4;
            const rad = mode === 'locked' ? 0.045 : 0.06;
            const color = mode === 'locked' ? '#4a4e56' : AXIS_COLOR[letter];
            const bar = scene.createMesh({
                mesh: 'cylinder', radius: rad, halfHeight: len / 2, segments: 10,
                color, roughness: 0.5,
                ...(mode === 'free' ? { emissive: 2.2, emissiveColor: color } : {}),
            });
            bar.x = p.x + d.x * sign * len / 2;
            bar.y = p.y + d.y * sign * len / 2;
            bar.z = p.z + d.z * sign * len / 2;
            bar.quaternion = quatYTo(v(d.x * sign, d.y * sign, d.z * sign));
            m.indicatorNodes.push(bar);

            // Rotation axes get a collar of pips so the two bar families are
            // never confused for each other.
            if (isRot && mode !== 'locked') {
                for (let k = 0; k < 4; k++) {
                    const a = (k / 4) * Math.PI * 2;
                    // Build an orthonormal pair around d.
                    const u = Math.abs(d.y) > 0.5 ? v(1, 0, 0) : v(0, 1, 0);
                    const e1 = v(u.y * d.z - u.z * d.y, u.z * d.x - u.x * d.z, u.x * d.y - u.y * d.x);
                    const e2 = v(d.y * e1.z - d.z * e1.y, d.z * e1.x - d.x * e1.z, d.x * e1.y - d.y * e1.x);
                    const r = 0.28;
                    const pip = scene.createMesh({
                        mesh: 'sphere', radius: 0.045, segments: 8, rings: 6,
                        color, emissive: 1.5, emissiveColor: color, roughness: 1,
                    });
                    pip.x = p.x + (e1.x * Math.cos(a) + e2.x * Math.sin(a)) * r + d.x * sign * len * 0.55;
                    pip.y = p.y + (e1.y * Math.cos(a) + e2.y * Math.sin(a)) * r + d.y * sign * len * 0.55;
                    pip.z = p.z + (e1.z * Math.cos(a) + e2.z * Math.sin(a)) * r + d.z * sign * len * 0.55;
                    m.indicatorNodes.push(pip);
                }
            }
        }
    }
}

/** Normalise an axis spec ('locked' | 'free' | {min,max}) to a mode name. */
export function modeOf(spec) {
    if (spec === 'free') return 'free';
    if (spec && typeof spec === 'object') return 'limited';
    return 'locked';
}

// --- Constraint (re)construction ---------------------------------------------

/**
 * Build (or rebuild) a machine's SixDOF constraint from `m.axes`, then re-apply
 * every motor recorded in `m.motors`.
 *
 * Rebuilding rather than mutating is forced: Jolt bakes the DoF layout into
 * SixDOFConstraintSettings at construction and exposes no runtime setter for
 * it. The bodies survive, so a rebuild loses nothing but the solver's warm
 * start — which is a frame of softness, not a visible glitch.
 */
export function rebuildConstraint(m) {
    if (m.handle) { Physics.destroyConstraint(m.handle); m.handle = 0; }

    // Only non-locked axes go in: unlisted axes default to locked, so passing
    // the locked ones explicitly would be noise.
    const axes = {};
    for (const name of AXIS_NAMES) {
        const spec = m.axes[name];
        if (modeOf(spec) !== 'locked') axes[name] = spec;
    }

    m.handle = Physics.createConstraint({
        type: 'sixdof',
        body1: m.anchor, body2: m.body,
        point1: m.pivot, point2: m.pivot,
        axes,
    });

    for (const [axis, motor] of Object.entries(m.motors)) {
        if (!motor || motor.type === 'off') continue;
        // A motor on a locked axis is silently inert — Jolt has nothing to
        // drive — so skip it rather than pretend it took.
        if (modeOf(m.axes[axis]) === 'locked') continue;
        Physics.setConstraintMotor(m.handle, { axis, ...motor });
    }
    buildIndicators(m);
    return m.handle;
}

/**
 * Switch one axis between locked / limited / free and rebuild.
 * `limited` uses the machine's authored range for that axis, so a user who
 * frees an axis and then re-limits it gets the designed range back rather than
 * an arbitrary one.
 */
export function setAxisMode(key, axis, mode) {
    const m = machines.get(key);
    if (!m || !AXIS_NAMES.includes(axis) || !AXIS_MODES.includes(mode)) return false;
    if (mode === 'free') m.axes[axis] = 'free';
    else if (mode === 'locked') m.axes[axis] = 'locked';
    else m.axes[axis] = { ...(m.limits[axis] || { min: -1, max: 1 }) };
    rebuildConstraint(m);
    Physics.activate(m.body);
    return true;
}

/**
 * Set (or clear) a motor on one axis.
 * @param {string} key
 * @param {string} axis  - one of AXIS_NAMES
 * @param {Object} motor - { type:'position'|'velocity'|'off', target, maxForce|maxTorque, ... }
 */
export function setMotor(key, axis, motor) {
    const m = machines.get(key);
    if (!m) return false;
    m.motors[axis] = { ...motor };
    if (modeOf(m.axes[axis]) === 'locked') return false;    // inert until unlocked
    const ok = Physics.setConstraintMotor(m.handle, { axis, ...motor });
    Physics.activate(m.body);
    return ok;
}

/** Convenience: retarget an existing motor without restating its limits. */
export function setMotorTarget(key, axis, target) {
    const m = machines.get(key);
    if (!m) return false;
    const cur = m.motors[axis];
    if (!cur || cur.type === 'off') return false;
    return setMotor(key, axis, { ...cur, target });
}

// --- Machine construction ----------------------------------------------------

function addMesh(opts) { return scene.createMesh(opts); }

/**
 * The layer the mechanism bench runs on.
 *
 * `scenery` does not collide with itself (see layers.js), which is exactly what
 * a display bench needs. The rack's 4.4 m of travel carries it straight through
 * the gear train's bounding volume, and on a self-colliding layer the rack
 * shoulders the driven gear round: the measured gear ratio then comes out
 * anywhere between 0.32 and 1.96 instead of the exact value the constraint
 * actually delivers. The bench is a display, not a sandbox — its parts should
 * pass through each other and still rest on the pad, which is precisely
 * scenery's row in the matrix.
 */
const BENCH_LAYER = 'scenery';

/** A dynamic body + its PhysicsNode + a mesh, the machine-parts version of spawn(). */
function part(bodyOpts, meshFn) {
    const tag = Physics.createBody({ layer: 'player', ...bodyOpts });
    const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
    node.add(meshFn(scene));
    return { tag, node };
}

/**
 * Register a SixDOF machine.
 * @param {Object} spec { key, label, hint, anchor, body, pivot, axes, limits, motors }
 */
function addMachine(spec) {
    const t = Physics.getTransform(spec.body);
    const m = {
        indicatorNodes: [], showAxes: true, handle: 0,
        motors: {}, ...spec,
        axes: { ...spec.axes },
        limits: { ...spec.limits },
        // The as-authored layout and pose, kept so resetMachines() has
        // something to restore after the axis grid has been played with.
        authoredAxes: { ...spec.axes },
        home: { p: { ...t.position }, q: { ...t.rotation } },
    };
    machines.set(m.key, m);
    rebuildConstraint(m);
    return m;
}

export function initMachines(sc) { scene = sc; }

/**
 * Build the yard: the pad, three SixDOF machines, the collideConnected pair,
 * and the mechanism bench. Idempotent-ish — call once from app.js.
 */
export function buildMachines() {
    if (!scene) throw new Error('machines.js: initMachines(scene) not called');

    // --- The pad --------------------------------------------------------------
    Physics.createBody({
        shape: 'box', halfExtents: { x: 28, y: 0.5, z: 6 },
        position: { x: 0, y: PAD_Y - 0.5, z: YARD_Z },
        static: true, layer: 'static', friction: 0.9, restitution: 0.05,
    });
    addMesh({
        mesh: 'box', halfW: 28, halfH: 0.5, halfD: 6,
        x: 0, y: PAD_Y - 0.5, z: YARD_Z, color: '#33373d', roughness: 0.95,
    });

    buildCrane();
    buildPiston();
    buildTurret();
    buildCollidePair();
    buildGearTrain();
    buildRackAndPinion();
    buildPulley();

    return machines;
}

// --- Crane -------------------------------------------------------------------
//
// Two motorised axes on two chained constraints. The slew constraint hangs the
// mast off a static base with everything locked but rotationY; the winch
// constraint hangs the hook off the MAST — so the winch's frame slews with the
// crane for free, which is the whole reason to chain constraints rather than
// anchor both to the world.

const CRANE_X = -16;
const CRANE_MAST_Y = 3.0;
const JIB_REACH = 5.0;

function buildCrane() {
    const base = Physics.createBody({
        shape: 'box', halfExtents: { x: 0.9, y: 0.5, z: 0.9 },
        position: { x: CRANE_X, y: 0.5, z: YARD_Z }, static: true, layer: 'static',
    });
    addMesh({ mesh: 'box', halfW: 0.9, halfH: 0.5, halfD: 0.9,
        x: CRANE_X, y: 0.5, z: YARD_Z, color: '#5a6069', roughness: 0.8 });

    // Mast + jib as ONE compound body: they never move relative to each other,
    // so a joint between them would be a solver cost with no behaviour.
    const mast = part({
        shape: 'compound',
        parts: [
            { shape: 'box', halfExtents: { x: 0.32, y: 2.5, z: 0.32 }, localPosition: { x: 0, y: 0, z: 0 } },
            { shape: 'box', halfExtents: { x: 2.6, y: 0.2, z: 0.25 }, localPosition: { x: 2.4, y: 2.3, z: 0 } },
            { shape: 'box', halfExtents: { x: 1.0, y: 0.2, z: 0.25 }, localPosition: { x: -1.0, y: 2.3, z: 0 } },
        ],
        position: { x: CRANE_X, y: CRANE_MAST_Y, z: YARD_Z },
        mass: 400, friction: 0.6,
    }, (s) => {
        const root = s.createNode('crane-mast');
        root.add(s.createMesh({ mesh: 'box', halfW: 0.32, halfH: 2.5, halfD: 0.32, color: '#c9a227', roughness: 0.6 }));
        root.add(s.createMesh({ mesh: 'box', halfW: 2.6, halfH: 0.2, halfD: 0.25, x: 2.4, y: 2.3, color: '#c9a227', roughness: 0.6 }));
        root.add(s.createMesh({ mesh: 'box', halfW: 1.0, halfH: 0.2, halfD: 0.25, x: -1.0, y: 2.3, color: '#8c6f14', roughness: 0.6 }));
        return root;
    });

    const slew = addMachine({
        key: 'crane', label: 'Crane — slew',
        hint: 'rotationY free + velocity motor. Everything else locked, which is what holds a 400 kg mast upright on one joint.',
        anchor: base, body: mast.tag,
        pivot: { x: CRANE_X, y: CRANE_MAST_Y, z: YARD_Z },
        axes: { rotationY: 'free' },
        limits: { rotationY: { min: -Math.PI, max: Math.PI }, translationY: { min: -1, max: 1 } },
    });
    slew.node = mast.node;
    setMotor('crane', 'rotationY', { type: 'velocity', target: 0.0, maxTorque: 40000 });

    // Winch. The hook starts one metre under the jib tip; translationY 0 is
    // therefore "hook at the top" and the motor drives it down to -4.
    const hookTop = { x: CRANE_X + JIB_REACH, y: CRANE_MAST_Y + 2.3 - 1.0, z: YARD_Z };
    const hook = part({
        shape: 'box', halfExtents: { x: 0.35, y: 0.35, z: 0.35 },
        position: hookTop, mass: 60, friction: 1.2, restitution: 0.05,
    }, (s) => s.createMesh({ mesh: 'box', halfW: 0.35, halfH: 0.35, halfD: 0.35, color: '#d94f4f', roughness: 0.5 }));

    const winch = addMachine({
        key: 'winch', label: 'Crane — winch',
        hint: 'translationY limited to 4 m of travel + position motor. The motor holds the hook and its load against gravity indefinitely.',
        anchor: mast.tag, body: hook.tag,
        pivot: hookTop,
        axes: { translationY: { min: -4, max: 0 }, rotationY: 'free' },
        limits: { translationY: { min: -4, max: 0 }, rotationY: { min: -Math.PI, max: Math.PI } },
    });
    winch.node = hook.node;
    setMotor('winch', 'translationY', { type: 'position', target: -2.0, maxForce: 60000, frequency: 4, damping: 1 });

    // The cable. Redrawn every frame from the live transforms — there is no
    // joint visual in the scene graph, and an unexplained floating box is a
    // worse demo than no crane at all.
    const cable = makeRod(scene, '#20242a', 0.04);
    machines.get('winch').cable = { rod: cable, mast: mast.tag, hook: hook.tag, localTip: { x: JIB_REACH, y: 2.3, z: 0 } };
}

// --- Piston / elevator --------------------------------------------------------

const PISTON_X = -6;

function buildPiston() {
    const frame = Physics.createBody({
        shape: 'box', halfExtents: { x: 0.4, y: 3.0, z: 0.4 },
        position: { x: PISTON_X - 1.9, y: 3.0, z: YARD_Z }, static: true, layer: 'static',
    });
    addMesh({ mesh: 'box', halfW: 0.4, halfH: 3.0, halfD: 0.4,
        x: PISTON_X - 1.9, y: 3.0, z: YARD_Z, color: '#5a6069', roughness: 0.85 });

    const plat = part({
        shape: 'box', halfExtents: { x: 1.5, y: 0.18, z: 1.5 },
        position: { x: PISTON_X, y: 0.7, z: YARD_Z },
        mass: 120, friction: 1.4, restitution: 0.0,
    }, (s) => s.createMesh({ mesh: 'box', halfW: 1.5, halfH: 0.18, halfD: 1.5, color: '#4a8fd6', roughness: 0.55 }));

    const m = addMachine({
        key: 'piston', label: 'Piston lift',
        hint: 'ONE axis: translationY limited to 0..4.5 m, driven by a position motor. Load the platform and the motor still holds the target.',
        anchor: frame, body: plat.tag,
        pivot: { x: PISTON_X, y: 0.7, z: YARD_Z },
        axes: { translationY: { min: 0, max: 4.5 } },
        limits: { translationY: { min: 0, max: 4.5 }, rotationY: { min: -0.6, max: 0.6 } },
    });
    m.node = plat.node;
    setMotor('piston', 'translationY', { type: 'position', target: 0.0, maxForce: 120000, frequency: 5, damping: 1 });
}

/** Drop a few crates onto the piston platform — the load test the motor holds. */
export function loadPiston(n = 3) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const p = spawnDebris('box', {
            x: PISTON_X + (Math.random() - 0.5) * 1.4,
            y: 7 + i * 1.0,
            z: YARD_Z + (Math.random() - 0.5) * 1.4,
        }, { halfExtents: { x: 0.35, y: 0.35, z: 0.35 }, mass: 40, color: '#c98a3a' });
        out.push(p);
    }
    return out;
}

// --- Turret --------------------------------------------------------------------
//
// The one machine whose motors are re-targeted every frame. Yaw and pitch are
// solved independently and fed to two position motors — an approximation, since
// SixDOF's rotationY/Z are swing components of one decomposition rather than a
// true gimbal, but at the pitch angles a turret uses the error is invisible and
// the control model (aim = two motor targets) is exactly right.

const TURRET_X = 4;
const TURRET_Y = 1.7;
const BARREL_LEN = 1.5;

function buildTurret() {
    const ped = Physics.createBody({
        shape: 'cylinder', radius: 0.7, halfHeight: 0.6,
        position: { x: TURRET_X, y: 0.6, z: YARD_Z }, static: true, layer: 'static',
    });
    addMesh({ mesh: 'cylinder', radius: 0.7, halfHeight: 0.6, segments: 20,
        x: TURRET_X, y: 0.6, z: YARD_Z, color: '#5a6069', roughness: 0.8 });

    const body = part({
        shape: 'compound',
        parts: [
            { shape: 'box', halfExtents: { x: 0.5, y: 0.35, z: 0.5 }, localPosition: { x: 0, y: 0, z: 0 } },
            { shape: 'box', halfExtents: { x: BARREL_LEN, y: 0.13, z: 0.13 }, localPosition: { x: BARREL_LEN, y: 0.1, z: 0 } },
        ],
        position: { x: TURRET_X, y: TURRET_Y, z: YARD_Z },
        mass: 150, gravityFactor: 0,
    }, (s) => {
        const root = s.createNode('turret');
        root.add(s.createMesh({ mesh: 'box', halfW: 0.5, halfH: 0.35, halfD: 0.5, color: '#4b5b47', roughness: 0.7 }));
        root.add(s.createMesh({ mesh: 'box', halfW: BARREL_LEN, halfH: 0.13, halfD: 0.13,
            x: BARREL_LEN, y: 0.1, color: '#2f3a2d', roughness: 0.5 }));
        return root;
    });

    const m = addMachine({
        key: 'turret', label: 'Tracking turret',
        hint: 'rotationY free (traverse) + rotationZ limited (elevation), both on POSITION motors re-aimed every frame at the drone.',
        anchor: ped, body: body.tag,
        pivot: { x: TURRET_X, y: TURRET_Y, z: YARD_Z },
        axes: { rotationY: 'free', rotationZ: { min: -0.55, max: 0.55 } },
        limits: { rotationY: { min: -2.4, max: 2.4 }, rotationZ: { min: -0.55, max: 0.55 } },
    });
    m.node = body.node;
    m.tracking = true;
    setMotor('turret', 'rotationY', { type: 'position', target: 0, maxTorque: 30000, frequency: 6, damping: 1 });
    setMotor('turret', 'rotationZ', { type: 'position', target: 0, maxTorque: 30000, frequency: 6, damping: 1 });

    // The drone: a kinematic body on a slow circuit. Kinematic rather than a
    // bare mesh so the turret's shells have something solid to hit.
    const drone = Physics.createBody({
        shape: 'sphere', radius: 0.45,
        position: { x: TURRET_X + 6, y: 4, z: YARD_Z }, layer: 'player',
    });
    Physics.setKinematic(drone);
    const dnode = scene.createPhysicsNode({ body: drone, pixelsPerUnit: 1 });
    dnode.add(scene.createMesh({ mesh: 'sphere', radius: 0.45, segments: 18, rings: 14,
        color: '#ff4f7d', emissive: 1.4, emissiveColor: '#ff4f7d', roughness: 0.6 }));
    m.drone = { tag: drone, node: dnode, t: 0 };
}

/** Fire a shell out of the barrel along its current aim. */
export function fireTurret(speed = 34) {
    const m = machines.get('turret');
    if (!m) return null;
    const t = Physics.getTransform(m.body);
    // Barrel is +X in body space; rotate it into world to get both the muzzle
    // position and the launch direction from one transform.
    const q = t.rotation;
    const rot = (p) => {
        const tx = 2 * (q.y * p.z - q.z * p.y), ty = 2 * (q.z * p.x - q.x * p.z), tz = 2 * (q.x * p.y - q.y * p.x);
        return v(p.x + q.w * tx + (q.y * tz - q.z * ty),
                 p.y + q.w * ty + (q.z * tx - q.x * tz),
                 p.z + q.w * tz + (q.x * ty - q.y * tx));
    };
    const dir = rot(v(1, 0, 0));
    const muzzle = rot(v(BARREL_LEN * 2 + 0.4, 0.1, 0));
    const e = spawnDebris('sphere', v(t.position.x + muzzle.x, t.position.y + muzzle.y, t.position.z + muzzle.z),
        { radius: 0.18, mass: 6, color: '#ffd166', emissive: 2.0, restitution: 0.3 });
    Physics.setLinearVelocity(e.tag, dir.x * speed, dir.y * speed, dir.z * speed);
    return e;
}

// --- collideConnected ----------------------------------------------------------
//
// The cleanest single-flag demo in the physics API. Two 0.5 m spheres joined by
// a rope capped at 0.4 m — SHORTER than the sum of their radii, so the flag
// decides whether the joint or the collision wins:
//
//   false (default)  the pair is excluded from collision for the constraint's
//                    lifetime. The rope wins: centres settle at exactly 0.4 and
//                    the spheres visibly merge.
//   true             normal collision survives the joint. Contact wins: the
//                    spheres are pushed apart past the rope's own limit.
//
// Jolt has no runtime setter for it, so the toggle destroys and rebuilds the
// constraint — same story as the axis grid.

const CC_X = 10;
const CC_Y = 4.2;
let ccPair = null;

function buildCollidePair() {
    const anchor = Physics.createBody({
        shape: 'sphere', radius: 0.5,
        position: { x: CC_X, y: CC_Y, z: YARD_Z }, static: true, layer: 'static',
    });
    addMesh({ mesh: 'sphere', radius: 0.5, segments: 22, rings: 16,
        x: CC_X, y: CC_Y, z: YARD_Z, color: '#7f8b99', roughness: 0.6 });

    const ball = part({
        shape: 'sphere', radius: 0.5,
        position: { x: CC_X, y: CC_Y - 0.4, z: YARD_Z }, mass: 20, restitution: 0.1,
    }, (s) => s.createMesh({ mesh: 'sphere', radius: 0.5, segments: 22, rings: 16,
        color: '#4fa3ff', roughness: 0.4 }));

    ccPair = { anchor, ball: ball.tag, node: ball.node, handle: 0, enabled: false };
    setCollideConnected(false);
}

export function setCollideConnected(on) {
    if (!ccPair) return false;
    if (ccPair.handle) Physics.destroyConstraint(ccPair.handle);
    ccPair.enabled = !!on;
    ccPair.handle = Physics.createConstraint({
        type: 'distance', body1: ccPair.anchor, body2: ccPair.ball,
        point1: { x: CC_X, y: CC_Y, z: YARD_Z },
        point2: { x: CC_X, y: CC_Y - 0.4, z: YARD_Z },
        minDistance: 0.0, maxDistance: 0.4,
        collideConnected: !!on,
    });
    Physics.activate(ccPair.ball);
    return true;
}

/** Live centre-to-centre separation of the jointed pair — the HUD readout. */
export function collideSeparation() {
    if (!ccPair) return NaN;
    const p = Physics.getTransform(ccPair.ball).position;
    return Math.hypot(p.x - CC_X, p.y - CC_Y, p.z - YARD_Z);
}
export const getCollideConnected = () => (ccPair ? ccPair.enabled : false);

// --- Mechanism bench: gear, rack-and-pinion, pulley -----------------------------

const GEAR_X = 15;

/**
 * Two meshing gears. Note the construction order the API demands: BOTH hinges
 * must exist first, because the gear constraint couples two existing constraint
 * HANDLES — it does not create the hinges itself.
 *
 * Measured: turn(A) / turn(B) == ratio, to three decimals.
 */
function buildGearTrain() {
    // Cylinders bind along +Y; a 90-degree turn about X lays the axle along +Z
    // so the gears stand upright and mesh in the XY plane.
    const bind = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    const wheel = (x, r, color) => {
        const p = part({
            shape: 'cylinder', radius: r, halfHeight: 0.22,
            position: { x, y: 3.2, z: YARD_Z }, rotation: bind,
            mass: 30, gravityFactor: 0, friction: 0.9, layer: BENCH_LAYER,
        }, (s) => {
            const root = s.createNode('gear');
            root.add(s.createMesh({ mesh: 'cylinder', radius: r, halfHeight: 0.22, segments: 24, color, roughness: 0.45 }));
            // Teeth: purely visual, but without them a spinning smooth cylinder
            // is indistinguishable from a stationary one.
            const teeth = Math.max(8, Math.round(r * 14));
            for (let i = 0; i < teeth; i++) {
                const a = (i / teeth) * Math.PI * 2;
                const t = s.createMesh({ mesh: 'box', halfW: 0.09, halfH: 0.24, halfD: 0.1,
                    x: Math.cos(a) * (r + 0.06), z: Math.sin(a) * (r + 0.06),
                    color: '#20242a', roughness: 0.6 });
                root.add(t);
            }
            return root;
        });
        const hinge = Physics.createConstraint({
            type: 'hinge', body1: p.tag, body2: -1,
            point1: { x, y: 3.2, z: YARD_Z }, point2: { x, y: 3.2, z: YARD_Z },
            axis: { x: 0, y: 0, z: 1 },
        });
        return { ...p, hinge, x };
    };

    const a = wheel(GEAR_X, 1.0, '#c9a227');
    const b = wheel(GEAR_X + 1.65, 0.5, '#a8703a');

    const handle = Physics.createConstraint({
        type: 'gear', body1: a.tag, body2: b.tag,
        hingeAxis1: { x: 0, y: 0, z: 1 }, hingeAxis2: { x: 0, y: 0, z: 1 },
        ratio: 2.0,                       // B turns twice for every turn of A
        constraint1: a.hinge, constraint2: b.hinge,
    });

    mechanisms.set('gears', {
        key: 'gears', label: 'Gear train', driver: a, driven: b, handle, ratio: 2.0,
        hint: 'A `gear` constraint couples two EXISTING hinge handles. Drive A and B follows at exactly 1/ratio the angle.',
    });
    setGearDrive(2.5);
}

/** Drive the gear train's input hinge; the output follows through the gear. */
export function setGearDrive(radPerSec) {
    const g = mechanisms.get('gears');
    if (!g) return false;
    g.speed = radPerSec;
    Physics.activate(g.driver.tag); Physics.activate(g.driven.tag);
    return Physics.setConstraintMotor(g.driver.hinge,
        radPerSec === 0 ? { type: 'off' } : { type: 'velocity', target: radPerSec, maxTorque: 20000 });
}

/**
 * Bring both gears to a dead stop.
 *
 * They carry gravityFactor 0 and no damping, so cutting the drive leaves them
 * coasting forever — there is nothing to slow them down. Anything that wants a
 * known starting state (a ratio change, a measurement) has to zero them first.
 */
export function resetGears() {
    const g = mechanisms.get('gears');
    if (!g) return false;
    setGearDrive(0);
    for (const t of [g.driver.tag, g.driven.tag]) {
        Physics.setAngularVelocity(t, 0, 0, 0);
        Physics.setLinearVelocity(t, 0, 0, 0);
        Physics.activate(t);
    }
    return true;
}

/**
 * Change the coupling ratio — the constraint must be rebuilt to take it.
 *
 * A gear constraint locks the two hinges' angles at their values when it was
 * CREATED. Rebuilding it mid-spin therefore re-datums the coupling against
 * whatever the gears happened to be doing, so callers who care about the
 * resulting rates should resetGears() first.
 */
export function setGearRatio(ratio) {
    const g = mechanisms.get('gears');
    if (!g) return false;
    Physics.destroyConstraint(g.handle);
    g.ratio = ratio;
    g.handle = Physics.createConstraint({
        type: 'gear', body1: g.driver.tag, body2: g.driven.tag,
        hingeAxis1: { x: 0, y: 0, z: 1 }, hingeAxis2: { x: 0, y: 0, z: 1 },
        ratio, constraint1: g.driver.hinge, constraint2: g.driven.hinge,
    });
    return true;
}

const RACK_X = 20;

/**
 * A pinion hinge driving a rack slider. Same coupling shape as the gear: build
 * the hinge and the slider first, then hand both handles to `rackAndPinion`.
 */
function buildRackAndPinion() {
    const bind = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    const pinion = part({
        shape: 'cylinder', radius: 0.55, halfHeight: 0.2,
        position: { x: RACK_X, y: 2.0, z: YARD_Z }, rotation: bind,
        mass: 20, gravityFactor: 0, layer: BENCH_LAYER,
    }, (s) => {
        const root = s.createNode('pinion');
        root.add(s.createMesh({ mesh: 'cylinder', radius: 0.55, halfHeight: 0.2, segments: 20, color: '#c9a227', roughness: 0.45 }));
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            root.add(s.createMesh({ mesh: 'box', halfW: 0.07, halfH: 0.22, halfD: 0.08,
                x: Math.cos(a) * 0.61, z: Math.sin(a) * 0.61, color: '#20242a', roughness: 0.6 }));
        }
        return root;
    });
    const pinionHinge = Physics.createConstraint({
        type: 'hinge', body1: pinion.tag, body2: -1,
        point1: { x: RACK_X, y: 2.0, z: YARD_Z }, point2: { x: RACK_X, y: 2.0, z: YARD_Z },
        axis: { x: 0, y: 0, z: 1 },
    });

    const rack = part({
        shape: 'box', halfExtents: { x: 2.4, y: 0.16, z: 0.22 },
        position: { x: RACK_X, y: 2.72, z: YARD_Z }, mass: 25, gravityFactor: 0,
        layer: BENCH_LAYER,
    }, (s) => s.createMesh({ mesh: 'box', halfW: 2.4, halfH: 0.16, halfD: 0.22, color: '#8fa3b8', roughness: 0.5 }));
    const rackSlider = Physics.createConstraint({
        type: 'slider', body1: rack.tag, body2: -1,
        point1: { x: RACK_X, y: 2.72, z: YARD_Z }, point2: { x: RACK_X, y: 2.72, z: YARD_Z },
        axis: { x: 1, y: 0, z: 0 }, limitMin: -2.2, limitMax: 2.2,
    });

    const handle = Physics.createConstraint({
        type: 'rackAndPinion', body1: pinion.tag, body2: rack.tag,
        hingeAxis1: { x: 0, y: 0, z: 1 }, sliderAxis: { x: 1, y: 0, z: 0 },
        ratio: 2.5, constraint1: pinionHinge, constraint2: rackSlider,
    });

    mechanisms.set('rack', {
        key: 'rack', label: 'Rack & pinion', pinion, rack, pinionHinge, rackSlider, handle,
        home: RACK_X, speed: 0,
        hint: 'A pinion hinge coupled to a rack slider. Drive the pinion; the rack translates at ratio times the pinion angle.',
    });
    setRackDrive(1.6);
}

export function setRackDrive(radPerSec) {
    const r = mechanisms.get('rack');
    if (!r) return false;
    r.speed = radPerSec;
    Physics.activate(r.pinion.tag); Physics.activate(r.rack.tag);
    return Physics.setConstraintMotor(r.pinionHinge,
        radPerSec === 0 ? { type: 'off' } : { type: 'velocity', target: radPerSec, maxTorque: 8000 });
}

/**
 * Park the rack back at the centre of its travel.
 *
 * Needed because a rack driven at a constant rate reaches its slider limit in a
 * couple of seconds and then sits there — at which point "drive it and watch it
 * move" measures nothing. The HUD's reset button and the smoke test both start
 * from here.
 */
export function resetRack() {
    const r = mechanisms.get('rack');
    if (!r) return false;
    setRackDrive(0);
    Physics.setPosition(r.rack.tag, r.home, 2.72, YARD_Z);
    Physics.setLinearVelocity(r.rack.tag, 0, 0, 0);
    Physics.setAngularVelocity(r.pinion.tag, 0, 0, 0);
    Physics.activate(r.rack.tag);
    Physics.activate(r.pinion.tag);
    return true;
}

/** Rack travel from its home position, metres — the HUD readout and the test. */
export function rackOffset() {
    const r = mechanisms.get('rack');
    return r ? Physics.getTransform(r.rack.tag).position.x - r.home : NaN;
}

const PULLEY_X = 25;

/**
 * One rope over two fixed pivots. `pulley` is the only constraint here that
 * needs no other constraint and no motor: hang a heavy mass on one end and a
 * light one on the other, and the rope does the rest.
 */
function buildPulley() {
    const mk = (x, mass, color) => part({
        shape: 'box', halfExtents: { x: 0.4, y: 0.4, z: 0.4 },
        position: { x, y: 3.0, z: YARD_Z }, mass, friction: 0.8, layer: BENCH_LAYER,
    }, (s) => s.createMesh({ mesh: 'box', halfW: 0.4, halfH: 0.4, halfD: 0.4, color, roughness: 0.6 }));

    const heavy = mk(PULLEY_X - 1.6, 120, '#8c2f2c');
    const light = mk(PULLEY_X + 1.6, 25, '#4fa3ff');

    // The gantry the rope runs over — visual plus the fixed pivots' anchor.
    addMesh({ mesh: 'box', halfW: 2.2, halfH: 0.14, halfD: 0.16,
        x: PULLEY_X, y: 6.4, z: YARD_Z, color: '#5a6069', roughness: 0.8 });
    for (const x of [PULLEY_X - 2.1, PULLEY_X + 2.1]) {
        addMesh({ mesh: 'box', halfW: 0.14, halfH: 3.2, halfD: 0.16,
            x, y: 3.2, z: YARD_Z, color: '#5a6069', roughness: 0.85 });
    }

    const f1 = { x: PULLEY_X - 1.6, y: 6.3, z: YARD_Z };
    const f2 = { x: PULLEY_X + 1.6, y: 6.3, z: YARD_Z };
    const handle = Physics.createConstraint({
        type: 'pulley', body1: heavy.tag, body2: light.tag,
        bodyPoint1: { x: PULLEY_X - 1.6, y: 3.4, z: YARD_Z }, fixedPoint1: f1,
        bodyPoint2: { x: PULLEY_X + 1.6, y: 3.4, z: YARD_Z }, fixedPoint2: f2,
        ratio: 1.0,
    });

    mechanisms.set('pulley', {
        key: 'pulley', label: 'Pulley', heavy, light, handle, f1, f2,
        ropes: [makeRod(scene, '#20242a', 0.03), makeRod(scene, '#20242a', 0.03)],
        hint: 'One rope of fixed total length over two pivots. No motor: the 120 kg side descends and hauls the 25 kg side up.',
    });
}

/** Reset the pulley pair to level — the HUD "reset" so it can run again. */
export function resetPulley() {
    const p = mechanisms.get('pulley');
    if (!p) return false;
    for (const [b, x] of [[p.heavy.tag, PULLEY_X - 1.6], [p.light.tag, PULLEY_X + 1.6]]) {
        Physics.setPosition(b, x, 3.0, YARD_Z);
        Physics.setRotation(b, 0, 0, 0, 1);
        Physics.setLinearVelocity(b, 0, 0, 0);
        Physics.setAngularVelocity(b, 0, 0, 0);
        Physics.activate(b);
    }
    return true;
}

// --- Machine debris ------------------------------------------------------------
//
// Payloads, riders and shells. Kept out of spawn.js's `bodies` registry on
// purpose: those are the user's sandbox objects and appear in the body count,
// these are machine byproducts that "clear all" should sweep without the count
// jumping around while a turret is firing.

function spawnDebris(kind, pos, opts = {}) {
    const shape = kind === 'sphere'
        ? { shape: 'sphere', radius: opts.radius ?? 0.3 }
        : { shape: 'box', halfExtents: opts.halfExtents ?? { x: 0.3, y: 0.3, z: 0.3 } };
    const tag = Physics.createBody({
        ...shape, position: pos, layer: opts.layer || 'player',
        mass: opts.mass ?? 10, friction: opts.friction ?? 0.7,
        restitution: opts.restitution ?? 0.15,
    });
    const node = scene.createPhysicsNode({ body: tag, pixelsPerUnit: 1 });
    const color = opts.color || '#c98a3a';
    node.add(kind === 'sphere'
        ? scene.createMesh({ mesh: 'sphere', radius: opts.radius ?? 0.3, segments: 16, rings: 12,
            color, roughness: 0.5, ...(opts.emissive ? { emissive: opts.emissive, emissiveColor: color } : {}) })
        : scene.createMesh({ mesh: 'box',
            halfW: (opts.halfExtents ?? { x: 0.3 }).x, halfH: (opts.halfExtents ?? { y: 0.3 }).y,
            halfD: (opts.halfExtents ?? { z: 0.3 }).z, color, roughness: 0.6 }));
    const e = { tag, node };
    machineDebris.set(tag, e);
    return e;
}
export { spawnDebris };

export function clearMachineDebris() {
    for (const e of machineDebris.values()) {
        if (e.node && e.node.destroy) e.node.destroy();
        Physics.destroyBody(e.tag);
    }
    machineDebris.clear();
    return true;
}

/** Drop a heavy pallet onto the crane hook's landing zone. */
export function craneLoad() {
    const m = machines.get('winch');
    if (!m) return null;
    const h = Physics.getTransform(m.body).position;
    return spawnDebris('box', { x: h.x, y: h.y - 1.4, z: h.z },
        { halfExtents: { x: 0.6, y: 0.4, z: 0.6 }, mass: 90, color: '#7a5c3a' });
}

// --- Per-frame ------------------------------------------------------------------

/**
 * Machines that need a tick: the turret re-aims its two position motors at the
 * drone, the drone flies its circuit, and the rope/cable rods are redrawn.
 * Everything else is solver-side and needs nothing.
 */
export function updateMachines(dt = 1 / 60) {
    // Turret tracking.
    const t = machines.get('turret');
    if (t && t.drone) {
        t.drone.t += dt;
        const a = t.drone.t * 0.55;
        const target = {
            x: TURRET_X + Math.cos(a) * 7.0,
            y: 4.2 + Math.sin(a * 1.7) * 1.4,
            z: YARD_Z + Math.sin(a) * 3.4,
        };
        Physics.moveKinematic(t.drone.tag, target.x, target.y, target.z, Math.max(1 / 240, dt));

        if (t.tracking) {
            const p = Physics.getTransform(t.body).position;
            const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
            const flat = Math.hypot(dx, dz) || 1e-6;
            // A rotation of +yaw about +Y takes the barrel's rest +X toward -Z,
            // hence the negated dz.
            const yaw = Math.atan2(-dz, dx);
            const pitch = Math.atan2(dy, flat);
            const lim = t.limits.rotationZ;
            setMotorTarget('turret', 'rotationY', yaw);
            setMotorTarget('turret', 'rotationZ', Math.max(lim.min, Math.min(lim.max, pitch)));
            t.aim = { yaw, pitch };
        }
    }

    // Crane cable: jib tip -> hook.
    const w = machines.get('winch');
    if (w && w.cable) {
        const mt = Physics.getTransform(w.cable.mast);
        const q = mt.rotation, l = w.cable.localTip;
        const tx = 2 * (q.y * l.z - q.z * l.y), ty = 2 * (q.z * l.x - q.x * l.z), tz = 2 * (q.x * l.y - q.y * l.x);
        const tip = v(
            mt.position.x + l.x + q.w * tx + (q.y * tz - q.z * ty),
            mt.position.y + l.y + q.w * ty + (q.z * tx - q.x * tz),
            mt.position.z + l.z + q.w * tz + (q.x * ty - q.y * tx));
        w.cable.rod.set(tip, Physics.getTransform(w.cable.hook).position);
    }

    // Pulley ropes: body attachment -> its fixed pivot.
    const p = mechanisms.get('pulley');
    if (p) {
        const hp = Physics.getTransform(p.heavy.tag).position;
        const lp = Physics.getTransform(p.light.tag).position;
        p.ropes[0].set(v(hp.x, hp.y + 0.4, hp.z), p.f1);
        p.ropes[1].set(v(lp.x, lp.y + 0.4, lp.z), p.f2);
    }
}

/**
 * Put every machine back to its authored axis layout and a sane motor target.
 *
 * The axis grid is a loaded gun by design — free the piston's translationX and
 * the platform slides off its own lift, which is exactly the lesson. But there
 * has to be a way back, and rebuilding a constraint does NOT recentre the body
 * (a rebuilt constraint takes its frames from the current transforms), so
 * recovery means re-locking the axes AND teleporting the parts home.
 */
export function resetMachines() {
    for (const m of machines.values()) {
        m.axes = { ...m.authoredAxes };
        rebuildConstraint(m);
        const home = m.home;
        if (home) {
            Physics.setPosition(m.body, home.p.x, home.p.y, home.p.z);
            Physics.setRotation(m.body, home.q.x, home.q.y, home.q.z, home.q.w);
            Physics.setLinearVelocity(m.body, 0, 0, 0);
            Physics.setAngularVelocity(m.body, 0, 0, 0);
        }
        // The constraint frames were captured from the pre-teleport pose, so it
        // has to be rebuilt once more now the body is actually home.
        rebuildConstraint(m);
        Physics.activate(m.body);
    }
    setMotor('crane',  'rotationY',    { type: 'velocity', target: 0, maxTorque: 40000 });
    setMotor('winch',  'translationY', { type: 'position', target: -2.0, maxForce: 60000, frequency: 4, damping: 1 });
    setMotor('piston', 'translationY', { type: 'position', target: 0.0, maxForce: 120000, frequency: 5, damping: 1 });
    setTurretTracking(true);
    resetGears();
    setGearDrive(2.5);
    resetRack();
    setRackDrive(1.6);
    resetPulley();
    clearMachineDebris();
    return true;
}

/** Show/hide one machine's axis indicators. */
export function setShowAxes(key, on) {
    const m = machines.get(key);
    if (!m) return false;
    m.showAxes = !!on;
    buildIndicators(m);
    return true;
}

export function setShowAllAxes(on) {
    for (const k of machines.keys()) setShowAxes(k, on);
    return true;
}

export function setTurretTracking(on) {
    const t = machines.get('turret');
    if (!t) return false;
    t.tracking = !!on;
    if (!on) {
        setMotor('turret', 'rotationY', { type: 'off' });
        setMotor('turret', 'rotationZ', { type: 'off' });
    } else {
        setMotor('turret', 'rotationY', { type: 'position', target: 0, maxTorque: 30000, frequency: 6, damping: 1 });
        setMotor('turret', 'rotationZ', { type: 'position', target: 0, maxTorque: 30000, frequency: 6, damping: 1 });
    }
    return true;
}

/** Live offset of a machine's driven axis, for the HUD readouts and tests. */
export function machineOffset(key, axis) {
    const m = machines.get(key);
    if (!m) return NaN;
    const b = Physics.getTransform(m.body).position;
    if (axis === 'translationY') return b.y - m.pivot.y;
    if (axis === 'translationX') return b.x - m.pivot.x;
    if (axis === 'translationZ') return b.z - m.pivot.z;
    // Rotation: report the body's yaw, which is what both rotational machines
    // are actually driving.
    const q = Physics.getTransform(m.body).rotation;
    return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));
}
