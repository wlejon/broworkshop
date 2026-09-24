// hud.js — the Machine, Motion, Clips and Rig tabs, the status bar, and the
// per-frame readout. Controls call actions.js; after every action onSync()
// brings the controls back in line with `state`. The readout is the exception
// and deliberately polls the ENGINE, because during a crossfade or a suspended
// machine what was asked for and what is driving the bones are different.

import { $, h, segmented, bindControl, stats, logView, tabs } from "/lib/kit/index.js";
import { character, player, machine, cameras, motion, MARKER_COUNT } from "/app/lab.js";
import * as act from "/app/actions.js";
import { state } from "/app/actions.js";
import { bindBlendHud, renderBlendMix } from "/app/hud-blend.js";

const STATE_BLURB = {
    idle:       'clip · the neutral state',
    move:       'blend space · speed axis',
    moveCrouch: 'blend space · crouched, phase-synced with move',
    jump:       'one-shot · autoAdvance → move',
    wave:       'one-shot · autoAdvance, returns to the previous state',
};

const ctl = {};          // bound controls, by state key
let clipSeg, stateSeg, cameraSeg, log, bar;
let scrubbing = false;   // the playhead must not fight a dragged scrub slider

export function bindHud() {
    tabs('#tabs');
    bar = stats('.k-statusbar .k-stats');

    // --- machine -------------------------------------------------------------
    stateSeg = segmented('#stateNodes', machine.names, {
        value: '', title: (n) => `travel('${n}') — ${STATE_BLURB[n] || ''}`,
        onChange: (n) => act.travelTo(n),
    });
    for (const b of stateSeg.buttons) { b.classList.add('stateNode'); b.dataset.state = b.dataset.value; }

    // Rendered from the machine's own transitions, so a graph edit shows up here.
    const edges = $('#stateEdges');
    for (const t of machine.transitions) {
        const tags = [];
        if (t.fade) tags.push(`${t.fade.toFixed(2)}s`);
        if (t.syncPhase) tags.push('sync');
        if (t.autoAdvance) tags.push('auto');
        edges.appendChild(h('div.edge', { class: t.autoAdvance ? 'auto' : null, dataset: { from: t.from, to: t.to } },
            `${t.from} → ${t.to}` + (tags.length ? `  ${tags.join(' · ')}` : '')));
    }

    ctl.stateSpeed = bindControl('#stateSpeed', { out: '#stateSpeedV', fmt: (v) => v.toFixed(2) + ' m/s',
        onChange: (v) => act.setStateSpeed(v) });
    ctl.crouch = bindControl('#crouchOn', { onChange: (v) => act.setCrouch(v) });
    $('#btnJump').onclick = () => act.trigger('jump');
    $('#btnWave').onclick = () => act.trigger('wave');
    $('#btnClearLog').onclick = () => act.clearLog();

    log = logView('#stateLog', { max: 24, time: false });
    machine.onChange((from, to) => {
        const t = machine.lastChange.at;
        log.add(`${t.toFixed(2)}s  ${from === null ? '(resumed)' : from} → ${to}`);
    });

    // --- root motion + cameras ----------------------------------------------
    ctl.rootMotion = bindControl('#rootMotionOn', { onChange: (v) => act.setRootMotion(v) });
    $('#btnResetPos').onclick = () => act.resetJourney();
    cameraSeg = segmented('#cameraRow', cameras.names, { value: state.camera, onChange: (k) => act.selectCamera(k) });
    for (const b of cameraSeg.buttons) b.dataset.camera = b.dataset.value;
    ctl.cinematic = bindControl('#cineOn', { onChange: (v) => act.setCinematic(v) });

    // --- clips, transport, crossfade ----------------------------------------
    $('#clipCount').textContent = `${player.names.length} clips`;
    clipSeg = segmented('#clipGrid', player.names, { value: state.clip, onChange: (n) => act.selectClip(n) });
    for (const b of clipSeg.buttons) b.dataset.clip = b.dataset.value;
    $('#btnPlay').onclick = () => act.play();
    $('#btnPause').onclick = () => act.pause();
    $('#btnStop').onclick = () => act.stop();
    ctl.loop = bindControl('#loopOn', { onChange: (v) => act.setLoop(v) });
    ctl.speed = bindControl('#speed', { out: '#speedV', fmt: (v) => v.toFixed(2) + '×', onChange: (v) => act.setSpeed(v) });
    const scrub = $('#scrub');
    bindControl(scrub, { out: '#scrubV', fmt: (v) => v.toFixed(3), onChange: (v) => { scrubbing = true; act.scrub(v); } });
    scrub.addEventListener('change', () => { scrubbing = false; });

    ctl.fade = bindControl('#fade', { out: '#fadeV', fmt: (v) => v.toFixed(2) + ' s', onChange: (v) => act.setFade(v) });
    const target = $('#fadeTarget');
    for (const n of player.names) target.appendChild(h('option', { value: n, selected: n === state.fadeTarget }, n));
    ctl.fadeTarget = bindControl(target, { onChange: (v) => act.setFadeTarget(v) });
    $('#btnFade').onclick = () => act.crossfade(state.fadeTarget);

    // --- rig -----------------------------------------------------------------
    $('#boneCount').textContent = `${character.boneCount} bones`;
    ctl.showBones = bindControl('#bonesOn', { onChange: (v) => act.setBones(v) });
    ctl.showSkin = bindControl('#skinOn', { onChange: (v) => act.setSkin(v) });

    bindBlendHud();
    act.onSync(sync);
    for (const k in ctl) ctl[k].value = state[k];
    // Push the panel's defaults so the first frame already matches it.
    act.setLoop(state.loop);
    act.setSpeed(state.speed);
    act.setBones(state.showBones);
    act.setSkin(state.showSkin);
}

/** Pull the controls back in line with `state` after an action. */
function sync(what) {
    switch (what) {
        case 'base':
            clipSeg.value = player.names.includes(state.base) ? state.base : '';
            break;
        case 'machine':
            ctl.stateSpeed.value = state.stateSpeed;
            ctl.crouch.value = state.crouch;
            break;
        case 'log':
            log.clear();
            break;
        case 'motion':
            ctl.rootMotion.value = state.rootMotion;
            break;
        case 'camera':
            ctl.cinematic.value = state.cinematic;
            break;
        case 'transport':
            ctl.loop.value = state.loop;
            ctl.speed.value = state.speed;
            break;
        case 'fade':
            ctl.fade.value = state.fade;
            ctl.fadeTarget.value = state.fadeTarget;
            break;
        case 'rig':
            ctl.showBones.value = state.showBones;
            ctl.showSkin.value = state.showSkin;
            break;
    }
}

/** Refresh the live panel from the engine. Call a few times a second. */
export function updateReadout(fps) {
    const clip = player.currentClip;
    const cur = machine.state;
    const last = machine.lastChange;
    const active = cameras.active;       // scene.activeCamera, not the last click
    bar.set({
        stClip: clip || '(stopped)',
        stTime: player.duration > 0 ? `${player.currentTime.toFixed(2)} / ${player.duration.toFixed(2)}s` : '—',
        stPlaying: player.playing ? 'yes' : 'no',
        stState: cur === null ? '(suspended)' : cur,
        stLast: last.to ? `${last.from === null ? '(resumed)' : last.from} → ${last.to}` : '—',
        stCamera: active || '(imperative view)',
    });
    if (fps !== undefined) bar.set('fps', fps.toFixed(0));

    if (!scrubbing) {
        const n = player.normalizedTime;
        $('#scrub').value = String(n);
        $('#scrubV').textContent = n.toFixed(3);
    }

    // The graph: the live node lit, and the EDGE that fired last called out.
    stateSeg.value = cur === null ? '' : cur;
    for (const e of $('#stateEdges').children) {
        e.classList.toggle('fired', e.dataset.from === last.from && e.dataset.to === last.to);
    }

    $('#rmDist').textContent = `${motion.distance.toFixed(2)} m`;
    $('#rmMarkers').textContent = `${motion.markers}/${MARKER_COUNT} markers`;
    $('#rmZ').textContent = motion.z.toFixed(2);

    cameraSeg.value = active;
    const p = cameras.activePosition();
    $('#camPos').textContent = p ? `[${p.map((v) => v.toFixed(1)).join(', ')}]` : '—';

    renderBlendMix();
}
