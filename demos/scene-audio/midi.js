// midi.js — a hardware MIDI controller playing the scene in three dimensions.
//
// ctx.createMidiInput() had no caller anywhere in the workshop. tools/synth,
// the one app that obviously wants it, ships lib/keyboard.js — a full on-screen
// piano — and never opens a hardware port at all. So this panel is the missing
// half: a real port, opened, with its notes going somewhere the rest of this
// app can act on.
//
// And "somewhere" is the point. Routing MIDI into a synth voice would prove the
// binding works and nothing else. Here each of the twelve pitch classes owns a
// PAD — a mesh node standing in a ring around the listener, each with its own
// attached audio emitter. Playing a C strikes the pad at the front of the ring;
// playing the F# above it strikes the one behind you. The octave lifts the pad
// off the floor, so a run up the keyboard is a sound that visibly and audibly
// climbs. Every one of those notes is spatialized by the same
// node.attachAudioEmitter path the cars and bees use — MIDI moves nodes, and
// the engine does the audio.
//
// Pads are struck, not spawned. Each pad holds ONE looping bell playback,
// attached once at load and left at zero gain; a note strike sets its gain from
// velocity and its rate from the pitch, then an envelope here decays it back to
// silence. Creating a playback per note would churn handles at keyboard speed
// and, worse, would need a fresh attachAudioEmitter each time — which would
// obscure the very thing the app is about, that ONE attach lasts a session.

const TAU = Math.PI * 2;
const PAD_COUNT = 12;
const PAD_RADIUS = 9.0;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** How long a struck pad takes to fall back to silence, in seconds. */
const DECAY = 1.6;

export const midiState = {
    /** The MidiInput object, or null if the context refused to make one. */
    input: null,
    /** [{index, name}] as reported by availablePorts(), refreshed on scan. */
    ports: [],
    /** Index of the open port, or -1. */
    openPort: -1,
    /** Rolling log of recent events for the HUD. */
    log: [],
    /** Last control-change value seen, per CC number. */
    cc: {},
    /** Last pitch-bend value, -8192..8191. */
    bend: 0,
    /** Count of note-ons since load — the "is anything arriving" number. */
    noteCount: 0,
    /** The twelve pads. */
    pads: [],
};

let ctxRef = null;
let els = null;

/**
 * Build the pad ring: twelve emitting nodes around the listener, one per pitch
 * class, in circle-of-ear order (chromatic around the ring, so a chromatic run
 * sweeps steadily rather than jumping).
 */
export function buildMidiPads(scene, ctx, clips, busId) {
    ctxRef = ctx;

    for (let i = 0; i < PAD_COUNT; i++) {
        const a = (i / PAD_COUNT) * TAU - Math.PI / 2;   // C at the front (-Z)
        const x = Math.cos(a) * PAD_RADIUS;
        const z = Math.sin(a) * PAD_RADIUS;
        // Hue around the ring so the pad colour and its pitch class agree.
        const color = `hsl(${Math.round((i / PAD_COUNT) * 330)}, 70%, 60%)`;

        const node = scene.createMesh({
            mesh: 'box', name: `midiPad${i}`,
            halfW: 0.55, halfH: 0.12, halfD: 0.55,
            x, y: 0.35, z,
            color, emissive: 0.15, emissiveColor: color,
            roughness: 0.5, metallic: 0.2,
        });

        // One looping bell per pad, attached once, silent. The loop is never
        // heard as a loop because the envelope always closes well inside the
        // clip; looping simply keeps the handle alive forever, which is what
        // the emitter sync wants.
        const playback = ctx.playClip(clips.bell.id, 0.0, true);
        node.attachAudioEmitter(playback);
        ctx.setPlaybackSpatialDistanceModel(playback, 'inverse');
        ctx.setPlaybackSpatialRefDistance(playback, 4.0);
        ctx.setPlaybackSpatialMaxDistance(playback, 200);
        ctx.setPlaybackSpatialRolloff(playback, 1.0);
        ctx.setPlaybackBus(playback, busId);

        midiState.pads.push({
            index: i, node, playback, color,
            name: NOTE_NAMES[i],
            // Position is tracked here rather than read back off the node:
            // node.position is a setter-driven property and the app already
            // owns the authoritative value, so keeping it local avoids
            // depending on read-back semantics the rest of this app never uses.
            baseX: x, baseZ: z, y: 0.35, ringScale: 1.0,
            /** Envelope level, 1 at the strike, decaying to 0. */
            level: 0,
            /** Note number of the last strike, for the HUD. */
            lastNote: -1,
            el: null,
        });
    }

    return midiState.pads;
}

/**
 * Create the MidiInput and scan for ports. Safe with no hardware attached —
 * availablePorts() simply returns an empty array and everything below stays in
 * its idle state.
 */
export function buildMidiInput(ctx) {
    ctxRef = ctx;
    try {
        midiState.input = ctx.createMidiInput();
    } catch (e) {
        midiState.input = null;
        return midiState;
    }

    scanPorts();

    // Note routing goes through onRawEvent rather than connectToAllocator: the
    // allocator route is for driving a synth VoiceAllocator, and what we want
    // is the note number itself so it can pick a pad and a pitch. onRawEvent
    // also gets aftertouch and program change, which the log shows.
    midiState.input.onRawEvent((ev) => {
        if (ev.type === 'noteon' && ev.data2 > 0) {
            triggerNote(ev.data1, ev.data2 / 127);
        } else if (ev.type === 'noteoff' || (ev.type === 'noteon' && ev.data2 === 0)) {
            // Bells ring out; a note-off is logged but does not cut the tail.
            pushLog(`note off  ${noteName(ev.data1)}`);
        } else if (ev.type === 'pitchbend') {
            midiState.bend = ev.pitchBend;
            applyBend();
        } else if (ev.type === 'controlchange') {
            midiState.cc[ev.data1] = ev.data2;
            pushLog(`cc ${ev.data1} = ${ev.data2}`);
        } else {
            pushLog(`${ev.type} ${ev.data1},${ev.data2}`);
        }
    });

    // CC1 (mod wheel) swings the whole pad ring in and out from the listener —
    // a continuous controller moving twelve emitters at once, which is a much
    // better demonstration of the sync than a filter cutoff would be.
    midiState.input.onControlChange(1, (_channel, _cc, value) => {
        setRingRadius(0.5 + (value / 127) * 1.5);
    });

    midiState.input.onPitchBend((_channel, value) => {
        midiState.bend = value;
        applyBend();
    });

    return midiState;
}

/** Refresh the port list from the driver. */
export function scanPorts() {
    if (!midiState.input) { midiState.ports = []; return midiState.ports; }
    midiState.ports = midiState.input.availablePorts() || [];
    return midiState.ports;
}

export function openPort(index) {
    if (!midiState.input) return false;
    const ok = midiState.input.open(index);
    midiState.openPort = ok ? index : -1;
    pushLog(ok ? `opened port ${index}` : `port ${index} refused`);
    drawPortList();
    return ok;
}

export function closePort() {
    if (!midiState.input) return;
    midiState.input.close();
    midiState.openPort = -1;
    pushLog('port closed');
    drawPortList();
}

function noteName(note) {
    return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

/**
 * Strike the pad for `note` at `velocity` (0..1). Exported so the smoke test
 * and the on-screen fallback keys can drive the exact path a hardware note
 * takes — there is no separate "simulated" branch.
 */
export function triggerNote(note, velocity = 0.8) {
    const pad = midiState.pads[note % 12];
    if (!pad) return null;

    midiState.noteCount++;
    pad.lastNote = note;
    pad.level = Math.max(pad.level, Math.max(0.05, velocity));

    // Pitch: the bell clip's fundamental is A4 (MIDI 69), so the rate is a
    // straight 2^(semitones/12) with no tuning table. Bend rides on top.
    ctxRef.setPlaybackRate(pad.playback, rateFor(note));
    ctxRef.setPlaybackGain(pad.playback, pad.level * 0.9);

    // Restart the bell from its attack, otherwise a re-struck pad continues
    // mid-decay and the strike transient — the thing that makes it read as a
    // hit — is missing.
    ctxRef.seekPlayback(pad.playback, 0);

    // Octave lifts the pad. This is a node move, so the emitter follows it: a
    // high note is genuinely higher in the mix, not just visually.
    const octave = Math.floor(note / 12) - 1;
    pad.y = 0.35 + (octave - 3) * 1.15;
    writePadPosition(pad);

    pushLog(`note on   ${noteName(note)}  vel ${Math.round(velocity * 127)}`);
    return pad;
}

function rateFor(note) {
    const bendSemis = (midiState.bend / 8192) * 2;    // ±2 semitones, the usual range
    return Math.pow(2, (note - 69 + bendSemis) / 12);
}

/** Re-pitch every ringing pad so a bend bends what is already sounding. */
function applyBend() {
    for (const pad of midiState.pads) {
        if (pad.level > 0.001 && pad.lastNote >= 0) {
            ctxRef.setPlaybackRate(pad.playback, rateFor(pad.lastNote));
        }
    }
}

/** Write a pad's tracked position onto its node — the emitter follows. */
function writePadPosition(pad) {
    pad.node.position = [
        pad.baseX * pad.ringScale, pad.y, pad.baseZ * pad.ringScale,
    ];
}

/** Push or pull the whole ring, scaling every pad's distance from the origin. */
export function setRingRadius(scale) {
    for (const pad of midiState.pads) {
        pad.ringScale = scale;
        writePadPosition(pad);
    }
}

function pushLog(text) {
    midiState.log.push(text);
    if (midiState.log.length > 7) midiState.log.shift();
}

/**
 * Pump MIDI and run the pad envelopes. processEvents() is a poll — nothing
 * arrives unless this is called, which is why it lives on the frame loop.
 */
export function tickMidi(dt) {
    if (midiState.input && midiState.openPort >= 0) {
        midiState.input.processEvents();
    }

    for (const pad of midiState.pads) {
        if (pad.level <= 0) continue;
        pad.level = Math.max(0, pad.level - dt / DECAY);
        ctxRef.setPlaybackGain(pad.playback, pad.level * 0.9);
        // Struck pads glow and sink back; the visual decay is the audio decay.
        pad.node.scaleY = 1 + pad.level * 2.5;
        if (pad.level === 0) ctxRef.setPlaybackGain(pad.playback, 0);
    }
}

// --- HUD ----------------------------------------------------------------------

export function bindMidiHud(ctx) {
    els = {
        status: document.getElementById('midiStatus'),
        ports: document.getElementById('midiPorts'),
        log: document.getElementById('midiLog'),
        bend: document.getElementById('midiBend'),
        bendBar: document.getElementById('midiBendBar'),
        notes: document.getElementById('midiNotes'),
        pads: document.getElementById('midiPadRow'),
    };

    // A strip of twelve dots, one per pad, lit by the envelope. It doubles as
    // an input: clicking a dot strikes that pad, so the 3D routing can be shown
    // with no hardware in the room.
    els.pads.innerHTML = '';
    for (const pad of midiState.pads) {
        const dot = document.createElement('button');
        dot.className = 'pad';
        dot.title = `${pad.name} — click to strike`;
        dot.style.borderColor = pad.color;
        dot.addEventListener('click', () => triggerNote(60 + pad.index, 0.9));
        els.pads.appendChild(dot);
        pad.el = dot;
    }

    document.getElementById('midiRescan').addEventListener('click', () => {
        scanPorts();
        drawPortList();
    });

    drawPortList();
}

/**
 * Draw the port list, or the empty state. The empty state is the common case
 * on a machine with no controller plugged in, and it says so plainly instead of
 * leaving a blank box that looks broken.
 */
export function drawPortList() {
    if (!els) return;

    if (!midiState.input) {
        els.status.textContent = 'unavailable';
        els.status.className = 'v err';
        els.ports.innerHTML = '<div class="note">This build has no MIDI input support.</div>';
        return;
    }

    els.status.textContent = midiState.openPort >= 0 ? 'open' : 'idle';
    els.status.className = midiState.openPort >= 0 ? 'v' : 'v dim';
    els.ports.innerHTML = '';

    if (midiState.ports.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'note';
        empty.textContent = 'No MIDI input ports. Plug a controller in and hit '
            + 'rescan — or click the pads below, which take the same path a '
            + 'hardware note does.';
        els.ports.appendChild(empty);
        return;
    }

    for (const port of midiState.ports) {
        const row = document.createElement('div');
        row.className = 'port';

        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = port.name;
        nm.title = port.name;
        row.appendChild(nm);

        const btn = document.createElement('button');
        const isOpen = midiState.openPort === port.index;
        btn.className = isOpen ? 'btn on' : 'btn';
        btn.textContent = isOpen ? 'close' : 'open';
        btn.addEventListener('click', () => {
            if (midiState.openPort === port.index) closePort();
            else openPort(port.index);
        });
        row.appendChild(btn);

        els.ports.appendChild(row);
    }
}

/** Repaint the live MIDI readouts. Frame loop, slow lane. */
export function drawMidi() {
    if (!els) return;

    for (const pad of midiState.pads) {
        if (!pad.el) continue;
        pad.el.style.background = pad.level > 0.002
            ? pad.color
            : 'transparent';
        pad.el.style.opacity = String(0.35 + pad.level * 0.65);
    }

    els.notes.textContent = String(midiState.noteCount);

    // Bend is drawn as a bar centred on zero: the sign is the information, and
    // a bare number makes you read a minus sign to get it.
    const b = midiState.bend / 8192;                 // -1 .. ~1
    els.bend.textContent = midiState.bend === 0 ? '0' : midiState.bend.toFixed(0);
    els.bendBar.style.left = `${(50 + Math.max(-50, Math.min(50, b * 50))).toFixed(1)}%`;

    els.log.textContent = midiState.log.length
        ? midiState.log.join('\n')
        : 'waiting for events…';
}
