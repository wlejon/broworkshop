// player.js — the <video> element as a transport: load, play / pause / stop,
// seek, frame step (bro's v.stepFrame), rate, volume, loop. While playing it
// reports the clock every frame so the lanes' playheads move smoothly.

/**
 * opts: { onTime(t, duration), onState('playing' | 'paused' | 'stopped' |
 * 'ended' | 'error') }. Handle below.
 */
export function createPlayer(video, opts) {
    const o = opts || {};
    let raf = 0;
    const time = () => { if (o.onTime) o.onTime(video.currentTime || 0, video.duration || 0); };
    const state = (st) => { if (o.onState) o.onState(st); };
    const tick = () => { time(); raf = api.playing ? requestAnimationFrame(tick) : 0; };

    video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); state('playing'); });
    video.addEventListener('pause', () => { state('paused'); time(); });
    video.addEventListener('ended', () => { state('ended'); time(); });
    video.addEventListener('timeupdate', time);
    video.addEventListener('seeked', time);

    const api = {
        video,
        /**
         * Point the element at `src`; resolves with info() once metadata is
         * in, rejects when the element reports an error (a missing or
         * unsupported file).
         */
        load(src) {
            video.pause();
            return new Promise((resolve, reject) => {
                const done = (fn, v) => {
                    video.removeEventListener('loadedmetadata', onMeta);
                    video.removeEventListener('error', onErr);
                    fn(v);
                };
                const onMeta = () => done(resolve, api.info());
                const onErr = () => done(reject, new Error((video.error && video.error.message) || 'cannot open ' + src));
                video.addEventListener('loadedmetadata', onMeta);
                video.addEventListener('error', onErr);
                video.src = src;   // runs the load algorithm
            });
        },
        play() {
            const p = video.play();
            if (p && p.catch) p.catch(() => state('error'));
        },
        pause() { video.pause(); },
        toggle() { if (api.playing) api.pause(); else api.play(); },
        stop() { video.pause(); api.seek(0); state('stopped'); },
        seek(t) {
            if (!Number.isFinite(t)) return;
            const d = video.duration || 0;
            video.currentTime = Math.max(0, d > 0 ? Math.min(d, t) : t);
            time();
        },
        /** Move n decoded pictures (pauses first so the picture stays put). */
        step(n) {
            video.pause();
            if (typeof video.stepFrame === 'function') video.stepFrame(n);
            else api.seek(video.currentTime + n / (video.frameRate || 30));
            time();
        },
        set rate(v) { video.playbackRate = Math.max(0.1, Math.min(16, v)); },
        get rate() { return video.playbackRate; },
        set volume(v) { video.volume = Math.max(0, Math.min(1, v)); if (video.volume > 0) video.muted = false; },
        get volume() { return video.volume; },
        set muted(v) { video.muted = !!v; },
        get muted() { return video.muted; },
        set loop(v) { video.loop = !!v; },
        get loop() { return video.loop; },
        get time() { return video.currentTime || 0; },
        get duration() { return video.duration || 0; },
        get playing() { return !video.paused && !video.ended; },
        info() {
            return {
                duration: video.duration || 0, width: video.videoWidth || 0, height: video.videoHeight || 0,
                rotation: video.videoRotation || 0, frameRate: video.frameRate || 0,
                hasVideo: video.videoWidth > 0 && video.videoHeight > 0,
            };
        },
    };
    return api;
}
