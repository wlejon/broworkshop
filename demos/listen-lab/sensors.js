// Listen Lab — tier-0 sensor cards (level / voice / onset / tonality) for the
// active stream, and each stream's tier-0 event edges into its fusion feed.

import { levelMeter } from "/lib/kit/audio-ui.js";
import { D, fusionRow } from "/app/state.js";

const level = levelMeter(D.levelMeter, { min: -80, max: 0, mark: true });

const dot = (el, kind, on) => { el.className = 'dot' + (kind ? ' ' + kind : '') + (on ? ' on' : ''); };

/** Paint the cards from a stream's latest snapshot (blank without one). */
export function renderSensors(st) {
    const s = st && st.lastS, ph = st && st.lastPh;
    if (!s) {
        D.dbBig.textContent = '−∞ dB'; level.set(-80); level.mark(-80);
        D.levelSmall.textContent = 'floor — · snr —';
        dot(D.voiceDot, '', false); D.voiceTxt.textContent = 'quiet'; D.voiceSmall.textContent = 'events 0';
        dot(D.onsetDot, 'onset', false); D.onsetTxt.textContent = '0';
        dot(D.tonalDot, 'tonal', false); D.tonalTxt.textContent = '—'; D.tonalSmall.textContent = 'periodicity —';
        D.streamT.textContent = '0.0 s';
        return;
    }
    D.dbBig.textContent = (s.db <= -90 ? '−∞' : s.db.toFixed(1)) + ' dB';
    level.set(s.db);
    level.mark(s.noiseFloorDb);
    D.levelSmall.textContent = 'floor ' + s.noiseFloorDb.toFixed(0) + ' dB · snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB';

    dot(D.voiceDot, '', s.voice);
    D.voiceTxt.textContent = s.voice ? 'voice' : 'quiet';
    D.voiceSmall.textContent = (s.voice
        ? 'run ' + (s.voiceFrames / 100).toFixed(1) + ' s · events ' + s.voiceEvents
        : 'events ' + s.voiceEvents) + (ph ? ' · /' + ph.label + '/' : '');

    dot(D.onsetDot, 'onset', s.frames - s.lastOnsetFrame < 15);
    D.onsetTxt.textContent = String(s.onsets);

    dot(D.tonalDot, 'tonal', s.tonal);
    D.tonalTxt.textContent = s.tonal ? Math.round(s.dominantHz) + ' Hz' : '—';
    D.tonalSmall.textContent = 'periodicity ' + s.periodicity.toFixed(2) +
        (s.tonal ? ' · run ' + (s.tonalFrames / 100).toFixed(1) + ' s' : '');

    D.streamT.textContent = s.t.toFixed(1) + ' s';
}

/** Tier-0 edges between two snapshots -> rows in that stream's feed. */
export function emitTier0Events(st, prev, s) {
    if (s.voiceEvents > prev.voiceEvents) {
        fusionRow(st, 'voice', 'voice started (snr +' + Math.max(0, s.snrDb).toFixed(0) + ' dB)');
    }
    if (!s.voice && prev.voice) {
        fusionRow(st, 'voice', 'voice ended after ' + (prev.voiceFrames / 100).toFixed(1) + ' s');
    }
    if (s.onsets > prev.onsets) {
        const n = s.onsets - prev.onsets;
        fusionRow(st, 'onset', n === 1 ? 'transient' : n + ' transients');
    }
    if (s.tonal && s.tonalFrames >= 30 && !st.tonalAnnounced) {
        st.tonalAnnounced = true;
        fusionRow(st, 'tonal', 'sustained tone ~' + Math.round(s.dominantHz) +
            ' Hz (periodicity ' + s.periodicity.toFixed(2) + ')');
    }
    if (!s.tonal) st.tonalAnnounced = false;
}
