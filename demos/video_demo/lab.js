// Video Demo — every HTMLMediaElement IDL property bro implements, wired to a
// control, with the element's own state and event stream shown beside it.
//
// The <video> is the only source of truth: the state panel is a per-frame read
// of the element's properties and the event log is its media events, so a
// control that does nothing shows up as a readout that does not move.
//
// Frame stepping (v.stepFrame / v.frameRate) is a bro extension; see
// ../bro/docs/video-api.js. Video time runs on the wall clock, not the
// engine's virtual clock (headless tests use wallSleep()).

import { boot } from "/lib/kit/app.js";
import { ids } from "/lib/kit/dom.js";
import { logView, progressBar, stats } from "/lib/kit/ui.js";
import { bindControl } from "/lib/kit/params.js";

/** Media events logged (timeupdate is shown in the state panel instead: too noisy). */
export const MEDIA_EVENTS = [
    'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough',
    'play', 'pause', 'ended',
    'seeking', 'seeked', 'timeupdate',
    'volumechange', 'ratechange', 'durationchange',
    'waiting', 'stalled', 'error',
];

/** Live app state for tests: the element, event counts, and the last step result. */
export const lab = {
    video: null,
    counts: {},            // event name -> times fired (timeupdate included)
    lastStep: null,        // what the last stepFrame() returned
    cpt: '',               // last canPlayType result line
};

const fmt = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));

function ranges(r) {
    if (!r || r.length === 0) return '(empty)';
    const parts = [];
    for (let i = 0; i < r.length; i++) parts.push('[' + fmt(r.start(i)) + ', ' + fmt(r.end(i)) + ']');
    return parts.join(' ');
}

/** The state panel text: one line per IDL group, read straight off the element. */
export function describe(v) {
    return [
        'src           ' + v.src,
        'currentSrc    ' + v.currentSrc,
        'paused        ' + v.paused + '   ended ' + v.ended + '   seeking ' + v.seeking,
        'currentTime   ' + fmt(v.currentTime) + ' / ' + fmt(v.duration),
        'frameRate     ' + fmt(v.frameRate) + '   rotation ' + v.videoRotation,
        'volume        ' + fmt(v.volume) + '   muted ' + v.muted + '   defaultMuted ' + v.defaultMuted,
        'playbackRate  ' + fmt(v.playbackRate) + '   default ' + fmt(v.defaultPlaybackRate),
        'readyState    ' + v.readyState + '   networkState ' + v.networkState,
        'video size    ' + v.videoWidth + '×' + v.videoHeight,
        'autoplay ' + v.autoplay + '   loop ' + v.loop + '   controls ' + v.controls + '   preload ' + v.preload,
        'buffered      ' + ranges(v.buffered),
        'seekable      ' + ranges(v.seekable),
        'played        ' + ranges(v.played),
    ].join('\n');
}

/** Frame step through the element's own frame timestamps (pauses first so the picture stays put). */
export function stepFrame(n) {
    const v = lab.video;
    if (!v.paused) v.pause();
    lab.lastStep = v.stepFrame(n);
    return lab.lastStep;
}

export function init() {
    const { status } = boot();
    const el = ids('v', 'state', 'src-input', 'cpt-result');
    const v = lab.video = el.v;
    const log = logView('#events', { max: 30 });
    const progress = progressBar('#progress');
    const readouts = stats('#stats', { t: 'time', ready: 'readyState', fps: 'frameRate' });

    for (const name of MEDIA_EVENTS) {
        lab.counts[name] = 0;
        v.addEventListener(name, () => {
            lab.counts[name]++;
            if (name !== 'timeupdate') log.add(name, name === 'error' ? 'err' : null);
        });
    }

    // ---- transport -------------------------------------------------------
    const click = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    click('play', () => v.play());
    click('pause', () => v.pause());
    click('load', () => v.load());
    click('seek0', () => { v.currentTime = 0; });
    click('seek1', () => { v.currentTime = 1.0; });
    click('seek-end', () => { v.currentTime = Math.max(0, (v.duration || 0) - 0.2); });
    click('step-back', () => stepFrame(-1));
    click('step-fwd', () => stepFrame(1));
    click('apply-src', () => { v.src = el.srcInput.value; });
    click('clear-events', () => log.clear());

    // ---- volume / rate / flags -------------------------------------------
    bindControl('#volume', { out: '#volume-val', onChange: (x) => { v.volume = x; } });
    bindControl('#rate', { out: '#rate-val', fmt: (x) => x.toFixed(2), onChange: (x) => { v.playbackRate = x; } });
    bindControl('#muted', { onChange: (x) => { v.muted = x; } });
    for (const prop of ['autoplay', 'loop', 'controls', 'defaultMuted']) {
        bindControl('#' + prop, { onChange: (x) => { v[prop] = x; } });
    }
    bindControl('#preload', { onChange: (x) => { v.preload = x; } });

    // ---- canPlayType -----------------------------------------------------
    const cpt = (mime) => () => {
        lab.cpt = mime + ' => "' + v.canPlayType(mime) + '"';
        el.cptResult.textContent = lab.cpt;
    };
    click('cpt-webm', cpt('video/webm'));
    click('cpt-vp9', cpt('video/webm; codecs="vp9,opus"'));
    click('cpt-mp4', cpt('video/mp4'));

    // ---- per-frame readout -----------------------------------------------
    const tick = () => {
        const dur = v.duration, t = v.currentTime;
        progress.set(Number.isFinite(dur) && dur > 0 ? t / dur : 0);
        const text = describe(v);
        if (el.state.textContent !== text) el.state.textContent = text;
        readouts.set({ t: fmt(t) + ' / ' + fmt(dur), ready: v.readyState, fps: fmt(v.frameRate) });
        requestAnimationFrame(tick);
    };
    tick();

    if (v.readyState >= 1) status.ok('loaded ' + v.videoWidth + '×' + v.videoHeight + ' · ' + fmt(v.duration) + ' s');
    else status.warn('no metadata yet');
    v.addEventListener('loadedmetadata', () => status.ok('loaded ' + v.videoWidth + '×' + v.videoHeight + ' · ' + fmt(v.duration) + ' s'));
    v.addEventListener('error', () => status.error('media error (networkState ' + v.networkState + ')'));
}
